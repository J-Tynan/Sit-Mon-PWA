# NELC bin-collection proxy (dev)

The North East Lincolnshire Council schedule pages are on `https://www.nelincs.gov.uk/`.
Browsers will block cross-origin `fetch()` from the PWA (served from `http://localhost:8080`) to that domain, so we use a tiny local proxy.

## Start

From `apps/web`:

- `node ./dev/nelc-proxy.mjs`

Then check:

- `http://localhost:8787/health`
- `http://localhost:8787/api/nelc/next?postcode=DN32%200NE`

## Endpoints

- `GET /api/nelc/addresses?postcode=DN32%200NE` → returns UPRNs + addresses for the postcode
- `GET /api/nelc/schedule?uprn=11039496` → returns stream dates + next
- `GET /api/nelc/next?postcode=DN32%200NE` → convenience endpoint: first address + next

## Notes

- This is a scraping-based demo adapter. It parses the inline FullCalendar event data the site renders.
- It can break if the council redesigns the page.
- Production should use an official API/feed if available.
