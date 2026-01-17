\# Situation Monitor PWA



A personal, installable Progressive Web App for calm, focused situational awareness.



Situation Monitor is a modular geospatial console inspired by strategic command‑center

interfaces (e.g. \*Defcon\*). It consolidates geographic and contextual signals into a

low‑noise, map‑centric UI that helps users understand what is happening in a chosen

country or region.



Initial development focuses on the United Kingdom, but the architecture is designed

to scale globally.



---



\## Live demo (static data)



https://j-tynan.github.io/Sit-Mon-PWA/



---



\## Core principles



\- \*\*Architect globally, filter locally\*\*  

&nbsp; Data is sourced at global or national scale, then filtered client‑side to the

&nbsp; user’s selected country or region.



\- \*\*Separation of concerns\*\*  

&nbsp; Rendering, data loading, filtering, and UI are cleanly separated. Layers can be

&nbsp; added, removed, or replaced without touching core logic.



\- \*\*Signal over noise\*\*  

&nbsp; Motion, colour, labels, and density are meaningful. The UI avoids clutter,

&nbsp; gamification, and addictive interaction patterns.



\- \*\*Offline‑first, low‑cost\*\*  

&nbsp; Designed as an installable PWA with static assets, local caching, and minimal

&nbsp; backend requirements.



---



\## Current features



\- Interactive 3D globe renderer

\- World and UK administrative boundaries

\- UK populated places with zoom‑responsive label density

\- UK airports and ports (Natural Earth)

\- UK local authority districts (ONS Open Geography)

\- Demo bin‑collection layer (NELC)

\- Region and council search with animated focus

\- Layer toggling and lightweight settings panel

\- Fully static deployment (GitHub Pages compatible)



---



\## Data sources



\- \*\*ONS Open Geography\*\* — UK administrative boundaries

\- \*\*Natural Earth\*\* — world boundaries, populated places, airports, ports

\- \*\*NELC\*\* — bin collection demo data

\- \*\*Heroicons\*\* — UI icons



---



\## Data pipelines



All geospatial data is processed into production‑ready assets before being loaded

by the app. This keeps runtime logic simple and performance predictable.



\### UK Local Authority Districts (LAD)



\- Source: ONS Open Geography GeoJSON

\- Processed with Mapshaper

\- Simplified and exported as TopoJSON

\- Output: `src/data/uk-lads.v1.topo.json`



\### UK Populated Places



\- Source: Natural Earth populated places

\- Filtered to UK only

\- Properties trimmed to required fields

\- Converted to TopoJSON with stable object naming

\- Output: `src/data/uk-populated-places.v2.topo.json`



This significantly reduces payload size and improves parse performance while

preserving label behaviour and zoom‑based density.



---



\## Running locally (web)



From `apps/web`:



```bash

http-server -c 30 .



