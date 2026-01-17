import * as THREE from 'three';

function makeStarTexture(size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function randomUnitVector() {
  // Uniform on sphere
  const u = Math.random() * 2 - 1; // cos(phi)
  const t = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(t), u, s * Math.sin(t));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class Starfield {
  constructor(options = {}) {
    this.count = options.count ?? 900;
    this.radius = options.radius ?? 80;
    this.radiusJitter = options.radiusJitter ?? 40;
    this.size = options.size ?? 0.9;

    this.parallax = options.parallax ?? 0.12;

    this.twinkleIntervalMs = options.twinkleIntervalMs ?? 10_000;
    this.twinkleChance = options.twinkleChance ?? 0.55;

    this.group = new THREE.Group();
    this.points = null;

    this.positions = null;
    this.colors = null;
    this.baseColors = null;

    this.geometry = null;
    this.material = null;

    this.lastTwinkleCheckMs = null;
    this.activeTwinkle = null;
  }

  init(globeRenderer) {
    const positions = new Float32Array(this.count * 3);
    const colors = new Float32Array(this.count * 3);
    const baseColors = new Float32Array(this.count * 3);

    const starTexture = makeStarTexture(64);

    for (let i = 0; i < this.count; i++) {
      const dir = randomUnitVector();
      const r = this.radius + Math.random() * this.radiusJitter;
      dir.multiplyScalar(r);

      const idx = i * 3;
      positions[idx] = dir.x;
      positions[idx + 1] = dir.y;
      positions[idx + 2] = dir.z;

      // Slightly varied star tint
      const tint = Math.random();
      const base = 0.55 + Math.random() * 0.45;
      const rCol = base * (0.9 + 0.2 * tint);
      const gCol = base * (0.9 + 0.1 * tint);
      const bCol = base * (1.0 + 0.35 * tint);

      colors[idx] = rCol;
      colors[idx + 1] = gCol;
      colors[idx + 2] = bCol;

      baseColors[idx] = rCol;
      baseColors[idx + 1] = gCol;
      baseColors[idx + 2] = bCol;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: this.size,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: starTexture,
      alphaTest: 0.15
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;

    this.positions = positions;
    this.colors = colors;
    this.baseColors = baseColors;
    this.geometry = geometry;
    this.material = material;
    this.points = points;

    // Render behind everything else (but still let globe occlude stars)
    this.group.add(points);
    globeRenderer.scene.add(this.group);
  }

  destroy(globeRenderer) {
    this.endActiveTwinkle(globeRenderer);

    if (this.group) {
      globeRenderer.scene.remove(this.group);
    }

    this.geometry?.dispose?.();
    this.material?.dispose?.();
  }

  startTwinkle(globeRenderer, nowMs) {
    if (!this.geometry || !this.colors || !this.baseColors) return;

    // If a twinkle is already running, end it cleanly so colors/sprite are restored.
    this.endActiveTwinkle(globeRenderer);
    // Prefer a star roughly facing the camera so the sparkle is visible.
    const cam = globeRenderer.camera;
    let index = Math.floor(Math.random() * this.count);
    if (cam) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
      const tries = 32;
      let bestIdx = index;
      let bestDot = -1;
      for (let i = 0; i < tries; i++) {
        const cand = Math.floor(Math.random() * this.count);
        const i3 = cand * 3;
        const px = this.positions[i3];
        const py = this.positions[i3 + 1];
        const pz = this.positions[i3 + 2];
        const len = Math.hypot(px, py, pz) || 1;
        const dot = (px / len) * forward.x + (py / len) * forward.y + (pz / len) * forward.z;
        if (dot > bestDot) {
          bestDot = dot;
          bestIdx = cand;
        }
      }
      if (bestDot > 0.2) index = bestIdx;
    }

    // Abrupt, snappy sparkle: higher intensity but much shorter duration.
    const hdr = Math.random() < 0.2;
    const intensity = hdr ? 22 + Math.random() * 56 : 10 + Math.random() * 24;
    // much shorter durations to make the sparkle more abrupt
    const durationMs = hdr ? 300 : 180;

    // Add a small sprite burst at the star position for a visible twinkle.
    const i3 = index * 3;
    const x = this.positions[i3];
    const y = this.positions[i3 + 1];
    const z = this.positions[i3 + 2];

    const spriteMat = new THREE.SpriteMaterial({
      color: 0xfff2d5,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      map: makeStarTexture(96),
      alphaTest: 0.15
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(0.0);
    sprite.frustumCulled = false;
    globeRenderer.scene.add(sprite);

    // Record previous color (from baseColors)
    const baseR = this.baseColors[i3];
    const baseG = this.baseColors[i3 + 1];
    const baseB = this.baseColors[i3 + 2];

    this.activeTwinkle = {
      index,
      startMs: nowMs,
      durationMs,
      intensity,
      base: { r: baseR, g: baseG, b: baseB },
      sprite
    };
  }

  endActiveTwinkle(globeRenderer) {
    const tw = this.activeTwinkle;
    if (!tw) return;

    if (this.colors && this.baseColors && this.geometry) {
      const i3 = tw.index * 3;
      this.colors[i3] = tw.base.r;
      this.colors[i3 + 1] = tw.base.g;
      this.colors[i3 + 2] = tw.base.b;
      this.geometry.attributes.color.needsUpdate = true;
    }

    if (tw.sprite) {
      globeRenderer.scene.remove(tw.sprite);
      tw.sprite.material?.dispose?.();
    }

    this.activeTwinkle = null;
  }

  tick(globeRenderer, nowMs) {
    // Subtle parallax: drift starfield slightly with camera position.
    const cam = globeRenderer.camera;
    if (cam) {
      const p = cam.position;
      // Convert camera position to yaw/pitch around origin.
      const yaw = Math.atan2(p.x, p.z);
      const pitch = Math.atan2(p.y, Math.sqrt(p.x * p.x + p.z * p.z));
      this.group.rotation.set(pitch * this.parallax, yaw * this.parallax, 0);
    }

    // Periodic twinkle check
    if (this.lastTwinkleCheckMs == null) this.lastTwinkleCheckMs = nowMs;
    if (nowMs - this.lastTwinkleCheckMs >= this.twinkleIntervalMs) {
      // Keep cadence stable
      this.lastTwinkleCheckMs += this.twinkleIntervalMs;
      if (Math.random() < this.twinkleChance && !this.activeTwinkle) {
        this.startTwinkle(globeRenderer, nowMs);
      }
    }

    // Animate active twinkle
    const tw = this.activeTwinkle;
    if (tw && this.geometry && this.colors && this.baseColors) {
      const t = (nowMs - tw.startMs) / tw.durationMs;
      if (t >= 1) {
        this.endActiveTwinkle(globeRenderer);
        return;
      }

      // Abrupt easing: rises quickly to maximum and falls off fast
      const easedT = Math.pow(Math.max(0, t), 0.5);
      const bump = Math.sin(Math.PI * easedT);
      const mult = 1 + bump * tw.intensity;

      const i3 = tw.index * 3;
      this.colors[i3] = clamp(tw.base.r * mult, 0, 90);
      this.colors[i3 + 1] = clamp(tw.base.g * mult, 0, 90);
      this.colors[i3 + 2] = clamp(tw.base.b * mult, 0, 90);
      this.geometry.attributes.color.needsUpdate = true;

      if (tw.sprite) {
        // Sharper visual peak: more abrupt opacity rise
        const opacity = 0.3 + 0.85 * Math.pow(Math.max(0, bump), 1.6);
        tw.sprite.material.opacity = Math.min(1, opacity);

        // Snappier, slightly smaller flare that scales with a sharper curve
        const size = (0.55 + Math.pow(Math.max(0, bump), 1.2) * 2.0) * (0.12 + tw.intensity * 0.012);
        tw.sprite.scale.setScalar(size);
      }
    }
  }
}
