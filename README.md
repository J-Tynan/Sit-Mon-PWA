# [WIP] Situation Monitor PWA

A personal, installable PWA for situational awareness.

This project is a situational awareness console inspired by strategic command‑center
interfaces (e.g. Defcon). The goal is to consolidate signals into a calm,
focused UI that helps users understand what is happening in a chosen region.

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
