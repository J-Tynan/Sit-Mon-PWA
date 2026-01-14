import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import shp from 'https://unpkg.com/shpjs@6.2.0/dist/shp.esm.min.js';
import { BaseLayer } from './BaseLayer.js';
import { latLongToVector3 } from '../globe/latLong.js';

export class NaturalEarthPointsZipLayer extends BaseLayer {
  constructor(options = {}) {
    const {
      id = 'ne-points',
      name = 'Natural Earth points',
      zipUrl,
      bounds = null,
      color = 0x00ff66,
      opacity = 0.9,
      pointSizePx = 4,
      radius = 1.004,
      maxPoints = 5000,
      filterFeature = null,
      iconSvgUrl = null,
      iconSvg = null,
      iconTextureSize = 128,
      iconAlphaTest = 0.25
    } = options;

    super(id, name);

    if (!zipUrl) {
      throw new Error('NaturalEarthPointsZipLayer requires zipUrl');
    }

    this.zipUrl = zipUrl;
    this.bounds = bounds;
    this.radius = radius;
    this.maxPoints = maxPoints;
    this.filterFeature = typeof filterFeature === 'function' ? filterFeature : null;

    this.geojson = null;
    this.dataPromise = null;

    this.iconSvgUrl = iconSvgUrl;
    this.iconSvg = iconSvg;
    this.iconTextureSize = iconTextureSize;
    this.iconAlphaTest = iconAlphaTest;
    this.iconPromise = null;

    this.material = new THREE.PointsMaterial({
      color,
      size: pointSizePx,
      sizeAttenuation: false,
      transparent: opacity < 1,
      opacity,
      depthWrite: false
    });
  }

  init(globeRenderer) {
    // Best-effort preload; actual use happens on enable.
    this.ensureIconLoaded().catch(() => {});
  }

  enable(globeRenderer) {
    super.enable(globeRenderer);

    const statusToken = globeRenderer?.setStatus?.(`Loading ${this.name}…`);

    Promise.all([this.ensureDataLoaded(), this.ensureIconLoaded()])
      .then(() => {
        if (!this.enabled) return;

        const points = this.buildPointsObject(this.geojson);
        if (!points) {
          globeRenderer?.clearStatus?.(statusToken);
          globeRenderer?.setStatus?.(`No ${this.name} to show`, { ttlMs: 2500 });
          return;
        }

        globeRenderer.addObject(points);
        this.objects = [points];

        globeRenderer?.clearStatus?.(statusToken);
      })
      .catch((err) => {
        console.warn(`NaturalEarthPointsZipLayer failed to load ${this.zipUrl}`, err);

        globeRenderer?.clearStatus?.(statusToken);
        globeRenderer?.setStatus?.(`Failed to load ${this.name}`, { ttlMs: 6000 });
      });
  }

  disable(globeRenderer) {
    super.disable(globeRenderer);
    this.objects.forEach((obj) => globeRenderer.removeObject(obj));
    this.objects = [];
  }

  refresh(globeRenderer) {
    this.dataPromise = null;
    this.geojson = null;

    if (this.enabled) {
      this.disable(globeRenderer);
      this.enable(globeRenderer);
    }
  }

  ensureIconLoaded() {
    if (this.material.map) return Promise.resolve(this.material.map);
    if (this.iconPromise) return this.iconPromise;

    const hasInlineSvg = typeof this.iconSvg === 'string' && this.iconSvg.trim().length > 0;
    const hasSvgUrl = typeof this.iconSvgUrl === 'string' && this.iconSvgUrl.trim().length > 0;
    if (!hasInlineSvg && !hasSvgUrl) return Promise.resolve(null);

    this.iconPromise = (hasInlineSvg ? Promise.resolve(this.iconSvg) : this.fetchSvgText(this.iconSvgUrl))
      .then((svgText) => this.svgTextToTexture(svgText, this.iconTextureSize))
      .then((texture) => {
        if (!texture) return null;
        this.material.map = texture;
        this.material.transparent = true;
        this.material.alphaTest = this.iconAlphaTest;
        this.material.needsUpdate = true;
        return texture;
      })
      .catch((err) => {
        // Don’t block the layer; it can fall back to plain dots.
        console.warn('Failed to load icon SVG; falling back to dots', err);
        return null;
      });

    return this.iconPromise;
  }

  fetchSvgText(url) {
    return fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
        return res.text();
      })
      .then((text) => (typeof text === 'string' ? text : ''));
  }

  svgTextToTexture(svgText, sizePx) {
    const cleaned = this.normalizeSvgForRaster(svgText || '');
    if (!cleaned) return Promise.resolve(null);

    const svgBlob = new Blob([cleaned], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(svgBlob);

    return this.loadImage(url)
      .then((img) => {
        const canvas = document.createElement('canvas');
        canvas.width = sizePx;
        canvas.height = sizePx;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.clearRect(0, 0, sizePx, sizePx);
        ctx.drawImage(img, 0, 0, sizePx, sizePx);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
        return texture;
      })
      .finally(() => {
        URL.revokeObjectURL(url);
      });
  }

  normalizeSvgForRaster(svgText) {
    let svg = (svgText || '').trim();
    if (!svg.startsWith('<svg')) return '';

    // Force a deterministic paint style so we can tint via PointsMaterial.color.
    // Outline icons typically use stroke="currentColor"; make that white in the raster.
    svg = svg.replace(/stroke="currentColor"/g, 'stroke="#ffffff"');
    svg = svg.replace(/fill="currentColor"/g, 'fill="#ffffff"');

    // Ensure xmlns exists so the SVG loads reliably when blobbed.
    if (!/xmlns=/.test(svg)) {
      svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    return svg;
  }

  loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = url;
    });
  }

  ensureDataLoaded() {
    if (this.geojson) return Promise.resolve(this.geojson);
    if (this.dataPromise) return this.dataPromise;

    this.dataPromise = fetch(this.zipUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch ${this.zipUrl}: ${res.status}`);
        return res.arrayBuffer();
      })
      .then(async (buffer) => {
        const parsed = await shp(buffer);
        const geojson = this.normalizeParsedGeoJson(parsed);
        this.geojson = geojson;
        return geojson;
      });

    return this.dataPromise;
  }

  normalizeParsedGeoJson(parsed) {
    // shp() can return:
    // - FeatureCollection
    // - Array<FeatureCollection>
    // - Object<string, FeatureCollection>
    if (!parsed) return { type: 'FeatureCollection', features: [] };

    if (Array.isArray(parsed)) {
      return {
        type: 'FeatureCollection',
        features: parsed.flatMap((fc) => (fc && Array.isArray(fc.features) ? fc.features : []))
      };
    }

    if (parsed.type === 'FeatureCollection') {
      return parsed;
    }

    if (typeof parsed === 'object') {
      const all = [];
      for (const key of Object.keys(parsed)) {
        const fc = parsed[key];
        if (fc && fc.type === 'FeatureCollection' && Array.isArray(fc.features)) {
          all.push(...fc.features);
        }
      }
      return { type: 'FeatureCollection', features: all };
    }

    return { type: 'FeatureCollection', features: [] };
  }

  buildPointsObject(geojson) {
    const features = geojson?.features;
    if (!Array.isArray(features) || features.length === 0) return null;

    const positions = [];
    let count = 0;

    for (const feature of features) {
      if (count >= this.maxPoints) break;

      const geometry = feature?.geometry;
      if (!geometry) continue;

      if (this.filterFeature && !this.safeFilter(feature)) continue;

      if (geometry.type === 'Point') {
        const [lon, lat] = geometry.coordinates || [];
        if (!this.inBounds(lat, lon)) continue;
        this.pushLatLon(positions, lat, lon);
        count++;
      } else if (geometry.type === 'MultiPoint') {
        const coords = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
        for (const c of coords) {
          if (count >= this.maxPoints) break;
          const [lon, lat] = c || [];
          if (!this.inBounds(lat, lon)) continue;
          this.pushLatLon(positions, lat, lon);
          count++;
        }
      }
    }

    if (positions.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    return new THREE.Points(geometry, this.material);
  }

  safeFilter(feature) {
    try {
      return Boolean(this.filterFeature(feature));
    } catch {
      return false;
    }
  }

  inBounds(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    const b = this.bounds;
    if (!b) return true;
    return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
  }

  pushLatLon(positions, lat, lon) {
    const v = latLongToVector3(lat, lon, this.radius);
    positions.push(v.x, v.y, v.z);
  }
}
