import * as THREE from 'three';
import { FilteredBoundaryLayer } from './FilteredBoundaryLayer.js';
import { latLongToVector3 } from '../globe/latLong.js';

// Demo schedule data is loaded by the UI layer (static JSON).

const YORKSHIRE_HUMBER_BOUNDS = {
  minLat: 53.2,
  maxLat: 54.6,
  minLon: -2.5,
  maxLon: 0.3
};

// Globe radius is 1.0; keep label just above surface.
const LABEL_SURFACE_RADIUS = 1.0025;

function normalizePostcode(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function colourNameToHexString(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;

  // Match bin colours as used in the UI; "green" aligns with the earlier observed NELC hex.
  if (key === 'green') return '#15651C';
  if (key === 'blue') return '#1E5BFF';
  if (key === 'black') return '#111111';
  return null;
}

function parseHexColorString(value) {
  if (!value) return null;
  const text = String(value).trim();
  const hex = text.startsWith('#') ? text.slice(1) : text;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return Number.parseInt(hex, 16);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export class NelcBinDemoLayer extends FilteredBoundaryLayer {
  constructor(options = {}) {
    const {
      postcode = 'DN32 0NE',
      ladId = 'E06000012',
      ...rest
    } = options;

    // Always show the NELC boundary regardless of subarea
    super({
      id: rest.id || 'bin-demo-nelc',
      name: rest.name || 'Bin collection (demo: NELC)',
      dataUrl: rest.dataUrl || '/src/data/uk-lads.v1.topo.json',
      color: rest.color ?? 0xff4d4d,
      filterFn: (feature) => feature?.properties?.id === 'E06000012',
      ...rest
    });

    this.postcode = postcode;
    this.ladId = 'E06000012';
    this.lastNext = null;

    this.demoSubareas = [];
    this.demoScheduleBySubareaId = {};
    this.selectedSubareaId = null;

    this._globe = null;
    this.labelSprite = null;
    this.labelTexture = null;
    this.labelMaterial = null;
    this.labelCanvas = null;
    this.labelCtx = null;
    this.labelDpr = 1;
    this.labelLogicalWidth = 260;
    this.labelLogicalHeight = 100;
    this.labelLatLon = null;
    this.labelSpanDeg = null;

    this._removeTick = null;
    this._anchorReady = false;
  }

  setDemoData({ subareas, scheduleBySubareaId } = {}) {
    this.demoSubareas = Array.isArray(subareas) ? subareas : [];
    this.demoScheduleBySubareaId =
      scheduleBySubareaId && typeof scheduleBySubareaId === 'object' ? scheduleBySubareaId : {};

    if (!this.selectedSubareaId && this.demoSubareas.length > 0) {
      this.selectedSubareaId = this.demoSubareas[0].id;
    }

    if (this.enabled) {
      this.updateFromSelectedSubarea();
    }
  }

  setSelectedSubarea(subareaId) {
    const id = String(subareaId || '').trim();
    if (!id) return;
    if (id === this.selectedSubareaId) return;
    this.selectedSubareaId = id;

    // Always ensure the NELC boundary is visible after subarea change
    if (this.enabled) {
      // Force boundary filter to always match NELC
      if (typeof this.setFilterFn === 'function') {
        this.setFilterFn((feature) => feature?.properties?.id === 'E06000012');
      }
      this.updateFromSelectedSubarea();
    }
  }

  getSelectedSubarea() {
    return this.demoSubareas.find((s) => s?.id === this.selectedSubareaId) || null;
  }

  pickNextFromSchedule(scheduleItems) {
    const items = Array.isArray(scheduleItems) ? scheduleItems : [];
    if (items.length === 0) return null;

    const now = new Date();
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (const it of items) {
      const iso = typeof it?.date === 'string' ? it.date.trim() : '';
      if (!iso) continue;
      const d = new Date(`${iso}T12:00:00Z`);
      if (Number.isNaN(d.getTime())) continue;
      const localDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (localDay >= todayMid) return it;
    }

    // If all are in the past (demo data), fall back to the last entry.
    return items[items.length - 1];
  }

  computeGeometryBounds(geometry) {
    if (!geometry || !geometry.type || !geometry.coordinates) return null;

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;

    const visit = (coords) => {
      if (!coords) return;
      if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        const lon = coords[0];
        const lat = coords[1];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        return;
      }
      if (Array.isArray(coords)) coords.forEach(visit);
    };

    if (geometry.type === 'Polygon') {
      visit(geometry.coordinates);
    } else if (geometry.type === 'MultiPolygon') {
      visit(geometry.coordinates);
    }

    if (!Number.isFinite(minLat) || !Number.isFinite(maxLat) || !Number.isFinite(minLon) || !Number.isFinite(maxLon)) return null;
    return { minLat, maxLat, minLon, maxLon };
  }

  setLabelAnchorFromBounds(bounds) {
    if (!bounds) return false;
    this.labelLatLon = {
      lat: (bounds.minLat + bounds.maxLat) / 2,
      lon: (bounds.minLon + bounds.maxLon) / 2
    };
    this.labelSpanDeg = Math.max(bounds.maxLat - bounds.minLat, bounds.maxLon - bounds.minLon);
    return true;
  }

  ensureLabelAnchor() {
    return this.labelLatLon;
  }

  ensureLabel(globeRenderer) {
    if (this.labelSprite) return this.labelSprite;

    const canvas = document.createElement('canvas');
    const logicalW = 260;
    const logicalH = 100;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = Math.max(1, Math.round(logicalW * dpr));
    canvas.height = Math.max(1, Math.round(logicalH * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    this.labelDpr = dpr;
    this.labelLogicalWidth = logicalW;
    this.labelLogicalHeight = logicalH;

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.35, 0.14, 1);
    sprite.frustumCulled = false;

    this.labelCanvas = canvas;
    this.labelCtx = ctx;
    this.labelTexture = texture;
    this.labelMaterial = material;
    this.labelSprite = sprite;

    globeRenderer.addObject(sprite);
    return sprite;
  }

  drawLabel({ areaText, weekdayText, streamText, colorHex }) {
    if (!this.labelCtx || !this.labelCanvas || !this.labelTexture) return;
    const ctx = this.labelCtx;
    const logicalW = this.labelLogicalWidth || 260;
    const logicalH = this.labelLogicalHeight || 100;
    const dpr = this.labelDpr || 1;
    const { width: physicalW, height: physicalH } = this.labelCanvas;

    // Clear at physical resolution, then draw in logical pixels.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, physicalW, physicalH);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = logicalW;
    const height = logicalH;

    // Panel
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.strokeStyle = 'rgba(0,255,102,0.65)';
    ctx.lineWidth = 2;
    const r = 12;
    ctx.beginPath();
    ctx.moveTo(r, 8);
    ctx.lineTo(width - r, 8);
    ctx.quadraticCurveTo(width - 8, 8, width - 8, r);
    ctx.lineTo(width - 8, height - r);
    ctx.quadraticCurveTo(width - 8, height - 8, width - r, height - 8);
    ctx.lineTo(r, height - 8);
    ctx.quadraticCurveTo(8, height - 8, 8, height - r);
    ctx.lineTo(8, r);
    ctx.quadraticCurveTo(8, 8, r, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Title
    ctx.font = '600 16px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
    ctx.fillStyle = 'rgba(214,214,214,0.85)';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('NEXT BIN', 16, 22);

    // Area (top right)
    const area = String(areaText || '').trim();
    if (area) {
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(179,245,255,0.85)';
      ctx.fillText(area, width - 16, 22);
      ctx.textAlign = 'left';
    }

    // Main date (Defcon-ish)
    ctx.font = '700 34px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
    ctx.fillStyle = 'rgba(0,255,102,0.95)';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(weekdayText || '—').toUpperCase(), 18, height / 2 + 2);

    // Colour swatch
    const swatchX = width - 62;
    const swatchY = height / 2;
    ctx.beginPath();
    ctx.arc(swatchX, swatchY, 16, 0, Math.PI * 2);
    ctx.fillStyle = colorHex ? `#${colorHex}` : 'rgba(255,255,255,0.15)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.stroke();

    // Stream (bottom)
    const stream = String(streamText || '').trim();
    if (stream) {
      ctx.font = '600 14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
      ctx.fillStyle = 'rgba(214,214,214,0.85)';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(stream, 16, height - 14);
    }

    this.labelTexture.needsUpdate = true;
  }

  updateLabelPosition() {
    if (!this._globe || !this.labelSprite) return;
    const anchor = this.ensureLabelAnchor();
    if (!anchor) return;
    const pos = latLongToVector3(anchor.lat, anchor.lon, LABEL_SURFACE_RADIUS);
    this.labelSprite.position.set(pos.x, pos.y, pos.z);

    // Keep the label a consistent ON-SCREEN size so it doesn't balloon when zooming.
    const cam = this._globe.camera;
    const vw = this._globe.width || this._globe.renderer?.domElement?.clientWidth || 1;
    const vh = this._globe.height || this._globe.renderer?.domElement?.clientHeight || 1;

    const z = this._globe?.controls?.getZoomFactor?.() ?? 1;
    // Smaller when zoomed out, bigger when zoomed in.
    // Use log-scale so it feels consistent across large zoom ranges (e.g. 2x → 40x).
    const z0 = 1.4;
    const z1 = 40;
    const logT = (Math.log(Math.max(z, 1e-6)) - Math.log(z0)) / (Math.log(z1) - Math.log(z0));
    const t = clamp(logT, 0, 1);
    const eased = Math.pow(t, 0.85);
    const desiredPxW = lerp(44, 220, eased);
    const aspect = (this.labelLogicalHeight ?? 100) / (this.labelLogicalWidth ?? 260);

    if (cam && vw > 1 && vh > 1) {
      const dist = cam.position.distanceTo(this.labelSprite.position);
      const fovRad = (cam.fov * Math.PI) / 180;
      const viewHeightWorld = 2 * dist * Math.tan(fovRad / 2);
      const viewWidthWorld = viewHeightWorld * cam.aspect;
      const worldW = viewWidthWorld * (desiredPxW / vw);
      this.labelSprite.scale.set(worldW, worldW * aspect, 1);
    }
  }

  updateLabelFromInfo(info) {
    if (!this._globe || !info?.next) return;
    if (!this.ensureLabelAnchor()) return;

    const next = info.next;
    const dateText = next?.date;
    let weekdayText = '—';
    let ddmmText = '--/--';
    if (dateText) {
      const d = new Date(`${dateText}T12:00:00Z`);
      if (!Number.isNaN(d.getTime())) {
        weekdayText = d.toLocaleDateString('en-GB', { weekday: 'short' });
        ddmmText = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
      }
    }

    const swatch = typeof next?.color === 'string' ? next.color.trim() : '';
    const colorHex = swatch.startsWith('#') ? swatch.slice(1) : swatch;

    this.ensureLabel(this._globe);
    this.drawLabel({
      areaText: info?.areaName || '',
      weekdayText: `${String(weekdayText || '—').toUpperCase()} ${ddmmText}`,
      streamText: next?.stream || '',
      colorHex: /^[0-9a-fA-F]{6}$/.test(colorHex) ? colorHex : null
    });
    this.updateLabelPosition();
  }

  updateFromSelectedSubarea() {
    const sa = this.getSelectedSubarea();
    if (!sa) return;

    const lat = Number(sa.lat);
    const lon = Number(sa.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      this.labelLatLon = { lat, lon };
      this._anchorReady = true;
    }

    const scheduleItems = this.demoScheduleBySubareaId?.[sa.id];
    const next = this.pickNextFromSchedule(scheduleItems);
    if (!next) return;

    const info = {
      council: 'North East Lincolnshire Council',
      areaName: sa.name,
      next: {
        date: next.date,
        stream: next.stream,
        color: next.color
      }
    };

    this.lastNext = info.next;

    const hex = parseHexColorString(info?.next?.color);
    if (hex != null) {
      this.setColor(hex);
    }

    this.updateLabelFromInfo(info);
  }

  enable(globeRenderer) {
    super.enable(globeRenderer);
    this._globe = globeRenderer;

    // Keep label pinned (including screen-size scaling) during zoom/pan.
    this._removeTick?.();
    this._removeTick = globeRenderer.addTickHandler(() => {
      if (!this.enabled || !this.labelSprite) return;
      this.updateLabelPosition();
    });

    // Compute fallback anchor (NELC LAD centroid) for safety.
    this.ensureDataLoaded()
      .then(() => {
        const feature = (this.boundaryData?.features || []).find((f) => f?.properties?.id === this.ladId);
        const ladBounds = feature?.geometry ? this.computeGeometryBounds(feature.geometry) : null;
        if (!this.setLabelAnchorFromBounds(ladBounds)) {
          // Fallback: Yorkshire & Humber bbox center
          this.setLabelAnchorFromBounds(YORKSHIRE_HUMBER_BOUNDS);
        }
        this._anchorReady = true;
        this.updateLabelPosition();
      })
      .catch(() => {
        // Fallback: Yorkshire & Humber bbox center
        this.setLabelAnchorFromBounds(YORKSHIRE_HUMBER_BOUNDS);
        this._anchorReady = true;
        this.updateLabelPosition();
      })
      .finally(() => {
        // If demo data is already available, render immediately.
        this.updateFromSelectedSubarea();
      });
  }

  disable(globeRenderer) {
    super.disable(globeRenderer);
    this._globe = null;

    this._removeTick?.();
    this._removeTick = null;

    if (this.labelSprite) globeRenderer.removeObject(this.labelSprite);
    this.labelSprite = null;
    this.labelMaterial?.dispose?.();
    this.labelTexture?.dispose?.();
    this.labelMaterial = null;
    this.labelTexture = null;
    this.labelCanvas = null;
    this.labelCtx = null;
    this.labelDpr = 1;
    this.labelLogicalWidth = 260;
    this.labelLogicalHeight = 100;
    this.labelLatLon = null;
    this.labelSpanDeg = null;
  }

  refresh(globeRenderer) {
    super.refresh(globeRenderer);
  }
}
