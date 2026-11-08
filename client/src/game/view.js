// ============================================================================
// GÖRÜNÜM (View) — Çizicinin ve arayüzün okuduğu ortak veri yapısı.
// Tek oyunculu (LocalSession) ve çok oyunculu (NetSession) oturumlar bu
// yapıyı doldurur. Böylece çizim kodu, verinin nereden geldiğini bilmez.
// Nesneler bir kez oluşturulur, her karede sadece alanları güncellenir.
// ============================================================================
import { MAX_SLOTS, ITEM_COUNT } from '@miknatis/shared';

export function createView() {
  const players = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    players.push({
      exists: false, slot: i, name: '', color: 0, bot: false, afk: false, inRound: false, alive: false,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hold: -1, pull: -1, stun: 0,
      hook: false, hx: 0, hy: 0, hz: 0, pushCd: 0, hookCd: 0,
      kills: 0, hits: 0, place: 0, wins: 0, isLocal: false, sid: '',
    });
  }
  const items = [];
  for (let i = 0; i < ITEM_COUNT; i++) {
    items.push({ id: i, kind: 0, state: 0, holder: -1, x: 0, y: -100, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 });
  }
  return {
    phase: 0, timer: 0, shrink: 0, warnRing: -1, alive: 0, total: 0, winner: -1,
    localSlot: -1, isHost: true, code: '', diff: 'orta', fill: 6,
    players, items,
    /** Görünürde olanlar (undefined boşluklar yerine null) */
    list() { return players; },
  };
}

/** İki açı arasında kısa yoldan yumuşak geçiş. */
export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Quaternion normalize-lerp (slerp'ün ucuz hâli, küçük açılar için yeterli). */
export function nlerpQuat(out, ax, ay, az, aw, bx, by, bz, bw, t) {
  if (ax * bx + ay * by + az * bz + aw * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t, w = aw + (bw - aw) * t;
  const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  out.qx = x / l; out.qy = y / l; out.qz = z / l; out.qw = w / l;
}
