# [WIP] Situation Monitor PWA

A personal, installable PWA for situational awareness.

This project is a situational awareness console inspired by strategic command‑center 
interfaces (e.g. Defcon). The goal is to consolidate signals — not stories — into a
calm, focused UI that helps users understand what is happening in a chosen region.

---

## Core Principles

- **Architect globally, filter locally** — designed to work anywhere; users select a country or region
  to focus on (initial development focuses on the United Kingdom).
- **Separation of concerns** — core logic is independent of data sources; layers/sensors can be
  added or removed without touching the core.
- **Signal over noise** — motion, colour, and alerts are meaningful; avoid clutter and addictive
  interfaces.
- **Offline‑first, low‑cost** — installable PWA, local storage where possible, minimal backend usage.

---

## Run (web)

From `apps/web`:

```
http-server -c 30 .
```

Open the printed localhost URL.

## Bin collection demo (NELC)

The demo bin layer uses North East Lincolnshire Council (NELC) and postcode `DN32 0NE`.

To enable it locally:

- Start the local proxy: `node ./apps/web/dev/nelc-proxy.mjs`
- In the app, enable the layer **“Bin collection (demo: Yorkshire & Humber / NELC)”**

More details: [apps/web/dev/README-nelc-proxy.md](apps/web/dev/README-nelc-proxy.md)

---

## Status

Work in progress — early architecture and UI exploration. No live data sources enabled by default.
<<<<<<< HEAD

# [WIP] Situation Monitor PWA

A personal, installable PWA for situational awareness.

This project is **not a news app**.
It is a **situational awareness console** inspired by strategic command‑center interfaces (e.g. Defcon).

The goal is to consolidate signals — not stories — into a calm, focused UI that helps users understand what is happening in a chosen region.

---

## Core Principles

- **Architect globally, filter locally**

  - The system is designed to work anywhere in the world.
  - Users select a country or region to focus on.
  - Initial development and testing focuses on the United Kingdom.

- **Separation of concerns**

  - Core logic is independent of data sources.
  - Sensors (layers) can be added or removed without touching the core.
  - Rendering (2D map, future 3D globe) is interchangeable.

- **Signal over noise**

  - Motion, colour, and alerts are meaningful.
  - No clutter, no infinite scrolling, no dopamine loops.

- **Offline‑first, low‑cost**
  - Installable PWA.
  - Local storage where possible.
  - Minimal backend usage.

---

## MVP Scope

The initial MVP focuses on:

- A **2D map renderer** (UK‑focused)
- Fake/test data only
- Layer toggling (air, weather, events)
- Floating and dockable information panels
- Pause and snapshot concepts
- Defcon‑style dark UI

A 3D globe is a **future enhancement**, not an MVP requirement.

---

## What This Is Not

- Not a social network
- Not a breaking‑news feed
- Not a surveillance tool
- Not a real‑time intelligence platform (yet)

---

## Technology (Initial)

- PWA (installable)
- Vite
- Tailwind CSS + DaisyUI
- JavaScript / TypeScript
- Local storage (IndexedDB)
- Minimal serverless proxy (later)

---

## Status

Work in progress.
Early architecture and UI exploration phase.
No live data sources yet.
=======

# Situation Monitor PWA

## Run (web)

From `apps/web`:

- `http-server -c 30 .`

Open the printed localhost URL.

## Bin collection demo (NELC)

The demo bin layer uses North East Lincolnshire Council (NELC) and postcode `DN32 0NE`.

To enable it locally:

- Start the local proxy: `node ./apps/web/dev/nelc-proxy.mjs`
- In the app, enable the layer **“Bin collection (demo: Yorkshire & Humber / NELC)”**

More details: [apps/web/dev/README-nelc-proxy.md](apps/web/dev/README-nelc-proxy.md)

> > > > > > > 82352f4 (Initial project upload)
