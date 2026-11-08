// ============================================================================
// GİRDİ (INPUT) — İstemcinin sunucuya gönderdiği tek şey budur.
// Server-authoritative modelde istemci "şuraya gittim" demez, sadece
// "şu tuşlara basıyorum, şuraya bakıyorum" der. Sonucu sunucu hesaplar.
// Ağ paketi küçük bir sayı dizisidir: [seq, mx, mz, yaw, pitch, butonlar]
// ============================================================================
import { packAngle, unpackAngle, clamp } from './math.js';

// Buton bitleri
export const BTN = {
  JUMP: 1, // basılı tutma (seviye)
  PULL: 2, // sol tık basılı (seviye)
  THROW: 4, // sağ tık BASILDI (kenar: bir kez)
  HOOK: 8, // E BASILDI (kenar)
  PULL_PRESS: 16, // sol tık BASILDI (kenar) - tutulan eşyayı bırakmak için
};
export const EDGE_MASK = BTN.THROW | BTN.HOOK | BTN.PULL_PRESS;

export function createInput() {
  return { seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, jump: false };
}

export function copyInput(dst, src) {
  dst.seq = src.seq; dst.mx = src.mx; dst.mz = src.mz; dst.yaw = src.yaw; dst.pitch = src.pitch;
  dst.buttons = src.buttons; dst.jump = src.jump;
}

/** Ağ için diziye çevir (msgpack bunu ~12 bayta sıkıştırır). */
export function encodeInput(inp, arr) {
  arr[0] = inp.seq;
  arr[1] = Math.round(clamp(inp.mx, -1, 1) * 100);
  arr[2] = Math.round(clamp(inp.mz, -1, 1) * 100);
  arr[3] = packAngle(inp.yaw);
  arr[4] = packAngle(inp.pitch);
  arr[5] = inp.buttons;
  return arr;
}

/** Sunucu tarafında: gelen diziyi doğrulayıp girdiye çevir (hileye karşı sınırlar). */
export function decodeInput(arr, out) {
  if (!Array.isArray(arr) || arr.length < 6) return false;
  for (let i = 0; i < 6; i++) if (typeof arr[i] !== 'number' || !Number.isFinite(arr[i])) return false;
  out.seq = arr[0] >>> 0;
  out.mx = clamp(arr[1], -100, 100) / 100;
  out.mz = clamp(arr[2], -100, 100) / 100;
  out.yaw = unpackAngle(clamp(arr[3], -32767, 32767));
  out.pitch = unpackAngle(clamp(arr[4], -32767, 32767));
  out.buttons = arr[5] & 31;
  out.jump = (out.buttons & BTN.JUMP) !== 0;
  return true;
}
