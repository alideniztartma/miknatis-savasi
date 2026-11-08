// ============================================================================
// TEK OYUNCULU OTURUM
// /shared içindeki Simulation'ı doğrudan tarayıcıda çalıştırır (sunucu yok!).
// 60 Hz sabit adım; çizim, son iki adım arasında ara değer (interpolation)
// alarak yapılır, böylece ekran yenileme hızı ne olursa olsun akıcı görünür.
// ============================================================================
import {
  Simulation, LOCAL_TICK_HZ, MAX_SLOTS, ITEM_COUNT, createInput, raycastMetal, GROUP_ARENA,
} from '@miknatis/shared';
import { createView, lerpAngle, nlerpQuat } from './view.js';

export class LocalSession {
  /**
   * @param opts.demo true ise oyuncu yok, sadece botlar (menünün arka planı)
   */
  constructor(RAPIER, { name, difficulty, demo = false }) {
    this.kind = 'local';
    this.R = RAPIER;
    this.sim = new Simulation(RAPIER, { tickHz: demo ? 30 : LOCAL_TICK_HZ, difficulty });
    this.local = demo ? null : this.sim.addPlayer('local', name, false);
    for (let i = 0; i < (demo ? 6 : 5); i++) this.sim.addPlayer('bot:' + i, this.sim.pickBotName(), true);
    this.view = createView();
    this.view.localSlot = this.local ? this.local.slot : -1;
    this.view.isHost = true;
    this.view.diff = difficulty;
    this.input = createInput();
    this.seq = 0;
    this.acc = 0;
    // Önceki adımın konumları (ara değer için). Düz diziler: nesne üretmez.
    this.pPrev = new Float32Array(MAX_SLOTS * 4);
    this.iPrev = new Float32Array(ITEM_COUNT * 7);
    this.events = [];
    for (let i = 0; i < 128; i++) this.events.push({ type: 0, a: -1, v: -1, x: 0, y: 0, z: 0, p: 0, k: 0 });
    this.eventCount = 0;
    this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.ping = 0;
    this.sim.startRound();
    this._savePrev();
  }

  _savePrev() {
    const sim = this.sim;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const p = sim.players[i];
      if (!p) continue;
      this.pPrev[i * 4] = p.x; this.pPrev[i * 4 + 1] = p.y; this.pPrev[i * 4 + 2] = p.z; this.pPrev[i * 4 + 3] = p.yaw;
    }
    for (let i = 0; i < sim.items.length; i++) {
      const it = sim.items[i], k = i * 7;
      this.iPrev[k] = it.x; this.iPrev[k + 1] = it.y; this.iPrev[k + 2] = it.z;
      this.iPrev[k + 3] = it.qx; this.iPrev[k + 4] = it.qy; this.iPrev[k + 5] = it.qz; this.iPrev[k + 6] = it.qw;
    }
  }

  update(dt, input) {
    const sim = this.sim;
    this.acc += Math.min(dt, 0.25);
    let steps = 0;
    while (this.acc >= sim.dt && steps < 8) {
      this._savePrev();
      input.sample(this.input);
      this.input.seq = ++this.seq;
      if (this.local) sim.pushInput(this.local.slot, this.input);
      sim.step();
      for (let i = 0; i < sim.eventCount && this.eventCount < this.events.length; i++) {
        Object.assign(this.events[this.eventCount++], sim.events[i]);
      }
      this.acc -= sim.dt;
      steps++;
    }
    if (steps === 8) this.acc = 0; // çok geride kaldık (sekme arka plandaydı): yetişmeye çalışma
    this._fillView(this.acc / sim.dt, input);
  }

  _fillView(t, input) {
    const sim = this.sim, v = this.view;
    v.phase = sim.phase;
    v.timer = sim.timer;
    v.shrink = sim.shrink;
    v.warnRing = sim.warnRing;
    v.alive = sim.aliveCount;
    v.total = sim.participants;
    v.winner = sim.winner;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const p = sim.players[i], o = v.players[i];
      if (!p) { o.exists = false; continue; }
      o.exists = true;
      o.name = p.name; o.color = p.color; o.bot = p.isBot; o.inRound = p.inRound; o.alive = p.alive;
      const k = i * 4;
      o.x = this.pPrev[k] + (p.x - this.pPrev[k]) * t;
      o.y = this.pPrev[k + 1] + (p.y - this.pPrev[k + 1]) * t;
      o.z = this.pPrev[k + 2] + (p.z - this.pPrev[k + 2]) * t;
      o.isLocal = p === this.local;
      if (o.isLocal) { o.yaw = input.yaw; o.pitch = input.pitch; } else { o.yaw = lerpAngle(this.pPrev[k + 3], p.yaw, t); o.pitch = p.pitch; }
      o.hold = p.holding; o.pull = p.pulling; o.stun = p.motor.stun;
      o.hook = p.motor.hookOn; o.hx = p.motor.hx; o.hy = p.motor.hy; o.hz = p.motor.hz;
      o.pushCd = p.pushCd; o.hookCd = p.hookCd;
      o.kills = p.kills; o.hits = p.hits; o.place = p.place; o.wins = p.wins;
    }
    for (let i = 0; i < sim.items.length; i++) {
      const it = sim.items[i], o = v.items[i], k = i * 7;
      o.kind = it.kind; o.state = it.state; o.holder = it.holder;
      o.x = this.iPrev[k] + (it.x - this.iPrev[k]) * t;
      o.y = this.iPrev[k + 1] + (it.y - this.iPrev[k + 1]) * t;
      o.z = this.iPrev[k + 2] + (it.z - this.iPrev[k + 2]) * t;
      nlerpQuat(o, this.iPrev[k + 3], this.iPrev[k + 4], this.iPrev[k + 5], this.iPrev[k + 6], it.qx, it.qy, it.qz, it.qw, t);
    }
  }

  /** Bu kareye kadar biriken olayları işle. */
  pollEvents(fn) {
    for (let i = 0; i < this.eventCount; i++) fn(this.events[i]);
    this.eventCount = 0;
  }

  /** Nişangâh metal yüzeye mi bakıyor? (turuncu nişangâh) */
  aimingMetal(ray, maxDist, out) {
    return raycastMetal(this.sim.world, this.sim.arena, ray, maxDist, out);
  }

  /** Bir noktanın altındaki zeminin yüksekliği (blob gölge için). */
  /** Arenaya (duvar, direk...) ışın: kameranın duvarın içine girmemesi için. */
  castArena(ray, maxDist) {
    const hit = this.sim.world.castRay(ray, maxDist, true, undefined, (0xffff << 16) | GROUP_ARENA);
    return hit ? hit.timeOfImpact : -1;
  }

  groundHeight(x, y, z) {
    const r = this._ray;
    r.origin.x = x; r.origin.y = y - 0.85; r.origin.z = z;
    const hit = this.sim.world.castRay(r, 40, true, undefined, (0xffff << 16) | GROUP_ARENA);
    return hit ? r.origin.y - hit.timeOfImpact : null;
  }

  again() { this.sim.startRound(); }
  toLobby() {}
  leave() { this.sim.dispose(); }
  get rtt() { return 0; }
}
