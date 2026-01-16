import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { BaseLayer } from './BaseLayer.js';
import { latLongToVector3 } from '../globe/latLong.js';

/**
 * BoundaryLayer
 *
 * Renders country and region boundaries as:
 * - Lines or thin meshes
 * - Slightly above the globe surface
 *
 * Data source:
 * - Bundled GeoJSON (offline)
 *
 * Rendering rules:
 * - No transparency
 * - Calm, low-contrast colours
 * - No animation
 */

export class BoundaryLayer extends BaseLayer {
  constructor(options = {}) {
    const {
      id = 'boundaries',
      name = 'Boundaries',
      dataUrl = '/src/data/uk-boundaries.json',
      data = null,
      color = 0x737373,
      maxSegmentDegrees = 2
    } = options;

    super(id, name);
    this.dataUrl = dataUrl;
    this.boundaryData = data;
    this.dataPromise = null;
    this.lineGeometries = [];
    this.material = new THREE.LineBasicMaterial({ color });

    // Large line segments drawn as straight 3D chords will cut through the globe.
    // To keep outlines on the surface, we subdivide edges along great-circle arcs.
    this.maxSegmentRadians = (maxSegmentDegrees * Math.PI) / 180;
  }

  init(globeRenderer) {
    // Optional eager build if data was provided directly.
    if (this.boundaryData) {
      this.lineGeometries = this.buildLineGeometries(this.boundaryData, 1.002);
    }
  }

  enable(globeRenderer) {
    super.enable(globeRenderer);

    const statusToken = globeRenderer?.setStatus?.(`Loading ${this.name}…`);
    this.ensureDataLoaded()
      .then(() => {
        if (!this.enabled) return;

        this.lineGeometries = this.buildLineGeometries(this.boundaryData, 1.002);
        this.objects = this.lineGeometries.map((geometry) => {
          const lines = new THREE.LineSegments(geometry, this.material);
          globeRenderer.addObject(lines);
          return lines;
        });

        globeRenderer?.clearStatus?.(statusToken);
      })
      .catch((err) => {
        console.warn('BoundaryLayer failed to load boundary data', err);

        globeRenderer?.clearStatus?.(statusToken);
        globeRenderer?.setStatus?.(`Failed to load ${this.name}`, { ttlMs: 5000 });
      });
  }

  disable(globeRenderer) {
    super.disable(globeRenderer);
    this.objects.forEach((obj) => globeRenderer.removeObject(obj));
    this.objects = [];
  }

  refresh(globeRenderer) {
    this.ensureDataLoaded()
      .then(() => {
        this.lineGeometries = this.buildLineGeometries(this.boundaryData, 1.002);
        if (this.enabled) {
          this.disable(globeRenderer);
          this.enable(globeRenderer);
        }
      })
      .catch((err) => {
        console.warn('BoundaryLayer refresh failed', err);
      });
  }

  ensureDataLoaded() {
    if (this.boundaryData) return Promise.resolve(this.boundaryData);
    if (this.dataPromise) return this.dataPromise;

    this.dataPromise = fetch(this.dataUrl)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch ${this.dataUrl}: ${res.status}`);
        }
        return res.json();
      })
      .then((json) => {
        // Support TopoJSON (Topology) inputs by converting to GeoJSON.
        try {
          // Lazy import of loader helper to avoid adding a runtime dependency unless needed.
          // This module exports `loadGeoData` which uses topojson-client's `feature`.
          // Import relative to src/layers — path: '../lib/geo.js'
          // eslint-disable-next-line import/no-cycle
          return import('../lib/geo.js').then(({ loadGeoData }) =>
          // Support sync or async conversion results by normalising to a Promise
          Promise.resolve(loadGeoData(json)).then((geo) => {
            this.boundaryData = geo;
            return geo;
          })
        );
        } catch (e) {
          this.boundaryData = json;
          return json;
        }
      });

    return this.dataPromise;
  }

  buildLineGeometries(geojson, radius) {
    if (!geojson || !Array.isArray(geojson.features)) return [];

    const geometries = [];

    for (const feature of geojson.features) {
      const { geometry } = feature || {};
      if (!geometry) continue;

      if (geometry.type === 'Polygon') {
        geometries.push(...this.createPolygonGeometry(geometry.coordinates, radius));
      } else if (geometry.type === 'MultiPolygon') {
        for (const poly of geometry.coordinates) {
          geometries.push(...this.createPolygonGeometry(poly, radius));
        }
      }
    }

    return geometries;
  }

  createPolygonGeometry(rings, radius) {
    const geometries = [];
    for (const ring of rings) {
      const positions = this.ringToLinePositions(ring, radius);
      if (positions.length === 0) continue;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3)
      );
      geometries.push(geometry);
    }
    return geometries;
  }

  ringToLinePositions(coords, radius) {
    if (!Array.isArray(coords) || coords.length < 2) return [];

    // Ensure the ring is closed
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

      // Build arc on unit sphere, then scale slightly above globe radius.
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
          p0.x * radius, p0.y * radius, p0.z * radius,
          p1.x * radius, p1.y * radius, p1.z * radius
        );
      }
    }

    return positions;
  }

  latLonToUnitVector(lat, lon) {
    // Same coordinate system as latLongToVector3, but unit radius.
    return latLongToVector3(lat, lon, 1);
  }

  slerpUnit(a, b, omega, t) {
    if (omega < 1e-6) {
      return { x: a.x, y: a.y, z: a.z };
    }

    const sinOmega = Math.sin(omega);
    if (sinOmega < 1e-6) {
      // Fallback to linear interpolation + normalize
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
