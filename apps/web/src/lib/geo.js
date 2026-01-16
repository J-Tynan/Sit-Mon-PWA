export async function loadGeoData(data) {
  if (!data) return data;
  if (data.type === 'Topology') {
    const objectName = Object.keys(data.objects)[0];

    // Try to dynamically import an ESM-friendly build first, fall back to the minified UMD build.
    let mod;
    try {
      mod = await import('https://unpkg.com/topojson-client@3.1.0/dist/topojson-client.module.js');
    } catch (err) {
      try {
        mod = await import('https://unpkg.com/topojson-client@3.1.0/dist/topojson-client.min.js');
      } catch (err2) {
        throw new Error('Failed to load topojson-client for TopoJSON conversion');
      }
    }

    // Support either named export or default namespace (UMD build)
    const featureFn = mod.feature || (mod.default && mod.default.feature);
    if (typeof featureFn !== 'function') {
      throw new Error('topojson-client feature() not available');
    }

    return featureFn(data, data.objects[objectName]);
  }
  return data;
}
