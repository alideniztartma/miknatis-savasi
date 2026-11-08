// ============================================================================
// İSTEMCİ TARAFI TAHMİN (Client-side Prediction) + UZLAŞMA (Reconciliation)
//
// Sorun: Sunucu her şeyi hesaplıyor. Tuşa bastığında cevabın gelmesi
// ping kadar (ör. 80 ms) sürer -> karakter "lastik gibi" geç tepki verir.
//
// Çözüm:
//  1) Girdiyi sunucuya yollarken AYNI ANDA kendi bilgisayarında da uygula
//     (aynı applyMovement fonksiyonu, aynı arena, aynı Rapier). Anında tepki!
//  2) Her girdiyi numarasıyla (seq) bir geçmiş listesinde sakla.
//  3) Sunucudan durum gelince: "en son şu numaralı girdini işledim (ack),
//     sonuçta buradasın" der. Sunucunun konumuna geri dön, henüz işlenmemiş
//     girdileri tekrar oynat (replay). Sonuç tahminden farklıysa, farkı
//     birden değil yumuşakça kapat (görsel ofset).
// Diğer oyuncular / eşyalar tahmin edilmez, ara değerle (interpolation) çizilir.
// ============================================================================
import {
  SERVER_TICK_HZ, MAX_SUBSTEP, PLAYER_HALF_HEIGHT, PLAYER_RADIUS, PLAYER_MASS, CG_PLAYER,
  createWorld, buildArenaColliders, applyShrink, buildArenaLayout,
  createMotor, applyMovement, createInput, copyInput, raycastMetal, aimOrigin, forwardFromAngles,
  BTN, HOOK_RANGE, HOOK_MAX_TIME, HOOK_COOLDOWN, clamp,
} from '@miknatis/shared';

const HISTORY = 64;

export class Predictor {
  constructor(RAPIER) {
    this.R = RAPIER;
    this.dt = 1 / SERVER_TICK_HZ;
    this.substeps = Math.max(1, Math.ceil(this.dt / MAX_SUBSTEP - 1e-6));
    this.world = createWorld(RAPIER, this.dt / this.substeps);
    this.layout = buildArenaLayout();
    this.arena = buildArenaColliders(RAPIER, this.world, this.layout);
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -50, 0).lockRotations().setCanSleep(false));
    this.world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS).setMass(PLAYER_MASS).setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setCollisionGroups(CG_PLAYER),
      this.body,
    );
    this.motor = createMotor();
    this.hist = [];
    for (let i = 0; i < HISTORY; i++) this.hist.push({ input: createInput(), jumpCd: 0 });
    this.hHead = 0;
    this.hCount = 0;
    this.prev = { x: 0, y: -50, z: 0 };
    this.cur = { x: 0, y: -50, z: 0 };
    this.offset = { x: 0, y: 0, z: 0 }; // düzeltme farkı, yavaşça sıfıra iner
    this._v = { x: 0, y: 0, z: 0 };
    this.corrections = 0; // hata ayıklama: kaç kez belirgin düzeltme yapıldı
    this.hookCd = 0;
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    this._hit = { x: 0, y: 0, z: 0 };
  }

  setShrink(s) { if (this.arena.shrink !== s) applyShrink(this.arena, s); }

  _stepWorld(input) {
    // Kancayı da tahmin et (E'ye basınca beklemeden çekilmeye başla). Sunucu
    // aynı ışını atar; sonuç farklıysa uzlaşma düzeltir.
    if (this.hookCd > 0) this.hookCd -= this.dt;
    if (input.buttons & BTN.HOOK) {
      const m = this.motor;
      if (m.hookOn) m.hookOn = false;
      else if (this.hookCd <= 0) {
        const t = this.body.translation();
        aimOrigin(t.x, t.y, t.z, input.yaw, input.pitch, this.ray.origin);
        forwardFromAngles(input.yaw, clamp(input.pitch, -1.15, 1.0), this.ray.dir);
        if (raycastMetal(this.world, this.arena, this.ray, HOOK_RANGE, this._hit)) {
          m.hookOn = true; m.hx = this._hit.x; m.hy = this._hit.y; m.hz = this._hit.z; m.hookT = HOOK_MAX_TIME; m.stun = 0;
          this.hookCd = HOOK_COOLDOWN;
        }
      }
    }
    applyMovement(this.R, this.world, this.body, this.motor, input, this.dt);
    for (let s = 0; s < this.substeps; s++) this.world.step();
  }

  /** Yeni bir girdi: geçmişe kaydet ve hemen uygula. */
  step(input) {
    if (this.hCount >= HISTORY) { this.hHead = (this.hHead + 1) % HISTORY; this.hCount--; }
    const h = this.hist[(this.hHead + this.hCount) % HISTORY];
    copyInput(h.input, input);
    h.jumpCd = this.motor.jumpCd;
    this.hCount++;
    this.prev.x = this.cur.x; this.prev.y = this.cur.y; this.prev.z = this.cur.z;
    this._stepWorld(input);
    const t = this.body.translation();
    this.cur.x = t.x; this.cur.y = t.y; this.cur.z = t.z;
  }

  /**
   * Sunucu durumu geldi. s: { x,y,z, vx,vy,vz (metre), ack, stun, hook, hx,hy,hz, hookT, hookCd, slow, frozen }
   */
  reconcile(s) {
    // Sunucunun işlediği girdileri geçmişten at
    while (this.hCount > 0 && this.hist[this.hHead].input.seq <= s.ack) {
      this.hHead = (this.hHead + 1) % HISTORY;
      this.hCount--;
    }
    const bx = this.cur.x, by = this.cur.y, bz = this.cur.z;
    // Sunucunun söylediği yere dön...
    this._v.x = s.x; this._v.y = s.y; this._v.z = s.z;
    this.body.setTranslation(this._v, true);
    this._v.x = s.vx; this._v.y = s.vy; this._v.z = s.vz;
    this.body.setLinvel(this._v, true);
    const m = this.motor;
    m.stun = s.stun; m.hookOn = s.hook; m.hx = s.hx; m.hy = s.hy; m.hz = s.hz; m.hookT = s.hookT;
    m.slow = s.slow; m.frozen = s.frozen;
    this.hookCd = s.hookCd;
    if (this.hCount > 0) m.jumpCd = this.hist[this.hHead].jumpCd;
    // ...ve henüz onaylanmamış girdileri yeniden oynat
    for (let i = 0; i < this.hCount; i++) this._stepWorld(this.hist[(this.hHead + i) % HISTORY].input);
    const t = this.body.translation();
    const dx = t.x - bx, dy = t.y - by, dz = t.z - bz;
    this.cur.x = t.x; this.cur.y = t.y; this.cur.z = t.z;
    this.prev.x += dx; this.prev.y += dy; this.prev.z += dz;
    // Ekranda zıplama olmasın: farkı ofsete ekle, ofset zamanla erir
    this.offset.x -= dx; this.offset.y -= dy; this.offset.z -= dz;
    const err = Math.hypot(this.offset.x, this.offset.y, this.offset.z);
    if (err > 0.05) this.corrections++;
    if (err > 3.5) { this.offset.x = 0; this.offset.y = 0; this.offset.z = 0; } // çok büyük: ışınlan
  }

  /** Çizilecek konum: son iki tahmin arasında ara değer + yumuşak düzeltme. */
  renderPos(alpha, dt, out) {
    const k = Math.exp(-12 * dt);
    this.offset.x *= k; this.offset.y *= k; this.offset.z *= k;
    out.x = this.prev.x + (this.cur.x - this.prev.x) * alpha + this.offset.x;
    out.y = this.prev.y + (this.cur.y - this.prev.y) * alpha + this.offset.y;
    out.z = this.prev.z + (this.cur.z - this.prev.z) * alpha + this.offset.z;
    return out;
  }

  /** Oyuncu yeniden doğdu / ışınlandı: geçmişi temizle. */
  teleport(x, y, z) {
    this._v.x = x; this._v.y = y; this._v.z = z;
    this.body.setTranslation(this._v, true);
    this._v.x = 0; this._v.y = 0; this._v.z = 0;
    this.body.setLinvel(this._v, true);
    this.prev.x = this.cur.x = x; this.prev.y = this.cur.y = y; this.prev.z = this.cur.z = z;
    this.offset.x = this.offset.y = this.offset.z = 0;
    this.hCount = 0;
  }

  dispose() { this.world.free(); }
}
