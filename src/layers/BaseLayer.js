/**
 * BaseLayer
 *
 * A layer represents a toggleable, refreshable set of
 * visual elements on the globe.
 *
 * Examples:
 * - Boundary outlines
 * - Weather icons
 * - Air traffic markers
 * - Bin collection labels
 *
 * Layers do NOT:
 * - Control the camera
 * - Touch the DOM
 * - Know about other layers
 */

export class BaseLayer {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.enabled = false;
    this.objects = [];
  }

  /**
   * Called once when the layer is first created.
   * Use this to prepare static resources.
   */
  init(globeRenderer) {}

  /**
   * Enable the layer.
   * Create objects and add them to the renderer.
   */
  enable(globeRenderer) {
    this.enabled = true;
  }

  /**
   * Disable the layer.
   * Remove all objects from the renderer.
   */
  disable(globeRenderer) {
    this.enabled = false;
  }

  /**
   * Refresh the layer’s data.
   * Called manually by the user.
   */
  refresh(globeRenderer) {}

  /**
   * Cleanup resources if the layer is destroyed.
   */
  destroy(globeRenderer) {}
}
