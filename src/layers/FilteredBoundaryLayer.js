import { BoundaryLayer } from './BoundaryLayer.js';

export class FilteredBoundaryLayer extends BoundaryLayer {
  constructor(options = {}) {
    const { filterFn = null, ...rest } = options;
    super(rest);
    this.filterFn = filterFn;
  }

  buildLineGeometries(geojson, radius) {
    if (!this.filterFn) return super.buildLineGeometries(geojson, radius);
    if (!geojson || !Array.isArray(geojson.features)) return [];

    const filtered = {
      ...geojson,
      features: geojson.features.filter((feature) => {
        try {
          return Boolean(this.filterFn(feature));
        } catch {
          return false;
        }
      })
    };

    return super.buildLineGeometries(filtered, radius);
  }

  setColor(hexColor) {
    if (typeof hexColor !== 'number' || !Number.isFinite(hexColor)) return;
    this.material.color.setHex(hexColor);
  }
}
