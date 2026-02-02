/**
 * LayerManager
 *
 * Responsibilities:
 * - Register layers
 * - Enable / disable layers
 * - Forward refresh requests
 *
 * Non-responsibilities:
 * - Rendering
 * - UI
 * - Data fetching
 */

export class LayerManager {
  constructor(globeRenderer) {
    this.globeRenderer = globeRenderer;
    this.layers = new Map();
  }

  register(layer) {
    this.layers.set(layer.id, layer);
    layer.init(this.globeRenderer);
  }

  list() {
    return Array.from(this.layers.values());
  }

  isEnabled(id) {
    const layer = this.layers.get(id);
    return Boolean(layer?.enabled);
  }

  enableLayer(id) {
    const layer = this.layers.get(id);
    if (layer && !layer.enabled) {
      layer.enable(this.globeRenderer);
    }
  }

  disableLayer(id) {
    const layer = this.layers.get(id);
    if (layer && layer.enabled) {
      layer.disable(this.globeRenderer);
    }
  }

  toggleLayer(id, enabled) {
    if (enabled) {
      this.enableLayer(id);
    } else {
      this.disableLayer(id);
    }
  }

  refreshLayer(id) {
    const layer = this.layers.get(id);
    if (layer && layer.enabled) {
      layer.refresh(this.globeRenderer);
    }
  }
}
