 /**
 * Application boot sequence:
 *
 * 1. Create GlobeRenderer
 * 2. Initialise renderer and camera
 * 3. Create LayerManager
 * 4. Register core layers
 * 5. Enable boundary layer
 * 6. Initialise UI
 */

import { GlobeRenderer } from './globe/GlobeRenderer.js';
import { LayerManager } from './layers/LayerManager.js';
import { BoundaryLayer } from './layers/BoundaryLayer.js';
import { NaturalEarthPointsZipLayer } from './layers/NaturalEarthPointsZipLayer.js';
import { NaturalEarthPopulatedPlacesLayer } from './layers/NaturalEarthPopulatedPlacesLayer.js';
import { NelcBinDemoLayer } from './layers/NelcBinDemoLayer.js';
import { SelectionHighlight } from './layers/SelectionHighlight.js';
import { LayersPanel } from './ui/LayersPanel.js';
import { BinPanel } from './ui/BinPanel.js';

const assetUrl = (relativePath) => new URL(relativePath, window.location.href).toString();

const container = document.getElementById('globe-container');
if (!container) {
  throw new Error('Missing #globe-container');
}

const globe = new GlobeRenderer(container);
globe.init();

// FPS overlay (centered below top bar)
const fpsEl = document.getElementById('fps');
let fpsEma = null;
let fpsLastUiUpdateMs = 0;
const settingsBtn = document.getElementById('settingsBtn');
const settingsMinBtn = document.getElementById('settingsMinBtn');
const settingsPanel = document.getElementById('settings-panel');
const toggleFpsCheckbox = document.getElementById('toggleFps');
const sparkleBtn = document.getElementById('sparkleBtn');

const SETTINGS_STORAGE_KEY = 'sm-settings-v1';
const defaultSettings = {
  showFps: false
};

const loadSettings = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw);
    return {
      ...defaultSettings,
      showFps: Boolean(parsed.showFps)
    };
  } catch {
    return { ...defaultSettings };
  }
};

const settingsState = loadSettings();

const persistSettings = () => {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settingsState));
  } catch {
    // ignore persistence errors (private mode, quota, etc.)
  }
};

const applyFpsVisibility = () => {
  if (!fpsEl) return;
  fpsEl.style.display = settingsState.showFps ? 'block' : 'none';
  if (!settingsState.showFps) {
    fpsEl.textContent = '';
  }
  persistSettings();
};


globe.addTickHandler(({ nowMs, deltaMs }) => {
  if (!fpsEl || !settingsState.showFps) return;
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;

  const instFps = 1000 / deltaMs;
  // Exponential moving average to reduce jitter.
  fpsEma = fpsEma == null ? instFps : fpsEma * 0.9 + instFps * 0.1;

  // Avoid spamming DOM updates.
  if (nowMs - fpsLastUiUpdateMs < 250) return;
  fpsLastUiUpdateMs = nowMs;

  fpsEl.textContent = `FPS: ${fpsEma.toFixed(1)}`;
});

if (settingsBtn && settingsPanel) {
  settingsBtn.addEventListener('click', () => {
    const isHidden = settingsPanel.hasAttribute('hidden');
    if (isHidden) {
      settingsPanel.removeAttribute('hidden');
    } else {
      settingsPanel.setAttribute('hidden', '');
    }
  });
}

if (settingsMinBtn && settingsPanel) {
  settingsMinBtn.addEventListener('click', () => {
    settingsPanel.setAttribute('hidden', '');
  });
}

if (toggleFpsCheckbox) {
  toggleFpsCheckbox.checked = settingsState.showFps;
  toggleFpsCheckbox.addEventListener('change', () => {
    settingsState.showFps = Boolean(toggleFpsCheckbox.checked);
    applyFpsVisibility();
  });
}


if (sparkleBtn) {
  sparkleBtn.addEventListener('click', () => {
    globe.sparkleStar();
  });
}

// Temporarily hide the title when a control that may open a native dropdown is focused,
// to avoid the title visually overlapping native dropdown popups on some platforms.
(() => {
  const controls = document.querySelector('.controls');
  if (!controls) return;
  const focusable = controls.querySelectorAll('select, input, button');

  function setOpen(open) {
    if (open) document.documentElement.classList.add('select-open');
    else document.documentElement.classList.remove('select-open');
  }

  focusable.forEach((el) => {
    el.addEventListener('focus', () => setOpen(true));
    el.addEventListener('blur', () => setOpen(false));
    // Some browsers open the native dropdown on mousedown; treat that as open.
    el.addEventListener('mousedown', () => setOpen(true));
  });

  // Also clear state when clicking elsewhere
  document.addEventListener('pointerdown', (ev) => {
    if (!controls.contains(ev.target)) setOpen(false);
  });
})();



applyFpsVisibility();

// Status overlay helpers (used by layers during async loads)
const statusEl = document.getElementById('status');
let statusToken = 0;
let statusClearTimer = null;

const setStatus = (text, { ttlMs = 0 } = {}) => {
  statusToken += 1;
  const token = statusToken;

  if (statusClearTimer) {
    clearTimeout(statusClearTimer);
    statusClearTimer = null;
  }

  if (statusEl) {
    statusEl.textContent = String(text || '').trim();
  }

  if (ttlMs > 0) {
    statusClearTimer = setTimeout(() => {
      if (token !== statusToken) return;
      if (statusEl) statusEl.textContent = '';
    }, ttlMs);
  }

  return token;
};

const clearStatus = (token) => {
  if (!token || token !== statusToken) return;
  if (statusClearTimer) {
    clearTimeout(statusClearTimer);
    statusClearTimer = null;
  }
  if (statusEl) statusEl.textContent = '';
};

// Attach to renderer so layers can call globe.setStatus()/globe.clearStatus().
globe.setStatus = setStatus;
globe.clearStatus = clearStatus;

// Selection highlight overlay (brief glow on selection)
const selectionHighlight = new SelectionHighlight(globe);
globe.addTickHandler(({ nowMs }) => selectionHighlight.tick(nowMs));

// UK polygon mask (more accurate than a bounding box; excludes Ireland/nearby waters).
let ukContainsLatLon = null;

// Helper to decide if a Natural Earth feature belongs to the UK (adm0 code + optional polygon/bounds fallback).
const isUkFeature = (feature, lat, lon) => {
  const props = feature?.properties || {};
  const code = (props.ADM0_A3 || props.adm0_a3 || props.ADM0_A3_USD || props.ISO_A2 || props.iso_a2 || '').toString().toUpperCase();
  const isUkCode = ['GBR', 'UK', 'GB', 'IMN', 'GGY', 'JEY'].includes(code);

  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
  const b = UK_BOUNDS.UK;
  const withinBox = hasCoords && lat >= b.minLat - 1 && lat <= b.maxLat + 1 && lon >= b.minLon - 1 && lon <= b.maxLon + 1;
  const withinPoly = hasCoords && ukContainsLatLon ? ukContainsLatLon(lat, lon) : false;

  // Accept if any of: polygon hit, UK-ish bbox, or country code matches UK.
  return withinPoly || withinBox || isUkCode;
};

function pointInRing(lon, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]?.[0];
    const yi = ring[i]?.[1];
    const xj = ring[j]?.[0];
    const yj = ring[j]?.[1];
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) continue;

    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

function pointInPolygon(lon, lat, polygonRings) {
  if (!Array.isArray(polygonRings) || polygonRings.length === 0) return false;
  const outer = polygonRings[0];
  if (!pointInRing(lon, lat, outer)) return false;
  for (let i = 1; i < polygonRings.length; i++) {
    if (pointInRing(lon, lat, polygonRings[i])) return false;
  }
  return true;
}

function pointInMultiPolygon(lon, lat, multiPolygonCoords) {
  if (!Array.isArray(multiPolygonCoords)) return false;
  for (const polygonRings of multiPolygonCoords) {
    if (pointInPolygon(lon, lat, polygonRings)) return true;
  }
  return false;
}

function buildUkContainsFn(geojson) {
  const feature = geojson?.features?.[0];
  const geom = feature?.geometry;
  if (!geom) return null;

  if (geom.type === 'Polygon') {
    const coords = geom.coordinates;
    return (lat, lon) => pointInPolygon(lon, lat, coords);
  }
  if (geom.type === 'MultiPolygon') {
    const coords = geom.coordinates;
    return (lat, lon) => pointInMultiPolygon(lon, lat, coords);
  }
  return null;
}

const UK_COUNTRY_ID_BY_CODE = {
  ENG: 'E92000001',
  NIR: 'N92000002',
  SCT: 'S92000003',
  WLS: 'W92000004'
};

// UK focus data (rough bounding boxes; refine later)
const UK_BOUNDS = {
  UK: { minLat: 49.8, maxLat: 60.9, minLon: -8.6, maxLon: 2.1 },
  ENG: { minLat: 49.8, maxLat: 55.9, minLon: -6.6, maxLon: 1.9 },
  SCT: { minLat: 54.6, maxLat: 60.9, minLon: -8.3, maxLon: -0.7 },
  WLS: { minLat: 51.3, maxLat: 53.5, minLon: -5.6, maxLon: -2.6 },
  NIR: { minLat: 54.0, maxLat: 55.3, minLon: -8.2, maxLon: -5.4 }
};

const UK_REGIONS = {
  UK: [
    { id: 'UK_ALL', name: 'All regions', bounds: UK_BOUNDS.UK },
    { id: 'ENG', name: 'England', bounds: UK_BOUNDS.ENG },
    { id: 'SCT', name: 'Scotland', bounds: UK_BOUNDS.SCT },
    { id: 'WLS', name: 'Wales', bounds: UK_BOUNDS.WLS },
    { id: 'NIR', name: 'Northern Ireland', bounds: UK_BOUNDS.NIR },
    { id: 'ENG_NE', name: 'North East (Eng)', bounds: { minLat: 54.5, maxLat: 55.8, minLon: -2.7, maxLon: -0.8 } },
    { id: 'ENG_NW', name: 'North West (Eng)', bounds: { minLat: 53.3, maxLat: 55.3, minLon: -3.7, maxLon: -2.0 } },
    { id: 'ENG_YH', name: 'Yorkshire & Humber', bounds: { minLat: 53.3, maxLat: 54.6, minLon: -2.6, maxLon: 0.4 } },
    { id: 'ENG_EM', name: 'East Midlands', bounds: { minLat: 52.7, maxLat: 53.6, minLon: -1.8, maxLon: 0.6 } },
    { id: 'ENG_WM', name: 'West Midlands', bounds: { minLat: 52.3, maxLat: 53.4, minLon: -3.3, maxLon: -1.5 } },
    { id: 'ENG_EE', name: 'East of England', bounds: { minLat: 51.4, maxLat: 53.1, minLon: -0.8, maxLon: 1.8 } },
    { id: 'ENG_LON', name: 'London', bounds: { minLat: 51.28, maxLat: 51.7, minLon: -0.55, maxLon: 0.3 } },
    { id: 'ENG_SE', name: 'South East (Eng)', bounds: { minLat: 50.6, maxLat: 52.2, minLon: -1.8, maxLon: 1.9 } },
    { id: 'ENG_SW', name: 'South West (Eng)', bounds: { minLat: 49.8, maxLat: 51.6, minLon: -6.5, maxLon: -2.0 } }
  ],
  ENG: [
    { id: 'ENG_ALL', name: 'All regions', bounds: UK_BOUNDS.ENG },
    { id: 'ENG_NE', name: 'North East', bounds: { minLat: 54.5, maxLat: 55.8, minLon: -2.7, maxLon: -0.8 } },
    { id: 'ENG_NW', name: 'North West', bounds: { minLat: 53.3, maxLat: 55.3, minLon: -3.7, maxLon: -2.0 } },
    { id: 'ENG_YH', name: 'Yorkshire & Humber', bounds: { minLat: 53.3, maxLat: 54.6, minLon: -2.6, maxLon: 0.4 } },
    { id: 'ENG_EM', name: 'East Midlands', bounds: { minLat: 52.7, maxLat: 53.6, minLon: -1.8, maxLon: 0.6 } },
    { id: 'ENG_WM', name: 'West Midlands', bounds: { minLat: 52.3, maxLat: 53.4, minLon: -3.3, maxLon: -1.5 } },
    { id: 'ENG_EE', name: 'East of England', bounds: { minLat: 51.4, maxLat: 53.1, minLon: -0.8, maxLon: 1.8 } },
    { id: 'ENG_LON', name: 'London', bounds: { minLat: 51.28, maxLat: 51.7, minLon: -0.55, maxLon: 0.3 } },
    { id: 'ENG_SE', name: 'South East', bounds: { minLat: 50.6, maxLat: 52.2, minLon: -1.8, maxLon: 1.9 } },
    { id: 'ENG_SW', name: 'South West', bounds: { minLat: 49.8, maxLat: 51.6, minLon: -6.5, maxLon: -2.0 } }
  ],
  SCT: [
    { id: 'SCT_ALL', name: 'All regions', bounds: UK_BOUNDS.SCT },
    { id: 'SCT_HI', name: 'Highlands & Islands', bounds: { minLat: 56.7, maxLat: 60.9, minLon: -8.3, maxLon: -1.4 } },
    { id: 'SCT_NE', name: 'North East', bounds: { minLat: 56.3, maxLat: 58.9, minLon: -3.8, maxLon: -1.3 } },
    { id: 'SCT_CB', name: 'Central Belt', bounds: { minLat: 55.2, maxLat: 56.35, minLon: -5.8, maxLon: -2.2 } },
    { id: 'SCT_S', name: 'South Scotland', bounds: { minLat: 54.6, maxLat: 55.6, minLon: -5.2, maxLon: -1.8 } }
  ],
  WLS: [
    { id: 'WLS_ALL', name: 'All regions', bounds: UK_BOUNDS.WLS },
    { id: 'WLS_N', name: 'North Wales', bounds: { minLat: 52.9, maxLat: 53.5, minLon: -4.9, maxLon: -2.8 } },
    { id: 'WLS_M', name: 'Mid Wales', bounds: { minLat: 52.0, maxLat: 53.1, minLon: -4.6, maxLon: -3.0 } },
    { id: 'WLS_SW', name: 'South West Wales', bounds: { minLat: 51.35, maxLat: 52.2, minLon: -5.6, maxLon: -3.7 } },
    { id: 'WLS_SE', name: 'South East Wales', bounds: { minLat: 51.35, maxLat: 52.25, minLon: -3.7, maxLon: -2.5 } }
  ],
  NIR: [
    { id: 'NIR_ALL', name: 'All regions', bounds: UK_BOUNDS.NIR },
    { id: 'NIR_BFS', name: 'Belfast', bounds: { minLat: 54.55, maxLat: 54.67, minLon: -6.05, maxLon: -5.85 } },
    { id: 'NIR_N', name: 'North', bounds: { minLat: 54.75, maxLat: 55.35, minLon: -7.7, maxLon: -5.4 } },
    { id: 'NIR_W', name: 'West', bounds: { minLat: 54.1, maxLat: 54.85, minLon: -8.2, maxLon: -6.7 } },
    { id: 'NIR_E', name: 'East', bounds: { minLat: 54.1, maxLat: 54.9, minLon: -6.7, maxLon: -5.4 } },
    { id: 'NIR_S', name: 'South', bounds: { minLat: 54.0, maxLat: 54.55, minLon: -7.7, maxLon: -5.75 } }
  ]
};

const countrySelect = document.getElementById('countrySelect');
const regionSelect = document.getElementById('regionSelect');
const ladInput = document.getElementById('ladInput');
const ladDatalist = document.getElementById('ladOptions');

let ladIndex = [];

function populateRegions(countryCode) {
  if (!regionSelect) return;
  const regions = UK_REGIONS[countryCode] || UK_REGIONS.UK;
  regionSelect.innerHTML = '';
  regions.forEach((r) => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    opt.dataset.minLat = String(r.bounds.minLat);
    opt.dataset.maxLat = String(r.bounds.maxLat);
    opt.dataset.minLon = String(r.bounds.minLon);
    opt.dataset.maxLon = String(r.bounds.maxLon);
    regionSelect.appendChild(opt);
  });
}

function boundsFromOption(optEl) {
  if (!optEl) return null;
  const minLat = Number(optEl.dataset.minLat);
  const maxLat = Number(optEl.dataset.maxLat);
  const minLon = Number(optEl.dataset.minLon);
  const maxLon = Number(optEl.dataset.maxLon);
  if ([minLat, maxLat, minLon, maxLon].some((n) => Number.isNaN(n))) return null;
  return { minLat, maxLat, minLon, maxLon };
}

function focusBounds(bounds) {
  if (!globe.controls) return;
  globe.controls.focusOn(bounds);
}

function geometryBounds(geometry) {
  if (!geometry || !geometry.type || !geometry.coordinates) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  const visit = (coords) => {
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

function renderLadOptions() {
  if (!ladDatalist) return;
  ladDatalist.innerHTML = '';
  ladIndex.forEach((item) => {
    const option = document.createElement('option');
    option.value = `${item.name} (${item.id})`;
    ladDatalist.appendChild(option);
  });
}

function selectLad(value) {
  if (!value) return;
  const match = ladIndex.find((item) => value === `${item.name} (${item.id})` || value === item.name || value === item.id);
  if (match && match.bounds) {
    focusBounds(match.bounds);

    selectionHighlight
      .flashGeoJsonFeature({
        dataUrl: assetUrl('src/data/uk-local-authority-districts.json'),
        matchFn: (f) => f?.properties?.id === match.id,
        color: 0x00ff66,
        durationMs: 300
      })
      .catch(() => {});
  }
}

async function loadLads() {
  try {
    const resp = await fetch(assetUrl('src/data/uk-local-authority-districts.json'));
    const data = await resp.json();
    ladIndex = (data.features || []).map((feature) => {
      const props = feature.properties || {};
      const name = (props.name || '').trim() || props.id || 'Unknown LAD';
      return {
        id: props.id,
        name,
        bounds: geometryBounds(feature.geometry)
      };
    });
    renderLadOptions();
  } catch (err) {
    console.warn('Failed to load LAD index', err);
  }
}

if (countrySelect) {
  countrySelect.addEventListener('change', () => {
    const code = countrySelect.value || 'UK';
    populateRegions(code);
    focusBounds(UK_BOUNDS[code] || UK_BOUNDS.UK);

    const countryId = UK_COUNTRY_ID_BY_CODE[code];
    if (countryId) {
      selectionHighlight
        .flashGeoJsonFeature({
          dataUrl: assetUrl('src/data/uk-regions.json'),
          matchFn: (f) => f?.properties?.id === countryId,
          color: 0xb3f5ff,
          durationMs: 300
        })
        .catch(() => {});
    } else {
      selectionHighlight.flashBounds(UK_BOUNDS[code] || UK_BOUNDS.UK, {
        color: 0xb3f5ff,
        durationMs: 300
      });
    }
  });
}

if (regionSelect) {
  regionSelect.addEventListener('change', () => {
    const opt = regionSelect.options[regionSelect.selectedIndex];
    const bounds = boundsFromOption(opt);
    if (bounds) {
      focusBounds(bounds);
      globe.controls?.ensureZoomAtLeast?.(6.0);
    }

    const regionName = opt?.textContent?.trim();

    // Try true region boundaries (if english-regions.json is populated); otherwise fall back to bounds box.
    selectionHighlight
      .flashGeoJsonFeature({
        dataUrl: assetUrl('src/data/english-regions.json'),
        matchFn: (f) => {
          const props = f?.properties || {};
          const name = (props.name || '').trim();
          return regionName && name.toLowerCase() === regionName.toLowerCase();
        },
        color: 0x00ff66,
        durationMs: 300
      })
      .catch(() => {
        if (bounds) {
          selectionHighlight.flashBounds(bounds, {
            color: 0x00ff66,
            durationMs: 300
          });
        }
      });
  });
}

if (ladInput) {
  ladInput.addEventListener('change', () => selectLad(ladInput.value));
  ladInput.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') selectLad(ladInput.value);
  });
}

// Init dropdown state
populateRegions(countrySelect?.value || 'UK');
focusBounds(UK_BOUNDS.UK);
loadLads();

// Layers
const layerManager = new LayerManager(globe);

// Kick off the UK polygon fetch early; refresh point layers once it’s ready.
fetch(assetUrl('src/data/uk-boundaries.json'))
  .then((r) => (r.ok ? r.json() : null))
  .then((json) => {
    const fn = buildUkContainsFn(json);
    if (fn) ukContainsLatLon = fn;
  })
  .finally(() => {
    // If the user enabled any point layers before the mask was ready, refresh them now.
    for (const id of ['ne-airports-uk', 'ne-ports-uk', 'ne-populated-places-uk']) {
      if (layerManager.isEnabled(id)) layerManager.refreshLayer(id);
    }
  });

const worldLayer = new BoundaryLayer({
  id: 'world-boundaries',
  name: 'World (countries)',
  dataUrl: assetUrl('src/data/world-countries.json'),
  color: 0x4a4a4a
});

const ukRegionsLayer = new BoundaryLayer({
  id: 'uk-regions',
  name: 'UK regions',
  dataUrl: assetUrl('src/data/uk-regions.json'),
  color: 0x6ad4ff
});

const ukLocalAuthoritiesLayer = new BoundaryLayer({
  id: 'uk-lad',
  name: 'UK local councils (LAD)',
  dataUrl: assetUrl('src/data/uk-local-authority-districts.json'),
  color: 0xffb020
});

const nelcBinDemoLayer = new NelcBinDemoLayer({
  id: 'bin-demo-nelc',
  name: 'Bin collection (demo: NELC)',
  dataUrl: assetUrl('src/data/uk-local-authority-districts.json'),
  postcode: 'DN32 0NE',
  ladId: 'E06000012',
  // Start red until we successfully fetch schedule colour.
  color: 0xff4d4d
});

const airportsLayer = new NaturalEarthPointsZipLayer({
  id: 'ne-airports-uk',
  name: 'Airports (UK)',
  zipUrl: assetUrl('src/data-src/ne_10m_airports.zip'),
  bounds: UK_BOUNDS.UK,
  filterFeature: (feature) => {
    const coords = feature?.geometry?.coordinates;
    const lon = coords?.[0];
    const lat = coords?.[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    return isUkFeature(feature, lat, lon);
  },
  color: 0x39d5ff,
  iconSvgUrl: 'https://unpkg.com/heroicons@2.1.5/24/outline/paper-airplane.svg',
  pointSizePx: 24,
  opacity: 0.95,
  maxPoints: 8000
});

const portsLayer = new NaturalEarthPointsZipLayer({
  id: 'ne-ports-uk',
  name: 'Ports (UK)',
  zipUrl: assetUrl('src/data-src/ne_10m_ports.zip'),
  bounds: UK_BOUNDS.UK,
  filterFeature: (feature) => {
    const coords = feature?.geometry?.coordinates;
    const lon = coords?.[0];
    const lat = coords?.[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    return isUkFeature(feature, lat, lon);
  },
  color: 0xffbf3b,
  iconSvgUrl: 'https://unpkg.com/heroicons@2.1.5/24/outline/lifebuoy.svg',
  pointSizePx: 24,
  opacity: 0.95,
  maxPoints: 8000
});

const populatedPlacesLayer = new NaturalEarthPopulatedPlacesLayer({
  id: 'ne-populated-places-uk',
  name: 'Populated places (UK)',
  // Use the pre-filtered UK GeoJSON (v1) to avoid downloading the global ZIP
  geojsonUrl: assetUrl('src/data/uk-populated-places.v1.json'),
  bounds: UK_BOUNDS.UK,
  filterFeature: (feature) => {
    const coords = feature?.geometry?.coordinates;
    const lon = coords?.[0];
    const lat = coords?.[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    return isUkFeature(feature, lat, lon);
  },
  maxScaleRank: 10,
  maxLabels: 720,
  labelFontPx: 14,
  labelMaxPxW: 160
});

layerManager.register(worldLayer);
layerManager.register(ukRegionsLayer);
layerManager.register(ukLocalAuthoritiesLayer);
layerManager.register(airportsLayer);
layerManager.register(portsLayer);
layerManager.register(populatedPlacesLayer);
layerManager.register(nelcBinDemoLayer);
layerManager.enableLayer('world-boundaries');
layerManager.enableLayer('uk-regions');

const panelEl = document.getElementById('layers-panel');
const binPanelEl = document.getElementById('bin-panel');
const binPanel = binPanelEl ? new BinPanel(binPanelEl, { layer: nelcBinDemoLayer }) : null;
binPanel?.init?.();

if (panelEl) {
  const panel = new LayersPanel(panelEl, layerManager, {
    onToggle: (layerId, enabled) => {
      if (layerId === 'bin-demo-nelc') {
        if (enabled) binPanel?.show?.();
        else binPanel?.hide?.();
      }
    }
  });
  panel.init();
}

if (layerManager.isEnabled('bin-demo-nelc')) {
  binPanel?.show?.();
}

// Zoom indicator + zoom-responsive label density for populated places
const zoomLabel = document.getElementById('zoomLevel');
const updateZoomUi = () => {
  if (!globe.controls) return;
  const factor = globe.controls.getZoomFactor();
  if (zoomLabel) zoomLabel.textContent = `${factor.toFixed(1)}x`;
  populatedPlacesLayer?.updateDensityForZoom?.(factor);
};
if (globe.controls) {
  globe.controls.onChange = updateZoomUi;
  updateZoomUi();
}

// PWA: register service worker
if ('serviceWorker' in navigator) {
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const isHttps = window.location.protocol === 'https:';
  if (isHttps || isLocalhost) {
    navigator.serviceWorker.register(assetUrl('service-worker.js')).catch((err) => {
      console.warn('Service worker registration failed', err);
    });
  }
}

// Temporary wiring for top bar buttons
document.getElementById('resetBtn')?.addEventListener('click', () => {
  globe.resetView();
  if (countrySelect) countrySelect.value = 'UK';
  populateRegions('UK');
  if (regionSelect && regionSelect.options.length > 0) regionSelect.selectedIndex = 0;
  focusBounds(UK_BOUNDS.UK);
});
document.getElementById('zoomInBtn')?.addEventListener('click', () => globe.zoomIn());
document.getElementById('zoomOutBtn')?.addEventListener('click', () => globe.zoomOut());
