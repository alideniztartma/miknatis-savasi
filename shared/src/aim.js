// ============================================================================
// NİŞAN — Mıknatısın hangi eşyayı çekeceğini seçer.
// Kameradan nişangâh yönüne giden bir ışın düşün. Bu ışına en yakın (açısal
// olarak) eşya seçilir. Uzaktaki eşyalar için biraz daha toleranslıyız.
// Hem sunucu (gerçek seçim) hem istemci (nişangâhın mavi yanması) kullanır.
// ============================================================================
import { PULL_RANGE, CAM_DISTANCE, ITEM_STATE, itemRadius } from './constants.js';

/**
 * @param cam  kamera konumu {x,y,z}
 * @param fwd  bakış yönü (birim vektör)
 * @param items dizi: her elemanda x,y,z,kind,state,holder
 * @param selfSlot kendi oyuncu numaramız (kendi tuttuğumuzu seçmeyelim)
 * @returns eşya indeksi ya da -1
 */
export function findAimTarget(cam, fwd, items, selfSlot) {
  let best = -1, bestScore = 1e9;
  const maxT = PULL_RANGE + CAM_DISTANCE;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || it.state === ITEM_STATE.GONE || it.holder === selfSlot) continue;
    const vx = it.x - cam.x, vy = it.y - cam.y, vz = it.z - cam.z;
    const t = vx * fwd.x + vy * fwd.y + vz * fwd.z; // ışın boyunca mesafe
    if (t < CAM_DISTANCE * 0.5 || t > maxT) continue;
    const d2 = vx * vx + vy * vy + vz * vz - t * t;
    const perp = Math.sqrt(d2 > 0 ? d2 : 0); // ışından dik uzaklık
    const allowed = 0.55 + itemRadius(it.kind) + t * 0.055;
    if (perp > allowed) continue;
    const score = perp / t + t * 0.002; // açıca yakın + biraz da yakın olanı tercih et
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}
