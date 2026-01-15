import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { latLongToVector3 } from '../globe/latLong.js';

export class SelectionHighlight {
  constructor(globeRenderer, options = {}) {
    this.globe = globeRenderer;

    this.radius = options.radius ?? 1.007;
    this.haloRadius = options.haloRadius ?? 1.011;
    this.maxSegmentRadians = ((options.maxSegmentDegrees ?? 1) * Math.PI) / 180;

    this.highlights = [];
    this.geojsonCache = new Map();
  }

  tick(nowMs) {
    // Update and expire active highlights.
    for (let i = this.highlights.length - 1; i >= 0; i--) {
      const h = this.highlights[i];
      const t = (nowMs - h.startMs) / h.durationMs;
      if (t >= 1) {
        for (const obj of h.objects) {
          this.globe.removeObject(obj);
          obj.geometry?.dispose?.();
        }
        for (const mat of h.materials) {
          mat?.dispose?.();
        }
        this.highlights.splice(i, 1);
        continue;
      }

      // Single-bump pulse with a steeper fade so it clears quickly.
      const fadeLinear = 1 - t;
      const fade = fadeLinear * fadeLinear;
      const pulse = 0.15 + 0.85 * Math.sin(t * Math.PI);
      for (let m = 0; m < h.materials.length; m++) {
        const mat = h.materials[m];
        const baseOpacity = h.baseOpacities[m];
        mat.opacity = baseOpacity * fade * pulse;
      }
    }
  }

  async loadGeoJson(dataUrl) {
    if (this.geojsonCache.has(dataUrl)) return this.geojsonCache.get(dataUrl);

    const promise = fetch(dataUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch ${dataUrl}: ${res.status}`);
        return res.json();
      })
      .then((json) => json);

    this.geojsonCache.set(dataUrl, promise);
    return promise;
  }

  async flashGeoJsonFeature({
    dataUrl,
    matchFn,
    color = 0xffff66,
    durationMs = 360
  }) {
    const geojson = await this.loadGeoJson(dataUrl);
    const feature = (geojson?.features || []).find((f) => {
      try {
        return Boolean(matchFn(f));
      } catch {
        return false;
      }
    });
    if (!feature?.geometry) return;

    this.flashGeometry(feature.geometry, { color, durationMs });
  }

  flashBounds(bounds, { color = 0xffff66, durationMs = 360, samplesPerEdge = 24 } = {}) {
    if (!bounds) return;

    const { minLat, maxLat, minLon, maxLon } = bounds;
    if (![minLat, maxLat, minLon, maxLon].every((n) => Number.isFinite(n))) return;

    const coords = [];

    const sampleLine = (a, b, steps) => {
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        coords.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    };

    // Coords are [lon, lat]
    sampleLine([minLon, minLat], [maxLon, minLat], samplesPerEdge); // south
    sampleLine([maxLon, minLat], [maxLon, maxLat], samplesPerEdge); // east
    sampleLine([maxLon, maxLat], [minLon, maxLat], samplesPerEdge); // north
    sampleLine([minLon, maxLat], [minLon, minLat], samplesPerEdge); // west

    const geometry = { type: 'Polygon', coordinates: [coords] };
    this.flashGeometry(geometry, { color, durationMs });
  }

  flashGeometry(geometry, { color = 0xffff66, durationMs = 400 } = {}) {
    const corePositions = this.geometryToLinePositions(geometry, this.radius);
    if (corePositions.length === 0) return;

    const haloPositions = this.geometryToLinePositions(geometry, this.haloRadius);

    const coreGeom = new THREE.BufferGeometry();
    coreGeom.setAttribute('position', new THREE.Float32BufferAttribute(corePositions, 3));

    const haloGeom = new THREE.BufferGeometry();
    haloGeom.setAttribute('position', new THREE.Float32BufferAttribute(haloPositions, 3));

    const coreMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const haloMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const coreLines = new THREE.LineSegments(coreGeom, coreMat);
    const haloLines = new THREE.LineSegments(haloGeom, haloMat);

    this.globe.addObject(haloLines);
    this.globe.addObject(coreLines);

    this.highlights.push({
      objects: [haloLines, coreLines],
      materials: [haloMat, coreMat],
      baseOpacities: [haloMat.opacity, coreMat.opacity],
      startMs: performance.now(),
      durationMs
    });
  }

  geometryToLinePositions(geometry, radius) {
    if (!geometry || !geometry.type || !geometry.coordinates) return [];

    const positions = [];

    const emitRing = (ring) => {
      positions.push(...this.ringToLinePositions(ring, radius));
    };

    if (geometry.type === 'Polygon') {
      for (const ring of geometry.coordinates) emitRing(ring);
    } else if (geometry.type === 'MultiPolygon') {
      for (const poly of geometry.coordinates) {
        for (const ring of poly) emitRing(ring);
      }
    }

    return positions;
  }

  ringToLinePositions(coords, radius) {
    if (!Array.isArray(coords) || coords.length < 2) return [];

    const closed = [...coords];
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      closed.push(first);
    }

    const positions = [];

    for (let i = 0; i < closed.length - 1; i++) {
      const [lonA, latA] = closed[i];
      const [lonB, latB] = closed[i + 1];

      const ua = this.latLonToUnitVector(latA, lonA);
      const ub = this.latLonToUnitVector(latB, lonB);
      const dot = this.clamp(ua.x * ub.x + ua.y * ub.y + ua.z * ub.z, -1, 1);
      const omega = Math.acos(dot);

      const steps = Math.max(1, Math.ceil(omega / this.maxSegmentRadians));
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        const p0 = this.slerpUnit(ua, ub, omega, t0);
        const p1 = this.slerpUnit(ua, ub, omega, t1);

        positions.push(
          p0.x * radius,
          p0.y * radius,
          p0.z * radius,
          p1.x * radius,
          p1.y * radius,
          p1.z * radius
        );
      }
    }

    return positions;
  }

  latLonToUnitVector(lat, lon) {
    return latLongToVector3(lat, lon, 1);
  }

  slerpUnit(a, b, omega, t) {
    if (omega < 1e-6) return { x: a.x, y: a.y, z: a.z };

    const sinOmega = Math.sin(omega);
    if (sinOmega < 1e-6) {
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const z = a.z + (b.z - a.z) * t;
      const invLen = 1 / Math.sqrt(x * x + y * y + z * z);
      return { x: x * invLen, y: y * invLen, z: z * invLen };
    }

    const s0 = Math.sin((1 - t) * omega) / sinOmega;
    const s1 = Math.sin(t * omega) / sinOmega;
    return {
      x: a.x * s0 + b.x * s1,
      y: a.y * s0 + b.y * s1,
      z: a.z * s0 + b.z * s1
    };
  }

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
}
