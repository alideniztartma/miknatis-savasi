// ============================================================================
// GEOMETRİ YARDIMCILARI
// Low-poly görünüm: her parçaya köşe rengi (vertex color) veriyoruz ve aynı
// nesnenin parçalarını TEK geometride birleştiriyoruz (merge). Böylece bir
// sandalye 6 ayrı çizim çağrısı (draw call) yerine 1 tane olur.
// Harici model dosyası YOK: her şey Three.js'in temel şekilleriyle yapılır.
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Bir geometriyi renklendirip konumlandırır.
 * @param geo   Three.js geometrisi (kopyalanır)
 * @param color renk (hex) ya da (i, tri) => hex fonksiyonu (üçgen başına renk)
 * @param jitter renk oynaması (0..1) - el yapımı, düzensiz görünüm için
 */
export function part(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, jitter = 0.06, seed = 1) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  const n = g.attributes.position.count;
  const cols = new Float32Array(n * 3);
  let r = seed * 9301 + 49297;
  for (let i = 0; i < n; i += 3) {
    const tri = i / 3;
    _c.set(typeof color === 'function' ? color(tri, g, i) : color);
    // Üçgen başına küçük renk oynaması: düz renkten daha "elle boyanmış" görünür
    r = (r * 9301 + 49297) % 233280;
    const j = 1 + ((r / 233280) - 0.5) * 2 * jitter;
    for (let k = 0; k < 3 && i + k < n; k++) {
      cols[(i + k) * 3] = Math.min(1, _c.r * j);
      cols[(i + k) * 3 + 1] = Math.min(1, _c.g * j);
      cols[(i + k) * 3 + 2] = Math.min(1, _c.b * j);
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

export function merge(parts) {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

// Sık kullanılan temel şekiller (tekrar tekrar oluşturmamak için)
export const BOX = new THREE.BoxGeometry(1, 1, 1);
export const CYL6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
export const CYL8 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
export const CYL10 = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
export const ICO1 = new THREE.IcosahedronGeometry(1, 1);
export const ICO0 = new THREE.IcosahedronGeometry(1, 0);

/** Kutu kısayolu: genişlik/yükseklik/derinlik ile. */
export function box(color, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, jitter = 0.06) {
  return part(BOX, color, x, y, z, rx, ry, rz, w, h, d, jitter);
}
/** Silindir kısayolu: yarıçap, yükseklik. */
export function cyl(color, r, h, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 8, jitter = 0.06) {
  const g = seg === 6 ? CYL6 : seg === 10 ? CYL10 : CYL8;
  return part(g, color, x, y, z, rx, ry, rz, r * 2, h, r * 2, jitter);
}

/** Yumuşak yuvarlak gölge dokusu (blob shadow ve parıltılar için). */
export function radialTexture(inner = 'rgba(0,0,0,0.55)', outer = 'rgba(0,0,0,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
