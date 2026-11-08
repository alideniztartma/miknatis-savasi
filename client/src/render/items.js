// ============================================================================
// EŞYALAR — Her eşya türü için TEK bir InstancedMesh.
// 22 eşya 22 çizim çağrısı yerine 7 çizim çağrısı (tür sayısı) ile çizilir.
// Çekilen/tutulan eşyaların etrafında mavi parıltı (glow) kabuğu da tek
// InstancedMesh'tir.
// ============================================================================
import * as THREE from 'three';
import { ITEM_KINDS, ITEM_STATE, itemRadius } from '@miknatis/shared';
import { part, merge, box, cyl, ICO1 } from './geo.js';

/** Eşya türü -> birleştirilmiş, renkli geometri. Boyutlar fizik şekilleriyle uyumlu. */
function buildItemGeometry(key) {
  switch (key) {
    case 'karpuz': {
      // Çizgili karpuz: üçgenin açısına göre koyu/açık yeşil şeritler
      const body = part(ICO1, (tri, g, i) => {
        const p = g.attributes.position;
        const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
        const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
        const a = Math.atan2(x, z) / (Math.PI * 2) + 0.5;
        return Math.floor(a * 10) % 2 ? 0x2f8f3a : 0x6fd35a;
      }, 0, 0, 0, 0, 0, 0, 0.37, 0.34, 0.37, 0.05);
      return merge([body, cyl(0x6b4a2b, 0.035, 0.12, 0, 0.36, 0)]);
    }
    case 'koni': {
      const cone = part(new THREE.ConeGeometry(0.24, 0.8, 8), 0xff6a13, 0, 0.02, 0);
      const band = cyl(0xffffff, 0.168, 0.13, 0, 0.0, 0, 0, 0, 0, 8);
      const band2 = cyl(0xffffff, 0.1, 0.09, 0, 0.22, 0, 0, 0, 0, 8);
      const base = box(0x222222, 0.52, 0.07, 0.52, 0, -0.42, 0);
      return merge([cone, band, band2, base]);
    }
    case 'sandalye': {
      const c = 0xe23b3b;
      const parts = [box(c, 0.58, 0.07, 0.58, 0, 0, 0), box(c, 0.58, 0.42, 0.06, 0, 0.25, -0.27)];
      for (const [x, z] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) parts.push(box(0x8a8a8a, 0.05, 0.46, 0.05, x, -0.23, z));
      parts.push(box(0xb82828, 0.5, 0.05, 0.03, 0, 0.36, -0.30));
      return merge(parts);
    }
    case 'mikrodalga': return merge([
      box(0xe8e8ea, 0.72, 0.48, 0.56),
      box(0x1d2733, 0.42, 0.32, 0.02, -0.1, 0, 0.285),
      box(0x55606c, 0.16, 0.38, 0.02, 0.25, 0, 0.285),
      box(0xff3b3b, 0.05, 0.05, 0.02, 0.25, 0.1, 0.3), box(0x3bff7a, 0.05, 0.05, 0.02, 0.25, 0.0, 0.3),
      box(0xbfc4c9, 0.03, 0.26, 0.03, 0.13, 0, 0.3),
    ]);
    case 'varil': return merge([
      cyl(0xc62f2f, 0.36, 1.0, 0, 0, 0, 0, 0, 0, 10),
      cyl(0x8e1f1f, 0.375, 0.05, 0, 0.3, 0, 0, 0, 0, 10),
      cyl(0x8e1f1f, 0.375, 0.05, 0, -0.3, 0, 0, 0, 0, 10),
      cyl(0xffd23f, 0.368, 0.14, 0, 0, 0, 0, 0, 0, 10),
      cyl(0x6b6b6b, 0.08, 0.03, 0.15, 0.5, 0.05),
    ]);
    case 'kasa': {
      const parts = [box(0xc8935a, 0.96, 0.96, 0.96)];
      const d = 0x7a4f26, t = 0.12, e = 0.47;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        parts.push(box(d, 1.0, t, t, 0, sy * e, sx * e));
        parts.push(box(d, t, 1.0, t, sx * e, 0, sy * e));
        parts.push(box(d, t, t, 1.0, sx * e, sy * e, 0));
      }
      // Ön ve arkada çapraz tahta
      parts.push(box(d, 0.1, 1.2, 0.04, 0, 0, 0.49, 0, 0, Math.PI / 4));
      parts.push(box(d, 0.1, 1.2, 0.04, 0, 0, -0.49, 0, 0, -Math.PI / 4));
      return merge(parts);
    }
    case 'buzdolabi': return merge([
      box(0xbfe8e0, 0.88, 1.72, 0.8),
      box(0x8fb8b0, 0.86, 0.03, 0.02, 0, 0.32, 0.405),
      box(0xd8dde2, 0.05, 0.4, 0.06, 0.34, 0.65, 0.43),
      box(0xd8dde2, 0.05, 0.6, 0.06, 0.34, -0.1, 0.43),
      box(0xff4d5e, 0.12, 0.12, 0.02, -0.2, 0.6, 0.41), // magnet süsler :)
      box(0x3fa9ff, 0.1, 0.14, 0.02, -0.05, 0.45, 0.41),
      box(0xffd23f, 0.14, 0.1, 0.02, -0.25, 0.1, 0.41),
    ]);
    default: return box(0xff00ff, 0.5, 0.5, 0.5);
  }
}

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _col = new THREE.Color();

export class ItemMeshes {
  constructor(scene, material) {
    this.meshes = ITEM_KINDS.map((k) => {
      const m = new THREE.InstancedMesh(buildItemGeometry(k.key), material, k.count + 1);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.receiveShadow = false;
      m.frustumCulled = false; // örnekler arenaya yayılı; sınır küresi hesabıyla uğraşmayalım
      m.count = 0;
      scene.add(m);
      return m;
    });
    // Mıknatıs parıltısı (mavi kabuk)
    this.glow = new THREE.InstancedMesh(ICO1, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false,
    }), 24);
    this.glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glow.frustumCulled = false;
    this.glow.count = 0;
    scene.add(this.glow);
    this.time = 0;
  }

  /**
   * @param items görünüm eşyaları (x,y,z,qx..qw,kind,state)
   * @param target nişangâhın gösterdiği eşya (-1 yoksa)
   */
  update(items, target, dt) {
    this.time += dt;
    for (const m of this.meshes) m.count = 0;
    let g = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || it.state === ITEM_STATE.GONE) continue;
      const mesh = this.meshes[it.kind];
      _pos.set(it.x, it.y, it.z);
      _quat.set(it.qx, it.qy, it.qz, it.qw);
      _scale.set(1, 1, 1);
      _mat.compose(_pos, _quat, _scale);
      mesh.setMatrixAt(mesh.count++, _mat);

      // Parıltı: çekilen/tutulan = mavi nabız, nişan alınan = beyaz
      const pulled = it.state === ITEM_STATE.PULLED || it.state === ITEM_STATE.HELD;
      if ((pulled || i === target) && g < 24) {
        const r = itemRadius(it.kind) * (pulled ? 1.45 + Math.sin(this.time * 14 + i) * 0.08 : 1.3);
        _scale.set(r, r, r);
        _mat.compose(_pos, _quat, _scale);
        this.glow.setMatrixAt(g, _mat);
        _col.set(pulled ? (it.state === ITEM_STATE.HELD ? 0x2f8cff : 0x56d6ff) : 0x9a9a9a);
        this.glow.setColorAt(g, _col);
        g++;
      }
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
    this.glow.count = g;
    this.glow.instanceMatrix.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
  }
}

