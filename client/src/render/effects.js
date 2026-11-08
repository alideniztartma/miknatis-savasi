// ============================================================================
// EFEKTLER — Parçacıklar, mıknatıs ışınları, kanca halatı, şok dalgaları.
// Hepsi NESNE HAVUZU (object pool) mantığıyla çalışır: başta sabit sayıda
// parçacık ayrılır, ölen parçacığın yeri yenisine verilir. Oyun sırasında
// hiç yeni nesne oluşturulmaz -> çöp toplayıcı takılması (stutter) olmaz.
// ============================================================================
import * as THREE from 'three';

const VERT = `
attribute float size;
attribute float alpha;
attribute vec3 color;
varying float vA;
varying vec3 vC;
void main() {
  vA = alpha; vC = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (320.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying float vA;
varying vec3 vC;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  gl_FragColor = vec4(vC, vA * (1.0 - r * 3.2));
}`;

/** Tek bir parçacık sistemi (tek çizim çağrısı). */
class ParticleSystem {
  constructor(scene, max, additive) {
    this.max = max;
    this.limit = max; // kalite düşünce aktif parçacık sayısını kısarız
    this.next = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    // Parçacık başına simülasyon verisi (düz diziler: nesne yok)
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.active = 0;
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, size, life, grav = -9, drag = 0.5) {
    const i = this.next;
    this.next = (this.next + 1) % this.limit;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.col[k] = r; this.col[k + 1] = g; this.col[k + 2] = b;
    this.size0[i] = size; this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
      this.life[i] -= dt;
      const k = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= d; this.vel[k + 1] = this.vel[k + 1] * d + this.grav[i] * dt; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = t;
      this.size[i] = this.size0[i] * (0.4 + 0.6 * t);
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = true; a.color.needsUpdate = true; a.size.needsUpdate = true; a.alpha.needsUpdate = true;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();

/** A noktasından B noktasına uzanan silindirler (ışın, halat) için örnekli mesh. */
class LineBatch {
  constructor(scene, max, material) {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
    this.mesh = new THREE.InstancedMesh(geo, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.max = max;
    this.n = 0;
    scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  add(ax, ay, az, bx, by, bz, r, color) {
    if (this.n >= this.max) return;
    _a.set(ax, ay, az); _b.set(bx, by, bz);
    _d.subVectors(_b, _a);
    const len = _d.length();
    if (len < 0.001) return;
    _q.setFromUnitVectors(UP, _d.divideScalar(len));
    _s.set(r, len, r);
    _m.compose(_a, _q, _s);
    this.mesh.setMatrixAt(this.n, _m);
    if (color !== undefined) { _c.setHex(color); this.mesh.setColorAt(this.n, _c); }
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.sparks = new ParticleSystem(scene, 700, true); // parlak kıvılcımlar (toplamalı)
    this.dust = new ParticleSystem(scene, 500, false); // toz, enkaz
    this.beams = new LineBatch(scene, 160, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.beams.mesh.setColorAt(0, _c.setHex(0x66ccff));
    this.cables = new LineBatch(scene, 32, new THREE.MeshLambertMaterial({ color: 0x2b2b2b }));
    // Şok dalgası halkaları (havuz)
    this.rings = [];
    const ringGeo = new THREE.TorusGeometry(1, 0.08, 4, 28).rotateX(Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.rings.push({ mesh: m, t: 0, life: 0, size: 1 });
    }
    this.ringNext = 0;
    this.time = 0;
  }

  setQuality(level) {
    // 2: tam, 1: orta, 0: düşük
    this.sparks.limit = level === 2 ? 700 : level === 1 ? 380 : 200;
    this.dust.limit = level === 2 ? 500 : level === 1 ? 260 : 120;
    this.sparks.next %= this.sparks.limit;
    this.dust.next %= this.dust.limit;
    this.density = level === 2 ? 1 : level === 1 ? 0.6 : 0.35;
  }

  /** Genel patlama: n parçacık, hız, renk */
  burst(x, y, z, n, speed, color, size = 0.25, life = 0.6, up = 2, grav = -12, additive = true) {
    const sys = additive ? this.sparks : this.dust;
    _c.setHex(color);
    const count = Math.ceil(n * (this.density || 1));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - e * e);
      const s = speed * (0.3 + Math.random() * 0.7);
      sys.spawn(x, y, z, Math.cos(a) * r * s, e * s + up, Math.sin(a) * r * s,
        _c.r, _c.g, _c.b, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), grav, 1.5);
    }
  }

  shockwave(x, y, z, size, color = 0xbfe9ff, life = 0.45) {
    const r = this.rings[this.ringNext];
    this.ringNext = (this.ringNext + 1) % this.rings.length;
    r.mesh.position.set(x, y, z);
    r.mesh.material.color.setHex(color);
    r.t = 0; r.life = life; r.size = size;
    r.mesh.visible = true;
  }

  // ---------------------------------------------------- Hazır efekt tarifleri
  hit(x, y, z, power, color) {
    const p = Math.min(2, power / 12);
    this.burst(x, y, z, 26 * p + 10, 9 + 6 * p, 0xfff3b0, 0.35, 0.45);
    this.burst(x, y, z, 14 * p + 6, 6 + 4 * p, color, 0.4, 0.8, 3, -14, false);
    this.burst(x, y, z, 10, 3, 0xffffff, 0.9, 0.18, 0, 0);
    this.shockwave(x, y, z, 1.5 + p * 2.5, 0xfff0c0, 0.35);
  }
  block(x, y, z) {
    this.burst(x, y, z, 24, 8, 0x8fd9ff, 0.3, 0.4);
    this.shockwave(x, y, z, 1.6, 0x8fd9ff, 0.3);
  }
  wave(x, y, z, yaw) {
    // Öne doğru yelpaze şeklinde hava dalgası
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const n = Math.ceil(46 * (this.density || 1));
    for (let i = 0; i < n; i++) {
      const a = yaw + (Math.random() - 0.5) * 1.7;
      const s = 10 + Math.random() * 9;
      this.sparks.spawn(x + fx * 0.6, y + (Math.random() - 0.3) * 1.2, z + fz * 0.6, -Math.sin(a) * s, (Math.random() - 0.4) * 2, -Math.cos(a) * s,
        0.75, 0.92, 1, 0.45, 0.4, 0, 2.5);
    }
    this.shockwave(x + fx * 2, y - 0.3, z + fz * 2, 4.5, 0xcfefff, 0.4);
  }
  dustPuff(x, y, z, power) {
    this.burst(x, y, z, 8 + power, 3 + power * 0.2, 0xb59a7a, 0.55, 0.7, 1.5, -3, false);
  }
  catchFx(x, y, z) { this.burst(x, y, z, 14, 4, 0x56d6ff, 0.25, 0.35, 0, 0); }
  elim(x, y, z, color) {
    this.burst(x, y, z, 40, 12, color, 0.6, 1.0, 6, -6);
    this.burst(x, y, z, 30, 8, 0xffffff, 0.4, 0.7, 4, -6);
    this.shockwave(x, y, z, 6, color, 0.7);
  }
  ringFall(radius) {
    const n = Math.ceil(80 * (this.density || 1));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = radius - 2 + Math.random() * 4;
      this.dust.spawn(Math.cos(a) * d, -0.5 + Math.random(), Math.sin(a) * d, (Math.random() - 0.5) * 2, -2 - Math.random() * 4, (Math.random() - 0.5) * 2,
        0.55, 0.45, 0.35, 1.2, 1.6, -8, 0.4);
    }
  }
  hookFx(x, y, z) { this.burst(x, y, z, 16, 6, 0xffa64d, 0.25, 0.3); }

  /** Mıknatıs ışını: ağızdan eşyaya zikzaklı elektrik. Her karede yeniden kurulur. */
  beginFrame(dt) {
    this.time += dt;
    this.beams.begin();
    this.cables.begin();
  }
  beam(ax, ay, az, bx, by, bz, strength, contested) {
    const segs = 6;
    const color = contested ? 0xff7ad9 : strength > 0.7 ? 0x6fd6ff : 0x3d9bff;
    let px = ax, py = ay, pz = az;
    const jitter = 0.18 * strength;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      let x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      if (i < segs) { x += (Math.random() - 0.5) * jitter; y += (Math.random() - 0.5) * jitter; z += (Math.random() - 0.5) * jitter; }
      this.beams.add(px, py, pz, x, y, z, 0.035 + 0.03 * strength, color);
      px = x; py = y; pz = z;
    }
    // ışın boyunca küçük kıvılcımlar
    if (Math.random() < 0.5 * (this.density || 1)) {
      const t = Math.random();
      this.sparks.spawn(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2,
        0.5, 0.85, 1, 0.22, 0.25, 0, 1);
    }
  }
  cable(ax, ay, az, bx, by, bz) {
    this.cables.add(ax, ay, az, bx, by, bz, 0.035);
  }

  update(dt) {
    this.sparks.update(dt);
    this.dust.update(dt);
    this.beams.end();
    this.cables.end();
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { r.mesh.visible = false; continue; }
      const s = r.size * (0.2 + k);
      r.mesh.scale.set(s, s, s);
      r.mesh.material.opacity = (1 - k) * 0.8;
    }
  }
}
