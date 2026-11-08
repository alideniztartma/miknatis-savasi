// ============================================================================
// ARENA ÇİZİMİ — Havada yüzen hurdalık adası.
// Statik geometrinin hepsi halka (ring) başına TEK meshe birleştirilir (merge).
// Ada 5 halka + 1 dev mıknatıs + uzaktaki süsler = ~7 çizim çağrısı.
// Halka düşerken o halkanın tek meshini aşağı kaydırmamız yeterli.
// ============================================================================
import * as THREE from 'three';
import { TILE, TILE_THICK, MAX_RING, ringAlive, mulberry32 } from '@miknatis/shared';
import { part, merge, box, cyl, ICO0, ICO1 } from './geo.js';

const GROUND_COLORS = [0x8a6a48, 0x7d5f40, 0x96764f, 0x9a9aa0, 0x8f5a3c, 0x6f8f4a];

function tileParts(t, rand, parts) {
  // Üst yüzey: toprak / beton / paslı metal plaka
  const r = rand();
  const top = r < 0.5 ? GROUND_COLORS[Math.floor(rand() * 3)] : r < 0.72 ? GROUND_COLORS[3] : r < 0.9 ? GROUND_COLORS[4] : GROUND_COLORS[5];
  parts.push(box(top, TILE - 0.06, 0.3, TILE - 0.06, t.x, -0.15, t.z, 0, 0, 0, 0.1));
  parts.push(box(0x5b4330, TILE, TILE_THICK - 0.3, TILE, t.x, -0.3 - (TILE_THICK - 0.3) / 2, t.z, 0, 0, 0, 0.12));
  if (r >= 0.72 && r < 0.9) {
    // metal plakaya perçinler
    for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) parts.push(box(0x6b6b6b, 0.14, 0.06, 0.14, t.x + dx, 0.02, t.z + dz));
  }
  // Alt taraf: aşağı sarkan kaya (ters koni) -> "havada yüzen ada" hissi
  const h = 2.5 + rand() * 5 * (1 - t.ring * 0.12);
  parts.push(part(new THREE.ConeGeometry(2.3 + rand() * 0.5, h, 5), (tri) => (tri % 3 ? 0x6e5641 : 0x5a4636),
    t.x + (rand() - 0.5), -TILE_THICK - h / 2 + 0.2, t.z + (rand() - 0.5), Math.PI, rand() * 6, 0, 1, 1, 1, 0.15));
  // Süsler (çarpışmasız): lastik yığını, yağ birikintisi, ot, vida
  const deco = Math.floor(rand() * 3);
  for (let d = 0; d < deco; d++) {
    const x = t.x + (rand() - 0.5) * 3.2, z = t.z + (rand() - 0.5) * 3.2;
    const k = rand();
    if (k < 0.25) {
      const n = 1 + Math.floor(rand() * 3);
      for (let s = 0; s < n; s++) parts.push(part(new THREE.TorusGeometry(0.32, 0.14, 5, 8), 0x1f1f22, x, 0.14 + s * 0.24, z, Math.PI / 2, 0, 0, 1, 1, 1, 0.1));
    } else if (k < 0.45) {
      parts.push(part(new THREE.CircleGeometry(0.5 + rand() * 0.4, 7), 0x16131c, x, 0.012, z, -Math.PI / 2, 0, rand() * 3, 1, 1, 1, 0.05));
    } else if (k < 0.75) {
      for (let s = 0; s < 3; s++) parts.push(part(new THREE.ConeGeometry(0.06, 0.25 + rand() * 0.2, 3), 0x5fae3e, x + (rand() - 0.5) * 0.3, 0.12, z + (rand() - 0.5) * 0.3, 0, rand() * 3, (rand() - 0.5) * 0.4));
    } else {
      parts.push(cyl(0x8d8d95, 0.09, 0.5 + rand() * 0.6, x, 0.09, z, 0, rand() * 3, Math.PI / 2, 6));
    }
  }
}

function obstacleParts(o, rand, parts) {
  switch (o.type) {
    case 'container': {
      const c = o.x > 0 ? 0xd64541 : 0x2f80ed;
      const dark = o.x > 0 ? 0x9c2f2c : 0x1f5aa8;
      parts.push(box(c, o.hx * 2, o.hy * 2, o.hz * 2, o.x, o.y, o.z, 0, 0, 0, 0.05));
      // Oluklu yan yüzeyler
      for (let z = -o.hz + 0.3; z < o.hz - 0.2; z += 0.45) {
        for (const s of [-1, 1]) parts.push(box(dark, 0.06, o.hy * 2 - 0.2, 0.18, o.x + s * (o.hx + 0.02), o.y, o.z + z));
      }
      parts.push(box(dark, o.hx * 2 + 0.06, 0.12, o.hz * 2 + 0.06, o.x, o.y + o.hy, o.z));
      parts.push(box(0xffffff, 0.04, 0.5, 1.4, o.x + Math.sign(o.x) * (o.hx + 0.03), o.y + 0.5, o.z, 0, 0, 0, 0.02));
      break;
    }
    case 'ramp': {
      // Sarı-siyah tehlike şeritli rampa
      const n = 7;
      const len = o.hx * 2;
      const dirx = Math.cos(o.rotZ), diry = Math.sin(o.rotZ);
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n - 0.5;
        parts.push(box(i % 2 ? 0x222222 : 0xffc21a, len / n + 0.01, o.hy * 2, o.hz * 2, o.x + dirx * f * len, o.y + diry * f * len, o.z, 0, 0, o.rotZ, 0.05));
      }
      break;
    }
    case 'pillar':
      parts.push(cyl(0x8d99ae, 0.36, o.hy * 2, o.x, o.y, o.z, 0, 0, 0, 8, 0.05));
      for (let i = 0; i < 4; i++) parts.push(cyl(i % 2 ? 0x222222 : 0xffc21a, 0.375, 0.25, o.x, 0.15 + i * 0.25, o.z, 0, 0, 0, 8, 0.02));
      parts.push(cyl(0xff8a1f, 0.42, 0.18, o.x, o.y * 2 - 0.4, o.z, 0, 0, 0, 8, 0.02));
      parts.push(box(0xe8312f, 0.5, 0.25, 0.5, o.x, o.y * 2 + 0.12, o.z));
      parts.push(box(0x6b6b6b, 1.1, 0.12, 1.1, o.x, 0.06, o.z));
      break;
    case 'wall':
      parts.push(box(0x7d8ca3, o.hx * 2, o.hy * 2, o.hz * 2, o.x, o.y, o.z, 0, 0, 0, 0.08));
      for (let x = -o.hx + 0.4; x < o.hx; x += 0.6) parts.push(box(0x5d6b80, 0.08, o.hy * 2, o.hz * 2 + 0.06, o.x + x, o.y, o.z));
      parts.push(box(0xa0522d, 0.5, 0.35, o.hz * 2 + 0.08, o.x + (rand() - 0.5) * 2, o.y + 0.2, o.z));
      break;
    case 'scrap':
      for (let i = 0; i < 7; i++) {
        const c = [0xa0522d, 0x8d99ae, 0x6b4a2b, 0xc0392b, 0x555555][Math.floor(rand() * 5)];
        parts.push(box(c, 0.3 + rand() * 0.8, 0.2 + rand() * 0.6, 0.3 + rand() * 0.7,
          o.x + (rand() - 0.5) * o.hx * 1.4, o.y - 0.2 + rand() * 0.5, o.z + (rand() - 0.5) * o.hz * 1.4, rand(), rand() * 3, rand() * 0.5));
      }
      parts.push(part(new THREE.TorusGeometry(0.32, 0.14, 5, 8), 0x1f1f22, o.x + 0.5, o.y + 0.5, o.z, 0.6, 0, 0));
      break;
    case 'buoy':
      parts.push(part(ICO1, (tri) => (tri % 2 ? 0x9aa3ad : 0x7d8894), o.x, o.y, o.z, 0, 0, 0, o.r, o.r, o.r, 0.05));
      parts.push(part(new THREE.TorusGeometry(o.r * 1.05, 0.12, 4, 12), 0xff8a1f, o.x, o.y, o.z, Math.PI / 2, 0, 0));
      parts.push(box(0xe8312f, 0.3, 0.5, 0.3, o.x, o.y + o.r + 0.2, o.z));
      parts.push(box(0x3fa9ff, 0.3, 0.5, 0.3, o.x, o.y - o.r - 0.2, o.z));
      break;
    case 'bigmagnet': {
      // Dev nal mıknatıs (ağzı aşağı bakıyor)
      const c = 0xe8312f;
      parts.push(part(new THREE.TorusGeometry(1.25, 0.5, 6, 12, Math.PI), c, o.x, o.y - 0.2, o.z, 0, 0, 0, 1, 1, 1, 0.05));
      parts.push(box(c, 1.0, 1.1, 1.0, o.x - 1.25, o.y - 0.75, o.z));
      parts.push(box(c, 1.0, 1.1, 1.0, o.x + 1.25, o.y - 0.75, o.z));
      parts.push(box(0xeeeeee, 1.04, 0.45, 1.04, o.x - 1.25, o.y - 1.5, o.z));
      parts.push(box(0xeeeeee, 1.04, 0.45, 1.04, o.x + 1.25, o.y - 1.5, o.z));
      break;
    }
    default: break;
  }
}

export class ArenaMesh {
  constructor(scene, layout, baseMaterial) {
    this.layout = layout;
    this.rings = new Map(); // ring -> { mesh, mat, fall, vy }
    const byRing = new Map();
    const get = (r) => { if (!byRing.has(r)) byRing.set(r, []); return byRing.get(r); };
    const rand = mulberry32(42);
    for (const t of layout.tiles) tileParts(t, rand, get(t.ring));
    for (const o of layout.obstacles) obstacleParts(o, rand, get(o.ring));

    for (const [ring, parts] of byRing) {
      const mat = baseMaterial.clone(); // her halkanın kendi malzemesi: uyarı kırmızısı için
      const mesh = new THREE.Mesh(merge(parts), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      this.rings.set(ring, { mesh, mat, falling: false, vy: 0, spin: (ring % 2 ? 1 : -1) * 0.1 });
    }
    this.magnet = this.rings.get(-1);
    this.decor = this._buildDecor(scene, baseMaterial);
    this.time = 0;
    this.shrink = 0;
  }

  /** Uzaktaki yüzen kayalar ve küçük adalar (sadece görsel, derinlik hissi için). */
  _buildDecor(scene, mat) {
    const rand = mulberry32(7);
    const parts = [];
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2, d = 45 + rand() * 110;
      const x = Math.cos(a) * d, z = Math.sin(a) * d, y = -25 + rand() * 40;
      const s = 1.5 + rand() * 5;
      parts.push(part(ICO0, (tri) => (tri % 3 ? 0x7a5f47 : 0x5d4a3a), x, y, z, rand(), rand(), rand(), s * 1.4, s * 0.7, s, 0.15));
      if (rand() < 0.5) parts.push(part(new THREE.ConeGeometry(s * 0.8, s * 1.8, 5), 0x6aa84f, x, y + s * 0.5, z, 0, rand() * 3, 0, 1, 0.3, 1, 0.1));
    }
    const mesh = new THREE.Mesh(merge(parts), mat);
    scene.add(mesh);
    return mesh;
  }

  /** Her kare: halka uyarısı (titreme + kırmızı), düşme animasyonu, mıknatıs süzülmesi. */
  update(dt, shrink, warnRing) {
    this.time += dt;
    if (shrink < this.shrink) this.reset();
    this.shrink = shrink;
    for (const [ring, r] of this.rings) {
      const alive = ringAlive(ring, shrink);
      if (!alive && !r.falling) { r.falling = true; r.vy = 0; }
      if (r.falling) {
        r.vy -= 18 * dt;
        r.mesh.position.y += r.vy * dt;
        r.mesh.rotation.z += r.spin * dt * 0.3;
        r.mat.emissive.setRGB(0.25, 0.02, 0);
        if (r.mesh.position.y < -140) r.mesh.visible = false;
        continue;
      }
      if (ring === warnRing) {
        // Düşmek üzere: kırmızı yanıp sönme + titreme
        const s = 0.5 + 0.5 * Math.sin(this.time * 18);
        r.mat.emissive.setRGB(0.55 * s, 0.04 * s, 0);
        r.mesh.position.x = (Math.random() - 0.5) * 0.08;
        r.mesh.position.z = (Math.random() - 0.5) * 0.08;
      } else if (r.mesh.position.x !== 0 || r.mat.emissive.r !== 0) {
        r.mat.emissive.setRGB(0, 0, 0);
        r.mesh.position.x = 0; r.mesh.position.z = 0;
      }
    }
    if (this.magnet) this.magnet.mesh.position.y = Math.sin(this.time * 1.3) * 0.15;
  }

  reset() {
    for (const r of this.rings.values()) {
      r.falling = false; r.vy = 0;
      r.mesh.position.set(0, 0, 0);
      r.mesh.rotation.set(0, 0, 0);
      r.mesh.visible = true;
      r.mat.emissive.setRGB(0, 0, 0);
    }
  }
}

export { MAX_RING };
