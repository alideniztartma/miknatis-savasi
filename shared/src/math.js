// ============================================================================
// Küçük matematik yardımcıları. Hepsi "out" parametresine yazar, yeni nesne
// OLUŞTURMAZ. Oyun döngüsü saniyede onlarca kez çalıştığı için çöp toplayıcıyı
// (garbage collector) yormamak önemli.
// ============================================================================
import {
  CAM_DISTANCE, CAM_RIGHT, CAM_UP, EYE_HEIGHT, PITCH_MAX, PITCH_MIN,
} from './constants.js';

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function set(out, x, y, z) { out.x = x; out.y = y; out.z = z; return out; }
export function copy(out, a) { out.x = a.x; out.y = a.y; out.z = a.z; return out; }
export function len(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
export function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
export function normalize(out, a) {
  const l = len(a) || 1;
  out.x = a.x / l; out.y = a.y / l; out.z = a.z / l;
  return out;
}

/** İki açı arasındaki en kısa fark (-PI..PI). */
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Bakış yönü: yaw (sağ-sol) ve pitch (yukarı-aşağı) açılarından birim vektör.
 * Three.js'te kamera varsayılan olarak -Z yönüne bakar, biz de aynı kuralı kullanırız.
 */
export function forwardFromAngles(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

/**
 * Omuz üstü (third-person) kamera konumu. Sunucu da nişan ışınını buradan
 * başlatır; böylece ekrandaki nişangâh tam olarak sunucunun hesapladığı yere bakar.
 * px,py,pz = oyuncu gövde merkezi.
 */
export function cameraFromPlayer(px, py, pz, yaw, pitch, out) {
  const p = clamp(pitch, PITCH_MIN, PITCH_MAX);
  const cp = Math.cos(p);
  const fx = -Math.sin(yaw) * cp, fy = Math.sin(p), fz = -Math.cos(yaw) * cp;
  // Yukarı bakarken kamera yere girmesin diye yaklaşır
  const d = p > 0 ? CAM_DISTANCE * (1 - p * 0.45) : CAM_DISTANCE;
  const rx = Math.cos(yaw), rz = -Math.sin(yaw); // sağ vektörü
  out.x = px - fx * d + rx * CAM_RIGHT;
  out.y = py + EYE_HEIGHT + CAM_UP - fy * d;
  out.z = pz - fz * d + rz * CAM_RIGHT;
  return out;
}

/**
 * Nişan ışınlarının (kanca, fırlatma hedefi) başlangıç noktası: kamera ile aynı
 * çizgi üzerinde ama oyuncunun hemen arkasında. Böylece kamera bir duvarın içine
 * girse bile ışın o duvara takılmaz, nişangâh yine doğru yeri gösterir.
 */
export function aimOrigin(px, py, pz, yaw, pitch, out) {
  cameraFromPlayer(px, py, pz, yaw, pitch, out);
  const p = clamp(pitch, PITCH_MIN, PITCH_MAX);
  const d = (p > 0 ? CAM_DISTANCE * (1 - p * 0.45) : CAM_DISTANCE) - 0.7;
  const cp = Math.cos(p);
  out.x += -Math.sin(yaw) * cp * d;
  out.y += Math.sin(p) * d;
  out.z += -Math.cos(yaw) * cp * d;
  return out;
}

// ---------------------------------------------------------------- Sıkıştırma
// Konumlar ağda santimetre cinsinden tam sayı (int16) olarak gider: 1 cm hassasiyet.
export const toCm = (m) => clamp(Math.round(m * 100), -32767, 32767);
export const fromCm = (c) => c * 0.01;
// Açılar int16: radyan * 10000 (±π sığar)
export const packAngle = (a) => clamp(Math.round(a * 10000), -32767, 32767);
export const unpackAngle = (v) => v / 10000;

/**
 * "En küçük üç" (smallest three) quaternion sıkıştırma: 4 sayı (16 bayt) yerine
 * tek bir 32 bit tam sayı (4 bayt). En büyük bileşen atılır (diğerlerinden
 * hesaplanabilir çünkü x²+y²+z²+w² = 1), kalan üçü 10'ar bit ile saklanır.
 */
const QMAX = 0.7071068; // 1/√2: atılmayan bileşenler bu aralıktadır
export function packQuat(x, y, z, w) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z), aw = Math.abs(w);
  let i = 0, m = ax;
  if (ay > m) { i = 1; m = ay; }
  if (az > m) { i = 2; m = az; }
  if (aw > m) { i = 3; m = aw; }
  // En büyük bileşen pozitif olacak şekilde işaret çevir (q ve -q aynı dönüştür)
  const big = i === 0 ? x : i === 1 ? y : i === 2 ? z : w;
  const s = big < 0 ? -1 : 1;
  let a, b, c;
  if (i === 0) { a = y; b = z; c = w; } else if (i === 1) { a = x; b = z; c = w; } else if (i === 2) { a = x; b = y; c = w; } else { a = x; b = y; c = z; }
  const q = (v) => clamp(Math.round(((v * s) / QMAX * 0.5 + 0.5) * 1023), 0, 1023);
  return ((i << 30) | (q(a) << 20) | (q(b) << 10) | q(c)) >>> 0;
}
export function unpackQuat(p, out) {
  const i = p >>> 30;
  const d = (v) => ((v / 1023) - 0.5) * 2 * QMAX;
  const a = d((p >>> 20) & 1023), b = d((p >>> 10) & 1023), c = d(p & 1023);
  const big = Math.sqrt(Math.max(0, 1 - a * a - b * b - c * c));
  if (i === 0) { out.x = big; out.y = a; out.z = b; out.w = c; } else if (i === 1) { out.x = a; out.y = big; out.z = b; out.w = c; } else if (i === 2) { out.x = a; out.y = b; out.z = big; out.w = c; } else { out.x = a; out.y = b; out.z = c; out.w = big; }
  return out;
}

/** Basit, tohumlanabilir rastgele sayı üreteci (arena dekorları her yerde aynı çıksın). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
