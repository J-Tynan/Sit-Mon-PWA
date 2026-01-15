import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  res.end(text);
}

function parseAddressesFromSearchHtml(html) {
  // Pull options from the UPRN select.
  // Example: <option value="11039496" >37 LEGSBY AVENUE, GRIMSBY, DN32 0NE</option>
  const results = [];

  const selectStart = html.indexOf('id="address_search"');
  if (selectStart < 0) return results;

  const slice = html.slice(selectStart, selectStart + 200_000);
  const optionRegex = /<option\s+value="(\d+)"[^>]*>([^<]+)<\/option>/g;
  let match;
  while ((match = optionRegex.exec(slice))) {
    const uprn = match[1];
    const address = match[2].replace(/\s+/g, ' ').trim();
    if (!uprn || !address || address.toLowerCase().includes('select an address')) continue;
    results.push({ uprn, address });
  }

  // De-dupe by UPRN
  const seen = new Set();
  return results.filter((r) => {
    if (seen.has(r.uprn)) return false;
    seen.add(r.uprn);
    return true;
  });
}

function parseStreamsFromScheduleHtml(html) {
  // The NELC page renders a FullCalendar instance with inline JS:
  // eventSources: [
  //   {events: [{title : 'Household Waste',start : '2026-01-14',...}, ...], color:'#15651C', ...},
  //   ...
  // ]
  const streams = [];

  const sourceRegex = /\{events:\s*\[([\s\S]*?)\]\s*,\s*color:\s*'(#?[0-9a-fA-F]{3,6})'/g;
  let sourceMatch;
  while ((sourceMatch = sourceRegex.exec(html))) {
    const eventsText = sourceMatch[1];
    const color = sourceMatch[2];

    const eventRegex = /title\s*:\s*'([^']+)'\s*,\s*start\s*:\s*'(\d{4}-\d{2}-\d{2})'/g;
    let eventMatch;

    let streamName = null;
    const dates = [];

    while ((eventMatch = eventRegex.exec(eventsText))) {
      streamName = eventMatch[1];
      dates.push(eventMatch[2]);
    }

    if (streamName && dates.length > 0) {
      streams.push({ stream: streamName, color, dates });
    }
  }

  return streams;
}

function computeNextEvent(streams, now = new Date()) {
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let best = null;
  for (const s of streams) {
    for (const d of s.dates) {
      const dt = new Date(d + 'T00:00:00Z');
      if (Number.isNaN(dt.getTime())) continue;
      if (dt < todayUtc) continue;

      const candidate = { stream: s.stream, date: d, color: s.color };
      if (!best) {
        best = candidate;
        continue;
      }

      const bestDt = new Date(best.date + 'T00:00:00Z');
      if (dt < bestDt) best = candidate;
    }
  }

  return best;
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url || !req.method) {
      sendText(res, 400, 'Bad request');
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,OPTIONS',
        'access-control-allow-headers': 'content-type'
      });
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      sendText(res, 405, 'Method not allowed');
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/health') {
      sendJson(res, 200, { ok: true, service: 'nelc-proxy' });
      return;
    }

    if (url.pathname === '/api/nelc/addresses') {
      const postcode = (url.searchParams.get('postcode') || '').trim();
      if (!postcode) {
        sendJson(res, 400, { error: 'Missing postcode' });
        return;
      }

      const searchUrl = `https://www.nelincs.gov.uk/?s=${encodeURIComponent(postcode)}`;
      const html = await (await fetch(searchUrl, { headers: { 'user-agent': 'Situation-Monitor-PWA dev proxy' } })).text();
      const addresses = parseAddressesFromSearchHtml(html);
      sendJson(res, 200, { postcode, addresses });
      return;
    }

    if (url.pathname === '/api/nelc/schedule') {
      const uprn = (url.searchParams.get('uprn') || '').trim();
      if (!uprn) {
        sendJson(res, 400, { error: 'Missing uprn' });
        return;
      }

      const scheduleUrl = `https://www.nelincs.gov.uk/refuse-collection-schedule/?uprn=${encodeURIComponent(uprn)}`;
      const html = await (await fetch(scheduleUrl, { headers: { 'user-agent': 'Situation-Monitor-PWA dev proxy' } })).text();
      const streams = parseStreamsFromScheduleHtml(html);
      const next = computeNextEvent(streams);
      sendJson(res, 200, { uprn, streams, next });
      return;
    }

    if (url.pathname === '/api/nelc/next') {
      const postcode = (url.searchParams.get('postcode') || '').trim();
      if (!postcode) {
        sendJson(res, 400, { error: 'Missing postcode' });
        return;
      }

      const searchUrl = `https://www.nelincs.gov.uk/?s=${encodeURIComponent(postcode)}`;
      const searchHtml = await (await fetch(searchUrl, { headers: { 'user-agent': 'Situation-Monitor-PWA dev proxy' } })).text();
      const addresses = parseAddressesFromSearchHtml(searchHtml);
      const first = addresses[0];
      if (!first) {
        sendJson(res, 404, { error: 'No addresses found for postcode', postcode });
        return;
      }

      const scheduleUrl = `https://www.nelincs.gov.uk/refuse-collection-schedule/?uprn=${encodeURIComponent(first.uprn)}`;
      const scheduleHtml = await (await fetch(scheduleUrl, { headers: { 'user-agent': 'Situation-Monitor-PWA dev proxy' } })).text();
      const streams = parseStreamsFromScheduleHtml(scheduleHtml);
      const next = computeNextEvent(streams);
      sendJson(res, 200, { postcode, uprn: first.uprn, address: first.address, next, streams });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJson(res, 500, { error: 'Internal error', details: String(err?.message || err) });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`NELC proxy listening on http://localhost:${PORT}`);
});
