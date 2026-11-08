// ============================================================================
// ARENA DÜZENİ — Havada yüzen hurdalık adası.
// Burada sadece "veri" var (konumlar, boyutlar). Fizik dünyası (physicsWorld.js)
// ve istemcinin çizimi (client/render/arenaMesh.js) bu veriyi okuyarak
// AYNI arenayı kurar. Böylece sunucu ile tarayıcı asla farklı arena görmez.
//
// Ada 4 m'lik kare karolardan (tile) oluşur. Her karonun bir "halka" (ring)
// numarası var: merkez 0, en dış 4. Süre bitince dış halkalar sırayla düşer.
// ============================================================================
import { ITEM_KINDS, ITEM_COUNT } from './constants.js';
import { mulberry32 } from './math.js';

export const TILE = 4; // karo kenarı (m)
export const TILE_THICK = 1.2; // karo kalınlığı
export const GRID = 4; // -4..4 arası karo indeksi
export const MAX_RING = 4;

function ringOf(i, j) {
  return Math.min(MAX_RING, Math.floor(Math.sqrt(i * i + j * j) + 0.5));
}

/** Arena verisini bir kez üretir. Sonuç her yerde aynıdır (rastgelelik tohumlu). */
export function buildArenaLayout() {
  const tiles = [];
  const N = GRID * 2 + 1;
  const grid = new Array(N * N).fill(null); // hızlı arama: [i][j] -> karo
  for (let i = -GRID; i <= GRID; i++) {
    for (let j = -GRID; j <= GRID; j++) {
      if (i * i + j * j > 18.5) continue; // köşeleri kes -> yuvarlak ada
      const t = { i, j, x: i * TILE, z: j * TILE, ring: ringOf(i, j), id: tiles.length };
      tiles.push(t);
      grid[(i + GRID) * N + (j + GRID)] = t;
    }
  }

  // Statik engeller. hx/hy/hz = yarım boyut, rotZ = z ekseninde eğim (rampalar için).
  // metal: true olanlara kanca (E) atılabilir.
  const obstacles = [];
  const add = (o) => { o.id = obstacles.length; obstacles.push(o); };
  // İki konteyner (doğu ve batı kenarında) + üstlerine çıkan rampalar
  for (const s of [1, -1]) {
    add({ type: 'container', x: 12.2 * s, y: 1.3, z: 0, hx: 1.3, hy: 1.3, hz: 3.1, rotZ: 0, metal: true, ring: 3 });
    const ang = Math.atan2(2.6, 4.4);
    add({ type: 'ramp', x: 8.6 * s, y: 1.15, z: 0, hx: 2.55, hy: 0.15, hz: 1.2, rotZ: ang * s, metal: false, ring: 3 });
  }
  // Metal direkler (kanca için) - 3. halkada
  for (const [x, z] of [[8, 8], [-8, 8], [8, -8], [-8, -8], [0, 13.2], [0, -13.2]]) {
    add({ type: 'pillar', x, y: 3.5, z, hx: 0.35, hy: 3.5, hz: 0.35, rotZ: 0, metal: true, ring: 3 });
  }
  // Alçak metal duvarlar (siper) - 2. halka
  for (const [x, z] of [[4, 9.2], [-4, 9.2], [4, -9.2], [-4, -9.2]]) {
    add({ type: 'wall', x, y: 0.7, z, hx: 1.5, hy: 0.7, hz: 0.14, rotZ: 0, metal: true, ring: 2 });
  }
  // Hurda yığınları (alçak siper) - 1. halka
  for (const [x, z] of [[-4.5, 4.5], [4.5, -4.5]]) {
    add({ type: 'scrap', x, y: 0.45, z, hx: 0.9, hy: 0.45, hz: 0.7, rotZ: 0, metal: false, ring: 1 });
  }
  // Havada yüzen mıknatıs şamandıraları (sadece kanca için, dış halkayla birlikte düşer)
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    add({ type: 'buoy', x: Math.cos(a) * 23, y: 4.5, z: Math.sin(a) * 23, r: 0.9, hx: 0.9, hy: 0.9, hz: 0.9, rotZ: 0, metal: true, ring: 4, ball: true });
  }
  // Merkezin üstündeki dev mıknatıs: hiç düşmez (ring -1). Son anlarda kurtarıcı olabilir!
  add({ type: 'bigmagnet', x: 0, y: 12.5, z: 0, hx: 1.8, hy: 0.6, hz: 1.8, rotZ: 0, metal: true, ring: -1 });

  // Oyuncu doğma noktaları: 2. halkada bir çember, merkeze bakar
  const spawns = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * 8, z = Math.sin(a) * 8;
    spawns.push({ x, z, yaw: Math.atan2(x, z) }); // yaw: merkeze bak (-Z kuralı)
  }

  // Eşya doğma noktaları: engeli olmayan, 0-3. halkadaki karolar (tohumlu karıştırma)
  const rand = mulberry32(1337);
  const free = tiles.filter((t) => t.ring <= 3 && !obstacles.some((o) => o.type !== 'buoy' && o.type !== 'bigmagnet'
    && Math.abs(o.x - t.x) < o.hx + 1.6 && Math.abs(o.z - t.z) < o.hz + 1.6));
  for (let k = free.length - 1; k > 0; k--) { const r = Math.floor(rand() * (k + 1)); [free[k], free[r]] = [free[r], free[k]]; }
  const itemSpawns = [];
  for (let k = 0; k < ITEM_COUNT; k++) {
    const t = free[k % free.length];
    const off = k >= free.length ? 1.2 : 0; // karo sayısı yetmezse kaydır
    itemSpawns.push({ x: t.x + (rand() - 0.5) * 1.6 + off, z: t.z + (rand() - 0.5) * 1.6, ring: t.ring });
  }

  // Eşya türlerini sırayla diz: [karpuz x4, koni x3, ...]
  const itemKinds = [];
  for (const k of ITEM_KINDS) for (let c = 0; c < k.count; c++) itemKinds.push(k.id);

  return { tiles, grid, obstacles, spawns, itemSpawns, itemKinds };
}

/** Bu halka, verilen küçülme seviyesinde hâlâ duruyor mu? */
export function ringAlive(ring, shrink) {
  return ring < 0 || ring <= MAX_RING - shrink;
}

/** (x,z) noktasının altında hâlâ zemin var mı? (botların kenardan kaçması için) */
export function isOnArena(layout, x, z, shrink) {
  const i = Math.round(x / TILE), j = Math.round(z / TILE);
  if (i < -GRID || i > GRID || j < -GRID || j > GRID) return false;
  const t = layout.grid[(i + GRID) * (GRID * 2 + 1) + (j + GRID)];
  return !!t && ringAlive(t.ring, shrink);
}

/** Şu an ayakta duran arenanın yaklaşık yarıçapı. */
export function arenaRadius(shrink) {
  return (MAX_RING - shrink + 0.5) * TILE;
}
