// ============================================================================
// FİZİK DÜNYASI KURULUMU (Rapier)
// Arenanın statik çarpışma kutularını oluşturur. Hem Simulation (sunucu / tek
// oyunculu) hem de istemcideki Predictor (kendi oyuncumuzu tahmin etmek için)
// bu fonksiyonu kullanır.
// Not: Sadece basit şekiller (kutu, küre, kapsül) kullanıyoruz; trimesh YOK.
// Basit şekillerin çarpışma testi çok ucuzdur -> zayıf sunucu rahatlar.
// ============================================================================
import { TILE, TILE_THICK, ringAlive } from './arena.js';
import { CG_ARENA, GRAVITY } from './constants.js';

/**
 * Rapier dünyasını oluşturur.
 * @param RAPIER  dışarıdan verilen Rapier modülü (tarayıcıda tembel yüklenir)
 */
export function createWorld(RAPIER, subDt) {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = subDt;
  return world;
}

/**
 * Arena karolarını ve engelleri dünyaya ekler.
 * Dönen nesne: halka -> çarpıştırıcı listesi, ve tutamaç (handle) -> bilgi haritası.
 */
export function buildArenaColliders(RAPIER, world, layout) {
  const rings = new Map(); // ring -> [collider]
  const meta = new Map(); // collider.handle -> { metal, ring, obstacle }
  const push = (ring, col, info) => {
    if (!rings.has(ring)) rings.set(ring, []);
    rings.get(ring).push(col);
    meta.set(col.handle, info);
  };

  // Karolar: hepsini tek bir sabit (fixed) gövdeye bağlı ayrı kutular olarak ekliyoruz.
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (const t of layout.tiles) {
    const desc = RAPIER.ColliderDesc.cuboid(TILE / 2, TILE_THICK / 2, TILE / 2)
      .setTranslation(t.x, -TILE_THICK / 2, t.z)
      .setFriction(0.8)
      .setCollisionGroups(CG_ARENA);
    push(t.ring, world.createCollider(desc, ground), { metal: false, ring: t.ring, kind: 'tile' });
  }

  for (const o of layout.obstacles) {
    let desc;
    if (o.ball) desc = RAPIER.ColliderDesc.ball(o.r);
    else desc = RAPIER.ColliderDesc.cuboid(o.hx, o.hy, o.hz);
    desc.setTranslation(o.x, o.y, o.z).setFriction(0.6).setCollisionGroups(CG_ARENA);
    if (o.rotZ) {
      const h = o.rotZ / 2;
      desc.setRotation({ x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) });
    }
    push(o.ring, world.createCollider(desc, ground), { metal: o.metal, ring: o.ring, kind: o.type, obstacle: o });
  }
  return { rings, meta, shrink: 0 };
}

/** Küçülme seviyesini uygular: düşen halkaların çarpıştırıcılarını kapatır. */
export function applyShrink(arena, shrink) {
  arena.shrink = shrink;
  for (const [ring, cols] of arena.rings) {
    const alive = ringAlive(ring, shrink);
    for (let i = 0; i < cols.length; i++) {
      if (cols[i].isEnabled() !== alive) cols[i].setEnabled(alive);
    }
  }
}

/**
 * Nişan ışınıyla metal yüzey ara (kanca için). Bulursa çarpma noktasını out'a yazar.
 * Sadece arena grubundaki çarpıştırıcılara bakar.
 */
export function raycastMetal(world, arena, ray, maxDist, out) {
  const hit = world.castRay(ray, maxDist, true, undefined, (0xffff << 16) | 2 /* GROUP_ARENA */);
  if (!hit) return false;
  const info = arena.meta.get(hit.collider.handle);
  if (!info || !info.metal) return false;
  const t = hit.timeOfImpact;
  out.x = ray.origin.x + ray.dir.x * t;
  out.y = ray.origin.y + ray.dir.y * t;
  out.z = ray.origin.z + ray.dir.z * t;
  return true;
}
