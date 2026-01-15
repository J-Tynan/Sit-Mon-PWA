import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import shp from 'https://unpkg.com/shpjs@6.2.0/dist/shp.esm.min.js';
import { BaseLayer } from './BaseLayer.js';
import { latLongToVector3 } from '../globe/latLong.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeParsedGeoJson(parsed) {
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

function featureToLabelText(feature) {
  const props = feature?.properties || {};
  const candidates = [
    props.name,
    props.NAME,
    props.name_en,
    props.NAME_EN,
    props.nameascii,
    props.NAMEASCII,
    props.name_ascii,
    props.NAME_ASCII
  ];

  for (const c of candidates) {
    const s = typeof c === 'string' ? c.trim() : '';
    if (s) return s;
  }
  return '';
}

function isImportantPlace(feature, maxScaleRank) {
  const props = feature?.properties || {};
  const raw = props.scalerank ?? props.SCALERANK ?? props.ScaleRank;
  const rank = Number(raw);
  if (!Number.isFinite(rank)) return true;
  return rank <= maxScaleRank;
}

export class NaturalEarthPopulatedPlacesLayer extends BaseLayer {
  constructor(options = {}) {
    const {
      id = 'ne-populated-places-uk',
      name = 'Populated places (UK)',
      zipUrl,
      geojsonUrl,
      bounds,
      radius = 1.004,
      labelRadius = 1.007,
      maxPoints = 2500,
      maxLabels = 300,
      maxScaleRank = 3,
      filterFeature = null,
      pointColor = 0x00ff66,
      pointOpacity = 0.65,
      pointSizePx = 3,
      labelColor = 'rgba(0,255,102,0.95)',
      labelShadow = 'rgba(0,0,0,0.85)',
      labelFontPx = 14,
      labelMaxPxW = 140
    } = options;

    super(id, name);

    if (!zipUrl && !geojsonUrl) throw new Error('NaturalEarthPopulatedPlacesLayer requires zipUrl or geojsonUrl');
    if (!bounds) throw new Error('NaturalEarthPopulatedPlacesLayer requires bounds');

    this.zipUrl = zipUrl;
    this.geojsonUrl = geojsonUrl;
    this.bounds = bounds;
    this.radius = radius;
    this.labelRadius = labelRadius;

    this.maxPoints = maxPoints;
    this.maxLabels = maxLabels;
    this.maxScaleRank = maxScaleRank;
    this.filterFeature = typeof filterFeature === 'function' ? filterFeature : null;

    this.currentMaxLabels = maxLabels;
    this.currentMaxScaleRank = maxScaleRank;

    this.labelFontPx = labelFontPx;
    this.labelMaxPxW = labelMaxPxW;
    this.labelColor = labelColor;
    this.labelShadow = labelShadow;

    this.geojson = null;
    this.dataPromise = null;

    this.pointsMaterial = new THREE.PointsMaterial({
      color: pointColor,
      size: pointSizePx,
      sizeAttenuation: false,
      transparent: pointOpacity < 1,
      opacity: pointOpacity,
      depthWrite: false
    });

    this._globe = null;
    this._removeTick = null;

    this._labelSprites = [];
  }

  updateDensityForZoom(zoomFactor) {
    const z = Number(zoomFactor) || 1;

    // Bucketed density: wide view = fewer labels, closer view = more labels.
    let desiredRank;
    let desiredLabels;

    if (z < 1.4) {
      desiredRank = Math.min(this.maxScaleRank, 3);
      desiredLabels = Math.min(this.maxLabels, 140);
    } else if (z < 2.2) {
      desiredRank = Math.min(this.maxScaleRank, 4);
      desiredLabels = Math.min(this.maxLabels, 220);
    } else if (z < 3.2) {
      desiredRank = Math.min(this.maxScaleRank, 5);
      desiredLabels = Math.min(this.maxLabels, 320);
    } else if (z < 4.8) {
      desiredRank = Math.min(this.maxScaleRank, 6);
      desiredLabels = Math.min(this.maxLabels, 440);
    } else if (z < 6.5) {
      desiredRank = Math.min(this.maxScaleRank, 7);
      desiredLabels = Math.min(this.maxLabels, 520);
    } else if (z < 8.5) {
      desiredRank = Math.min(this.maxScaleRank, 8);
      desiredLabels = Math.min(this.maxLabels, 600);
    } else if (z < 10.5) {
      desiredRank = Math.min(this.maxScaleRank, 9);
      desiredLabels = Math.min(this.maxLabels, 700);
    } else {
      desiredRank = this.maxScaleRank;
      desiredLabels = this.maxLabels;
    }

    if (desiredRank === this.currentMaxScaleRank && desiredLabels === this.currentMaxLabels) return;
    this.currentMaxScaleRank = desiredRank;
    this.currentMaxLabels = desiredLabels;

    if (!this.enabled || !this.geojson || !this._globe) return;
    this.rebuildLabels();
  }

  safeFilter(feature) {
    try {
      return Boolean(this.filterFeature(feature));
    } catch {
      return false;
    }
  }

  enable(globeRenderer) {
    super.enable(globeRenderer);
    this._globe = globeRenderer;

    const statusToken = globeRenderer?.setStatus?.(`Loading ${this.name}…`);

    this.ensureDataLoaded()
      .then(() => {
        if (!this.enabled) return;

        const pointsObj = this.buildPointsObject(this.geojson);
        if (pointsObj) {
          globeRenderer.addObject(pointsObj);
          this.objects.push(pointsObj);
        }

        const labelSprites = this.buildLabelSprites(this.geojson);
        for (const s of labelSprites) {
          globeRenderer.addObject(s);
          this.objects.push(s);
        }
        this._labelSprites = labelSprites;

        this._removeTick?.();
        this._removeTick = globeRenderer.addTickHandler(() => {
          if (!this.enabled) return;
          this.updateLabelScales();
        });

        this.updateLabelScales();

        globeRenderer?.clearStatus?.(statusToken);
      })
      .catch((err) => {
        console.warn(`NaturalEarthPopulatedPlacesLayer failed to load ${this.zipUrl}`, err);

        globeRenderer?.clearStatus?.(statusToken);
        globeRenderer?.setStatus?.(`Failed to load ${this.name}`, { ttlMs: 6000 });
      });
  }

  disable(globeRenderer) {
    super.disable(globeRenderer);

    this._removeTick?.();
    this._removeTick = null;

    for (const obj of this.objects) {
      globeRenderer.removeObject(obj);
    }

    // Dispose label textures/materials.
    this.disposeLabelSprites();

    this.objects = [];
    this._globe = null;
  }

  disposeLabelSprites() {
    for (const sprite of this._labelSprites) {
      const mat = sprite?.material;
      if (mat?.map) mat.map.dispose?.();
      mat?.dispose?.();
      this._globe?.removeObject?.(sprite);
    }
    this._labelSprites = [];
    if (Array.isArray(this.objects)) {
      this.objects = this.objects.filter((obj) => obj?.isSprite !== true && obj?.type !== 'Sprite');
    }
  }

  rebuildLabels() {
    if (!this._globe || !this.geojson) return;

    this.disposeLabelSprites();

    const labelSprites = this.buildLabelSprites(this.geojson);
    for (const s of labelSprites) {
      this._globe.addObject(s);
      this.objects.push(s);
    }
    this._labelSprites = labelSprites;
    this.updateLabelScales();
  }

  refresh(globeRenderer) {
    this.dataPromise = null;
    this.geojson = null;

    if (this.enabled) {
      this.disable(globeRenderer);
      this.enable(globeRenderer);
    }
  }

  ensureDataLoaded() {
    if (this.geojson) return Promise.resolve(this.geojson);
    if (this.dataPromise) return this.dataPromise;

    // Support either a GeoJSON URL (already filtered) or a ZIP (shpjs) archive.
    if (this.geojsonUrl) {
      this.dataPromise = fetch(this.geojsonUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to fetch ${this.geojsonUrl}: ${res.status}`);
          return res.json();
        })
        .then((parsed) => {
          const geojson = normalizeParsedGeoJson(parsed);
          this.geojson = geojson;
          return geojson;
        });
    } else {
      this.dataPromise = fetch(this.zipUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to fetch ${this.zipUrl}: ${res.status}`);
          return res.arrayBuffer();
        })
        .then(async (buffer) => {
          const parsed = await shp(buffer);
          const geojson = normalizeParsedGeoJson(parsed);
          this.geojson = geojson;
          return geojson;
        });
    }

    return this.dataPromise;
  }

  inBounds(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    const b = this.bounds;
    return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
  }

  buildPointsObject(geojson) {
    const features = geojson?.features;
    if (!Array.isArray(features) || features.length === 0) return null;

    const rankCutoff = this.currentMaxScaleRank ?? this.maxScaleRank;

    const positions = [];
    let count = 0;

    for (const feature of features) {
      if (count >= this.maxPoints) break;
      if (!isImportantPlace(feature, rankCutoff)) continue;
      if (this.filterFeature && !this.safeFilter(feature)) continue;

      const geometry = feature?.geometry;
      if (!geometry) continue;

      if (geometry.type === 'Point') {
        const [lon, lat] = geometry.coordinates || [];
        if (!this.inBounds(lat, lon)) continue;
        const v = latLongToVector3(lat, lon, this.radius);
        positions.push(v.x, v.y, v.z);
        count++;
      }
    }

    if (positions.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    return new THREE.Points(geometry, this.pointsMaterial);
  }

  buildLabelSprites(geojson) {
    const features = geojson?.features;
    if (!Array.isArray(features) || features.length === 0) return [];

    const rankCutoff = this.currentMaxScaleRank ?? this.maxScaleRank;
    const labelCap = this.currentMaxLabels ?? this.maxLabels;

    const sprites = [];

    for (const feature of features) {
      if (sprites.length >= labelCap) break;
      if (!isImportantPlace(feature, rankCutoff)) continue;
      if (this.filterFeature && !this.safeFilter(feature)) continue;

      const geometry = feature?.geometry;
      if (!geometry || geometry.type !== 'Point') continue;

      const [lon, lat] = geometry.coordinates || [];
      if (!this.inBounds(lat, lon)) continue;

      const text = featureToLabelText(feature);
      if (!text) continue;

      const sprite = this.createTextSprite(text);
      if (!sprite) continue;

      const pos = latLongToVector3(lat, lon, this.labelRadius);
      sprite.position.set(pos.x, pos.y, pos.z);

      sprites.push(sprite);
    }

    return sprites;
  }

  createTextSprite(text) {
    const scale = 2; // render at 2x for crispness
    const fontPx = this.labelFontPx * scale;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.font = `600 ${fontPx}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", monospace`;
    const padX = 10 * scale;
    const padY = 6 * scale;

    const metrics = ctx.measureText(text);
    const textW = Math.ceil(metrics.width);
    const w = Math.min(Math.ceil((textW + padX * 2) / scale), this.labelMaxPxW) * scale;
    const h = (this.labelFontPx + 10) * scale;

    canvas.width = Math.max(32, w);
    canvas.height = Math.max(16, h);

    // Re-apply font after resizing
    ctx.font = `600 ${fontPx}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", monospace`;
    ctx.textBaseline = 'middle';

    // Shadow stroke for readability
    ctx.lineWidth = 4 * scale;
    ctx.strokeStyle = this.labelShadow;
    ctx.fillStyle = this.labelColor;

    const x = padX;
    const y = canvas.height / 2;

    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(material);
    sprite.frustumCulled = false;

    // store desired screen size
    sprite.userData.desiredPxW = Math.min(canvas.width / scale, this.labelMaxPxW);
    sprite.userData.aspect = canvas.height / canvas.width;

    return sprite;
  }

  updateLabelScales() {
    if (!this._globe || this._labelSprites.length === 0) return;

    const cam = this._globe.camera;
    const vw = this._globe.width || this._globe.renderer?.domElement?.clientWidth || 1;
    const vh = this._globe.height || this._globe.renderer?.domElement?.clientHeight || 1;
    if (!cam || vw <= 1 || vh <= 1) return;

    for (const sprite of this._labelSprites) {
      const desiredPxW = Number(sprite?.userData?.desiredPxW) || 80;
      const aspect = Number(sprite?.userData?.aspect) || 0.25;

      const dist = cam.position.distanceTo(sprite.position);
      const fovRad = (cam.fov * Math.PI) / 180;
      const viewHeightWorld = 2 * dist * Math.tan(fovRad / 2);
      const viewWidthWorld = viewHeightWorld * cam.aspect;
      const worldW = viewWidthWorld * (desiredPxW / vw);

      sprite.scale.set(worldW, worldW * aspect, 1);
    }
  }
}
