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
