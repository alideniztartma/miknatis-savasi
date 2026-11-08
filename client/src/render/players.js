// ============================================================================
// OYUNCULAR — Sevimli hurda robotları.
// 16 oyuncunun tamamı 6 çizim çağrısıyla çizilir: gövde, bacaklar, detaylar,
// gözler, mıknatıs tabancası ve "blob" gölgeler. Her biri InstancedMesh.
// Takım rengi "instance color" ile verilir (beyaz köşe rengi x oyuncu rengi).
// ============================================================================
import * as THREE from 'three';
import { PLAYER_COLORS, MAX_SLOTS } from '@miknatis/shared';
import { merge, box, cyl, part, ICO1, radialTexture } from './geo.js';

const HIP_Y = -0.38;
const SHOULDER = new THREE.Vector3(0.44, 0.2, 0);
const MUZZLE = new THREE.Vector3(0, 0, -0.95);

function bodyGeo() {
  return merge([
    box(0xffffff, 0.74, 0.64, 0.48, 0, 0.02, 0),
    box(0xd0d0d0, 0.4, 0.26, 0.03, 0, 0.08, -0.25),
    box(0x8a8a8a, 0.78, 0.1, 0.5, 0, -0.27, 0),
    box(0xffffff, 0.58, 0.48, 0.52, 0, 0.62, 0),
    cyl(0x9a9a9a, 0.08, 0.08, 0.31, 0.62, 0, 0, 0, Math.PI / 2),
    cyl(0x9a9a9a, 0.08, 0.08, -0.31, 0.62, 0, 0, 0, Math.PI / 2),
    cyl(0xb0b0b0, 0.025, 0.32, 0.15, 1.0, 0.1),
    part(ICO1, 0xffffff, 0.15, 1.18, 0.1, 0, 0, 0, 0.08, 0.08, 0.08),
    box(0xffffff, 0.2, 0.34, 0.22, -0.46, 0.05, 0), // sol kol
  ]);
}
function detailGeo() {
  return merge([
    box(0x15172a, 0.48, 0.24, 0.04, 0, 0.64, -0.265),
    box(0x3a3f4a, 0.5, 0.52, 0.22, 0, 0.05, 0.34),
    cyl(0xff8a1f, 0.12, 0.42, 0, 0.22, 0.47, 0, 0, Math.PI / 2),
    cyl(0xff8a1f, 0.12, 0.42, 0, -0.06, 0.47, 0, 0, Math.PI / 2),
    box(0x2b2b2b, 0.22, 0.12, 0.24, -0.46, -0.16, 0), // sol el
  ]);
}
function eyesGeo() {
  return merge([box(0x9ffcff, 0.11, 0.08, 0.02, -0.11, 0.65, -0.29, 0, 0, 0, 0), box(0x9ffcff, 0.11, 0.08, 0.02, 0.11, 0.65, -0.29, 0, 0, 0, 0)]);
}
function legGeo() {
  return merge([box(0xffffff, 0.24, 0.42, 0.28, 0, -0.21, 0), box(0x444444, 0.29, 0.12, 0.38, 0, -0.44, -0.04)]);
}
function gunGeo() {
  return merge([
    box(0x8d99ae, 0.17, 0.17, 0.42, 0, 0, -0.14),
    box(0x2d3142, 0.2, 0.22, 0.5, 0, 0, -0.45),
    box(0x4a5068, 0.08, 0.14, 0.12, 0, -0.16, -0.36),
    box(0xe8312f, 0.3, 0.09, 0.09, 0, 0, -0.7),
    box(0xe8312f, 0.08, 0.09, 0.2, -0.11, 0, -0.8),
    box(0xe8312f, 0.08, 0.09, 0.2, 0.11, 0, -0.8),
    box(0xe6e6e6, 0.085, 0.095, 0.07, -0.11, 0, -0.93),
    box(0xe6e6e6, 0.085, 0.095, 0.07, 0.11, 0, -0.93),
  ]);
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();
const _white = new THREE.Color(0xffffff);

export class PlayerMeshes {
  constructor(scene, material) {
    const mk = (geo, mat, count, colored) => {
      const m = new THREE.InstancedMesh(geo, mat, count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      if (colored) m.setColorAt(0, _white);
      scene.add(m);
      return m;
    };
    this.body = mk(bodyGeo(), material, MAX_SLOTS, true);
    this.legs = mk(legGeo(), material, MAX_SLOTS * 2, true);
    this.detail = mk(detailGeo(), material, MAX_SLOTS, false);
    this.gun = mk(gunGeo(), material, MAX_SLOTS, false);
    this.eyes = mk(eyesGeo(), new THREE.MeshBasicMaterial({ vertexColors: true }), MAX_SLOTS, false);
    const blobMat = new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, depthWrite: false });
    const blobGeo = new THREE.PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2);
    this.blob = mk(blobGeo, blobMat, MAX_SLOTS, false);
    this.blob.renderOrder = 1;

    // Oyuncu başına animasyon durumu
    this.anim = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      this.anim.push({ phase: 0, lx: 0, ly: 0, lz: 0, speed: 0, vy: 0, flash: 0, tumble: 0, recoil: 0, init: false,
        muzzle: new THREE.Vector3(), head: new THREE.Vector3(), visible: false });
    }
    this.time = 0;
  }

  flash(slot) { if (this.anim[slot]) this.anim[slot].flash = 0.18; }
  recoil(slot) { if (this.anim[slot]) this.anim[slot].recoil = 1; }

  /**
   * @param players görünüm oyuncuları
   * @param groundFn (x,y,z) => zemin yüksekliği ya da null
   */
  update(players, dt, groundFn) {
    this.time += dt;
    let n = 0, ln = 0, bn = 0;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const a = this.anim[i];
      if (!p || !p.inRound || !p.alive) { a.visible = false; a.init = false; continue; }
      a.visible = true;
      // Hız tahmini (görsel animasyon için, kareden kareye konum farkı)
      if (!a.init) { a.lx = p.x; a.ly = p.y; a.lz = p.z; a.init = true; }
      const idt = dt > 0 ? 1 / dt : 0;
      const hs = Math.hypot(p.x - a.lx, p.z - a.lz) * idt;
      a.vy = (p.y - a.ly) * idt;
      a.speed += (Math.min(hs, 20) - a.speed) * Math.min(1, dt * 10);
      a.lx = p.x; a.ly = p.y; a.lz = p.z;
      a.phase += dt * (4 + a.speed * 1.6);
      if (a.flash > 0) a.flash -= dt;
      if (a.recoil > 0) a.recoil = Math.max(0, a.recoil - dt * 6);

      const airborne = Math.abs(a.vy) > 2.5;
      const falling = p.y < -1.5;
      a.tumble = falling ? a.tumble + dt * 6 : 0;
      const stunWob = p.stun > 0 ? Math.sin(this.time * 22) * 0.25 : 0;
      const lean = Math.min(a.speed / 9, 1) * 0.14;
      const bob = airborne ? 0 : Math.abs(Math.sin(a.phase)) * 0.05 * Math.min(a.speed / 4, 1);

      // ---- Gövde
      _e.set(-lean + (falling ? a.tumble : 0), p.yaw, stunWob + (falling ? a.tumble * 0.6 : 0));
      _q.setFromEuler(_e);
      _v.set(p.x, p.y + bob, p.z);
      _s.set(1, 1, 1);
      _m.compose(_v, _q, _s);
      this.body.setMatrixAt(n, _m);
      this.detail.setMatrixAt(n, _m);
      this.eyes.setMatrixAt(n, _m);
      _c.setHex(PLAYER_COLORS[p.color % PLAYER_COLORS.length]);
      if (a.flash > 0) _c.lerp(_white, 0.8);
      this.body.setColorAt(n, _c);
      a.head.set(0, 1.35, 0).applyMatrix4(_m);

      // ---- Bacaklar (kalçadan dönen)
      const swing = airborne ? 0.5 : Math.sin(a.phase) * 0.75 * Math.min(a.speed / 5, 1);
      for (let s = -1; s <= 1; s += 2) {
        _v.set(s * 0.19, HIP_Y, 0).applyMatrix4(_m);
        _e.set(airborne ? s * 0.35 : s * swing, 0, 0);
        _q2.setFromEuler(_e);
        _q2.premultiply(_q);
        _m2.compose(_v, _q2, _s);
        this.legs.setMatrixAt(ln, _m2);
        this.legs.setColorAt(ln, _c);
        ln++;
      }

      // ---- Mıknatıs tabancası: omuzdan bakış yönüne (pitch) döner
      _v.copy(SHOULDER).applyMatrix4(_m);
      _e.set(p.pitch, p.yaw, 0);
      _q2.setFromEuler(_e);
      const rz = a.recoil * 0.15;
      _m2.compose(_v, _q2, _s);
      if (rz) { _m2.multiply(_m.makeTranslation(0, 0, rz)); }
      this.gun.setMatrixAt(n, _m2);
      a.muzzle.copy(MUZZLE).applyMatrix4(_m2);

      // ---- Blob gölge: altındaki zemine yapışık, yükseldikçe küçülür
      const gy = groundFn ? groundFn(p.x, p.y, p.z) : 0;
      if (gy !== null && gy !== undefined) {
        const h = p.y - 0.9 - gy;
        if (h < 7) {
          const sc = Math.max(0.25, 1 - h / 8);
          _v.set(p.x, gy + 0.03, p.z);
          _s.set(sc, 1, sc);
          _m2.compose(_v, _q2.identity(), _s);
          this.blob.setMatrixAt(bn++, _m2);
          _s.set(1, 1, 1);
        }
      }
      n++;
    }
    this.body.count = n; this.detail.count = n; this.eyes.count = n; this.gun.count = n;
    this.legs.count = ln; this.blob.count = bn;
    for (const m of [this.body, this.detail, this.eyes, this.gun, this.legs, this.blob]) m.instanceMatrix.needsUpdate = true;
    this.body.instanceColor.needsUpdate = true;
    this.legs.instanceColor.needsUpdate = true;
  }
}
