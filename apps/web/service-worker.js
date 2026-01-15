const CACHE_VERSION = 'v39';
const STATIC_CACHE = `situation-static-${CACHE_VERSION}`;

const SCOPE = self.registration?.scope || self.location.origin + '/';

const ASSETS = [
	'./',
	'index.html',
	'styles.css',
	'manifest.webmanifest',
	'src/main.js',
	'src/globe/GlobeRenderer.js',
	'src/globe/Starfield.js',
	'src/globe/CameraController.js',
	'src/globe/latLong.js',
	'src/layers/LayerManager.js',
	'src/layers/BaseLayer.js',
	'src/layers/BoundaryLayer.js',
	'src/layers/FilteredBoundaryLayer.js',
	'src/layers/NaturalEarthPointsZipLayer.js',
	'src/layers/NaturalEarthPopulatedPlacesLayer.js',
	'src/layers/NelcBinDemoLayer.js',
	'src/layers/SelectionHighlight.js',
	'src/ui/LayersPanel.js',
	'src/ui/BinPanel.js',
	'src/bin/nelcAdapter.js',
	'src/data/uk-boundaries.json',
	'src/data/uk-populated-places-10m.json',
	'src/data/world-countries.json',
	'src/data/uk-regions.json',
	'src/data/english-regions.json',
	'src/data/uk-local-authority-districts.json',
	'src/data/nelc-demo-subareas.json',
	'src/data/nelc-demo-collections-5ahead.json',
	'icons/app-icon.svg'
].map((p) => new URL(p, SCOPE).toString());

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(STATIC_CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(
				keys
					.filter((key) => key.startsWith('situation-static-') && key !== STATIC_CACHE)
					.map((key) => caches.delete(key))
			)
		).then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);
	const isSameOrigin = url.origin === self.location.origin;

	// Only handle GET
	if (request.method !== 'GET') return;

	// Never cache API responses or requests with query params (often user-specific)
	if (isSameOrigin && (url.pathname.startsWith('/api/') || url.search)) {
		event.respondWith(fetch(request));
		return;
	}

	// Avoid caching authenticated requests if they ever get introduced
	if (request.headers.get('authorization')) {
		event.respondWith(fetch(request));
		return;
	}

	// Only cache same-origin assets and a small allowlist of third-party modules.
	const CACHEABLE_THIRD_PARTY_ORIGINS = new Set(['https://unpkg.com']);
	if (!isSameOrigin && !CACHEABLE_THIRD_PARTY_ORIGINS.has(url.origin)) {
		event.respondWith(fetch(request));
		return;
	}

	// Avoid caching large dataset archives (storage bloat). These remain fetch-only.
	if (isSameOrigin) {
		const path = url.pathname || '';
		if (path.endsWith('.zip') || path.includes('/src/data-src/')) {
			event.respondWith(fetch(request));
			return;
		}
	}

	// Cache-first for app shell and assets
	event.respondWith(
		caches.match(request).then((cached) => {
			if (cached) return cached;

			return fetch(request)
				.then((response) => {
					if (!response || !response.ok) return response;

					// Runtime cache same-origin + allowlisted third-party modules.
					const copy = response.clone();
					caches
						.open(STATIC_CACHE)
						.then((cache) => cache.put(request, copy))
						.catch(() => {});
					return response;
				})
				.catch(() => {
					// Fallback to cached shell for navigation
					if (request.mode === 'navigate') {
						return caches.match(new URL('index.html', SCOPE).toString());
					}
				});
		})
	);
});
