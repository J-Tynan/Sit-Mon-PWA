function getDefaultProxyOrigin() {
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return isLocalhost ? 'http://localhost:8787' : '';
}

function parseYmdToUtcDate(ymd) {
  // Treat YYYY-MM-DD as midnight UTC for consistent comparisons.
  const [y, m, d] = String(ymd).split('-').map((v) => Number(v));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

export async function getNelcNextCollection({
  postcode,
  proxyOrigin = getDefaultProxyOrigin()
} = {}) {
  if (!postcode) throw new Error('NELC adapter requires postcode');

  const url = `${proxyOrigin}/api/nelc/next?postcode=${encodeURIComponent(postcode)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`NELC proxy request failed: ${resp.status}`);
  }

  const data = await resp.json();
  if (!data || !data.next || !data.next.date || !data.next.stream) {
    throw new Error('NELC proxy returned no next collection');
  }

  const nextDate = parseYmdToUtcDate(data.next.date);
  return {
    council: 'North East Lincolnshire Council',
    postcode,
    uprn: data.uprn,
    address: data.address,
    next: {
      stream: data.next.stream,
      date: data.next.date,
      dateUtc: nextDate,
      color: data.next.color || null
    }
  };
}
