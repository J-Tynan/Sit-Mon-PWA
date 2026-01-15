/**
 * GlobeRenderer
 *
 * Owns:
 * - Three.js renderer
 * - Scene
 * - Globe mesh
 * - Animation loop
 *
 * Exposes:
 * - Methods for camera control
 * - Methods for layers to add/remove objects
 *
 * Does NOT:
 * - Fetch data
 * - Manage UI
 * - Decide which layers are active
 */

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { CameraController } from './CameraController.js';
import { Starfield } from './Starfield.js';

export class GlobeRenderer {
  constructor(containerElement) {
    this.container = containerElement;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    this.globe = null;
    this.animationId = null;

    this.starfield = null;

    this.tickHandlers = [];
    this.lastTickMs = null;

    this.width = 0;
    this.height = 0;
  }

  init() {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050505);

    // Camera
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;

    this.camera = new THREE.PerspectiveCamera(
      45,
      this.width / this.height,
      0.01,
      1000
    );
    this.camera.position.set(0, 0, 4);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.container.appendChild(this.renderer.domElement);

    // Camera controls
    this.controls = new CameraController(this.camera, this.renderer.domElement);
    this.controls.init();

    // Light
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 3, 5);
    this.scene.add(directional);

    // Globe (opaque sphere)
    const radius = 1;
    const geometry = new THREE.SphereGeometry(radius, 64, 64);
    const material = new THREE.MeshStandardMaterial({
      color: 0x1b1b1b,
      roughness: 0.9,
      metalness: 0.0
    });

    this.globe = new THREE.Mesh(geometry, material);
    this.scene.add(this.globe);

    // Starfield background
    this.starfield = new Starfield({
      count: 750,
      radius: 85,
      radiusJitter: 50,
      size: 0.9,
      parallax: 0.10,
      twinkleIntervalMs: 5_000,
      twinkleChance: 0.55
    });
    this.starfield.init(this);
    this.addTickHandler(({ nowMs }) => this.starfield?.tick(this, nowMs));

    // Resize handling
    window.addEventListener('resize', () => this.onResize());

    // Start render loop
    this.start();
  }

  start() {
    const renderLoop = () => {
      const nowMs = performance.now();
      const deltaMs = this.lastTickMs == null ? 0 : nowMs - this.lastTickMs;

      this.lastTickMs = nowMs;

      for (const handler of this.tickHandlers) {
        try {
          handler({ nowMs, deltaMs });
        } catch {
          // Ignore tick errors to keep rendering.
        }
      }

      if (this.controls) {
        this.controls.update();
      }
      this.renderer.render(this.scene, this.camera);
      this.animationId = requestAnimationFrame(renderLoop);
    };
    renderLoop();
  }

  addTickHandler(handler) {
    if (typeof handler !== 'function') return () => {};
    this.tickHandlers.push(handler);
    return () => this.removeTickHandler(handler);
  }

  removeTickHandler(handler) {
    const idx = this.tickHandlers.indexOf(handler);
    if (idx >= 0) this.tickHandlers.splice(idx, 1);
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  onResize() {
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(this.width, this.height);
  }

  // Layer hooks (unused for now)
  addObject(object3D) {
    this.scene.add(object3D);
  }

  removeObject(object3D) {
    this.scene.remove(object3D);
  }

  // Camera controls (stubs for now)
  resetView() {
    if (this.controls) {
      this.controls.reset();
    }
  }

  zoomIn() {
    if (this.controls) {
      this.controls.zoomIn();
    }
  }

  zoomOut() {
    if (this.controls) {
      this.controls.zoomOut();
    }
  }

  focusRegion(_regionBounds) {
    // Implement later
  }


  sparkleStar() {
    const now = performance.now();
    this.starfield?.startTwinkle?.(this, now);
  }
}