/**
 * CameraController
 *
 * Responsible for:
 * - Orbit / rotation behaviour
 * - Zoom limits
 * - Smooth transitions
 * - Reset and focus logic
 *
 * Does NOT:
 * - Know about layers
 * - Know about UI
 * - Create geometry
 */

export class CameraController {
  constructor(camera, domElement) {
    // camera: Three.js camera
    // domElement: canvas or container for input events
    this.camera = camera;
    this.domElement = domElement;

    // Spherical coordinates
    this.baseRadius = 4;
    this.radius = this.baseRadius;
    this.theta = 0; // rotation around Y
    this.phi = Math.PI / 2; // rotation from top

    // Limits
    // Keep the camera outside the globe (globe radius is 1), otherwise the sphere is backface-culled.
    // Also avoid near-plane clipping when close.
    this.minRadius = 1.05;
    this.maxRadius = 10;
    this.minPhi = 0.1;
    this.maxPhi = Math.PI - 0.1;

    // FOV zoom (used once we hit minRadius)
    this.baseFov = camera.fov;
    this.minFov = 4;
    this.maxFov = this.baseFov;

    // Interaction state
    this.isDragging = false;
    this.lastX = 0;
    this.lastY = 0;

    this.rotateSpeed = 0.005;
    this.zoomSpeed = 1.08;

    this.onChange = null;
  }

  init() {
    this.updateCameraPosition();

    this.handlePointerDown = (event) => this.onPointerDown(event);
    this.handlePointerMove = (event) => this.onPointerMove(event);
    this.handlePointerUp = (event) => this.onPointerUp(event);
    this.handleWheel = (event) => this.onWheel(event);

    this.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.domElement.addEventListener('pointercancel', this.handlePointerUp);
    this.domElement.addEventListener('pointerleave', this.handlePointerUp);
    this.domElement.addEventListener('wheel', this.handleWheel, { passive: true });
  }

  reset() {
    this.radius = this.baseRadius;
    this.setFov(this.baseFov);
    this.theta = 0;
    this.phi = Math.PI / 2;
    this.updateCameraPosition();
  }

  zoomIn() {
    // Prefer moving closer until we reach the minimum safe radius.
    const nextRadius = this.radius / this.zoomSpeed;
    if (nextRadius >= this.minRadius + 1e-6) {
      this.radius = this.clampRadius(nextRadius);
    } else {
      // Then zoom further by narrowing the FOV.
      this.setFov(this.clampFov(this.camera.fov / this.zoomSpeed));
    }
    this.updateCameraPosition();
  }

  zoomOut() {
    // Undo FOV zoom first, then move back.
    if (this.camera.fov < this.maxFov - 1e-6) {
      this.setFov(this.clampFov(this.camera.fov * this.zoomSpeed));
    } else {
      this.radius = this.clampRadius(this.radius * this.zoomSpeed);
    }
    this.updateCameraPosition();
  }

  focusOn(regionBounds) {
    if (!regionBounds) return;

    // Reset FOV for a predictable "fit".
    this.setFov(this.baseFov);

    const { minLat, maxLat, minLon, maxLon } = regionBounds;
    if ([minLat, maxLat, minLon, maxLon].some((v) => typeof v !== 'number')) return;

    const centerLat = (minLat + maxLat) / 2;
    const centerLon = (minLon + maxLon) / 2;
    const center = this.unitVectorFromLatLon(centerLat, centerLon);

    // Put the camera on the same side as the region center so it faces the viewer.
    this.theta = Math.atan2(center.x, center.z);
    this.phi = this.clamp(Math.acos(center.y), this.minPhi, this.maxPhi);

    // Estimate angular extent using the bounding box corners.
    const corners = [
      this.unitVectorFromLatLon(minLat, minLon),
      this.unitVectorFromLatLon(minLat, maxLon),
      this.unitVectorFromLatLon(maxLat, minLon),
      this.unitVectorFromLatLon(maxLat, maxLon)
    ];

    let maxAlpha = 0;
    for (const corner of corners) {
      const dot = this.clamp(
        center.x * corner.x + center.y * corner.y + center.z * corner.z,
        -1,
        1
      );
      const alpha = Math.acos(dot);
      if (alpha > maxAlpha) maxAlpha = alpha;
    }

    // Convert region angular extent into a camera radius that fits in the vertical FOV.
    // gamma = atan( sin(alpha) / (R - cos(alpha)) )  =>  R = cos(alpha) + sin(alpha)/tan(gamma)
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const halfFov = fovRad / 2;
    const margin = 0.9;
    const gamma = Math.max(0.15, halfFov * margin);
    const alpha = this.clamp(maxAlpha, 0.01, Math.PI / 2);

    const desiredRadius = Math.cos(alpha) + Math.sin(alpha) / Math.tan(gamma);
    this.radius = this.clampRadius(desiredRadius);

    this.updateCameraPosition();
  }

  ensureZoomAtLeast(minZoomFactor, { maxSteps = 32 } = {}) {
    const minZoom = Number(minZoomFactor);
    if (!Number.isFinite(minZoom) || minZoom <= 0) return;

    const steps = Math.max(0, Math.min(256, Number(maxSteps) || 0));
    for (let i = 0; i < steps; i++) {
      if (this.getZoomFactor() >= minZoom - 1e-6) break;
      this.zoomIn();
    }
  }

  update() {
    // Reserved for future smoothing/damping.
  }

  onPointerDown(event) {
    this.isDragging = true;
    this.activePointerId = event.pointerId;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.domElement.setPointerCapture(event.pointerId);
  }

  onPointerMove(event) {
    if (!this.isDragging || event.pointerId !== this.activePointerId) return;

    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;

    const dragScale = this.radius / this.baseRadius; // slower when zoomed in
    const distanceZoom = this.baseRadius / this.radius;
    const fovZoom = this.baseFov / this.camera.fov;
    const effectiveZoom = distanceZoom * fovZoom;
    const rotateStep = (this.rotateSpeed * dragScale) / Math.max(1, effectiveZoom);

    this.theta -= dx * rotateStep;
    this.phi = this.clamp(this.phi - dy * rotateStep, this.minPhi, this.maxPhi);

    this.updateCameraPosition();

    this.lastX = event.clientX;
    this.lastY = event.clientY;
  }

  onPointerUp(event) {
    if (event.pointerId === this.activePointerId) {
      this.isDragging = false;
      this.activePointerId = null;
      this.domElement.releasePointerCapture(event.pointerId);
    }
  }

  onWheel(event) {
    const direction = event.deltaY > 0 ? 1 : -1;
    if (direction > 0) {
      this.zoomOut();
    } else {
      this.zoomIn();
    }
  }

  clampRadius(value) {
    return Math.max(this.minRadius, Math.min(this.maxRadius, value));
  }

  clampFov(value) {
    return Math.max(this.minFov, Math.min(this.maxFov, value));
  }

  setFov(value) {
    const next = this.clampFov(value);
    if (Math.abs(this.camera.fov - next) < 1e-6) return;
    this.camera.fov = next;
    this.camera.updateProjectionMatrix();
  }

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  updateCameraPosition() {
    const sinPhi = Math.sin(this.phi);
    const cosPhi = Math.cos(this.phi);
    const sinTheta = Math.sin(this.theta);
    const cosTheta = Math.cos(this.theta);

    const x = this.radius * sinPhi * sinTheta;
    const y = this.radius * cosPhi;
    const z = this.radius * sinPhi * cosTheta;

    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 0, 0);

    if (typeof this.onChange === 'function') {
      this.onChange({
        radius: this.radius,
        zoom: this.getZoomFactor()
      });
    }
  }

  getZoomFactor() {
    // Effective zoom combines distance + FOV zoom.
    const distanceZoom = this.baseRadius / this.radius;
    const fovZoom = this.baseFov / this.camera.fov;
    return distanceZoom * fovZoom;
  }

  unitVectorFromLatLon(lat, lon) {
    // Matches the coordinate system used by latLongToVector3 (but always unit radius).
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);

    const x = -Math.sin(phi) * Math.cos(theta);
    const z = Math.sin(phi) * Math.sin(theta);
    const y = Math.cos(phi);

    return { x, y, z };
  }
}
