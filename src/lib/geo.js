import { feature } from 'topojson-client';

export function loadGeoData(data) {
  if (!data) return data;

  // TopoJSON
  if (data.type === 'Topology') {
    const objectName = data.objects && Object.keys(data.objects)[0];
    if (!objectName) {
      throw new Error('TopoJSON has no objects to convert');
    }

    return feature(data, data.objects[objectName]);
  }

  // GeoJSON (FeatureCollection / Feature / Geometry)
  return data;
}
