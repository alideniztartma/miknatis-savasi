// ============================================================================
// ÇOK OYUNCULU OTURUM
//  - Girdileri tick hızında (20 Hz) paketleyip sunucuya yollar
//  - Kendi oyuncumuz: client-side prediction (Predictor.js)
//  - Diğer oyuncular ve eşyalar: INTERPOLATION. Sunucudan gelen anlık
//    görüntüleri (snapshot) bir tamponda tutar ve ~100 ms GERİDEN, iki
//    görüntü arasında yumuşak geçişle çizeriz. 20 Hz veri 60 FPS'te akıcı görünür.
//  - Bağlantı koparsa otomatik yeniden bağlanmayı dener.
// ============================================================================
import {
  SERVER_TICK_HZ, MAX_SLOTS, ITEM_COUNT, PHASE, createInput, encodeInput, raycastMetal,
  fromCm, unpackAngle, unpackQuat, GROUP_ARENA, HOLD_DISTANCE, itemRadius, forwardFromAngles, clamp,
} from '@miknatis/shared';
import { createView, lerpAngle, nlerpQuat } from './view.js';
import { Predictor } from './Predictor.js';

const TICK_MS = 1000 / SERVER_TICK_HZ;
const INTERP_TICKS = 2.2; // ~110 ms geriden çiz (ağ titremesine karşı tampon)
const BUF = 12; // varlık başına saklanan anlık görüntü sayısı
const PF = 6; // oyuncu örneği alanları: tick, x, y, z, yaw, pitch
const IF = 8; // eşya örneği alanları: tick, x, y, z, qx, qy, qz, qw

export class NetSession {
  constructor(RAPIER, client, room, callbacks = {}) {
    this.kind = 'net';
    this.R = RAPIER;
    this.client = client;
    this.cb = callbacks; // { onStatus(status), onLobby(), onKicked(msg) }
    this.view = createView();
    this.predictor = new Predictor(RAPIER);
    this.input = createInput();
    this.seq = 0;
    this.acc = 0;
    this.arr = [0, 0, 0, 0, 0, 0];
    // Anlık görüntü tamponları (düz diziler)
    this.pBuf = new Float64Array(MAX_SLOTS * BUF * PF);
    this.pN = new Int32Array(MAX_SLOTS);
    this.iBuf = new Float64Array(ITEM_COUNT * BUF * IF);
    this.iN = new Int32Array(ITEM_COUNT);
    this.clockOffset = null;
    this.lastTick = 0;
    this.events = [];
    this.rtt = 0;
    this.serverTickMs = 0;
    this.bytes = 0;
    this.kbps = 0;
    this._bytesT = 0;
    this.leaving = false;
    this.localAlive = false;
    this._q = { x: 0, y: 0, z: 0, w: 1 };
    this._rp = { x: 0, y: 0, z: 0 };
    this._f = { x: 0, y: 0, z: 0 };
    this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this._rec = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ack: 0, stun: 0, hook: false, hx: 0, hy: 0, hz: 0, hookT: 0, hookCd: 0, slow: 0, frozen: false };
    this.attach(room);
    this._pingTimer = setInterval(() => { if (this.room) this.room.send('p', performance.now()); }, 2000);
  }

  /** Odaya bağlan (ilk bağlantı ve yeniden bağlanma için ortak). */
  attach(room) {
    this.room = room;
    this.sessionId = room.sessionId;
    room.onStateChange((state) => this._onPatch(state));
    room.onMessage('e', (arr) => this._onEvents(arr));
    room.onMessage('p', (t) => { this.rtt = performance.now() - t; });
    room.onMessage('srv', (m) => { this.serverTickMs = m[0]; });
    room.onLeave((code) => this._onLeave(code));
    room.onError((code, msg) => console.warn('oda hatası', code, msg));
    const ws = room.connection && room.connection.transport && room.connection.transport.ws;
    if (ws && ws.addEventListener) ws.addEventListener('message', (e) => { this.bytes += e.data.byteLength || e.data.length || 0; });
  }

  async _onLeave(code) {
    if (this.leaving) return;
    // 1000 = normal kapanış. Diğerleri: ağ koptu -> yeniden bağlanmayı dene
    const token = this.room.reconnectionToken;
    this.room = null;
    if (this.cb.onStatus) this.cb.onStatus('reconnecting');
    for (let i = 0; i < 10 && !this.leaving; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const room = await this.client.reconnect(token);
        this.attach(room);
        if (this.cb.onStatus) this.cb.onStatus('ok');
        return;
      } catch (e) { /* tekrar dene */ }
    }
    if (!this.leaving && this.cb.onStatus) this.cb.onStatus('lost');
  }

  // ----------------------------------------------------------------- Sunucudan
  _onPatch(state) {
    const now = performance.now();
    const tick = state.tick;
    this.lastTick = tick;
    // Saat eşitleme: "tick T, yerel zamanda ne zaman geldi?" En erken gelişi takip et.
    const sample = now - tick * TICK_MS;
    if (this.clockOffset === null || sample < this.clockOffset || sample - this.clockOffset > 600) this.clockOffset = sample;
    else this.clockOffset += (sample - this.clockOffset) * 0.02;

    const v = this.view;
    v.phase = state.phase; v.timer = state.timer; v.shrink = state.shrink; v.warnRing = state.warn;
    v.alive = state.alive; v.total = state.total; v.winner = state.winner;
    v.code = state.code; v.hostSid = state.host; v.isHost = state.host === this.sessionId; v.diff = state.diff; v.fill = state.fill;
    this.predictor.setShrink(state.shrink);

    for (let i = 0; i < MAX_SLOTS; i++) v.players[i].exists = false;
    state.players.forEach((ps, key) => {
      const slot = +key;
      const o = v.players[slot];
      o.exists = true;
      o.sid = ps.sid; o.name = ps.name; o.color = ps.color; o.bot = ps.bot; o.afk = ps.afk;
      o.inRound = ps.inRound; o.alive = ps.alive; o.hold = ps.hold; o.pull = ps.pull;
      o.stun = ps.stun / 50; o.hook = ps.hook; o.hx = fromCm(ps.hx); o.hy = fromCm(ps.hy); o.hz = fromCm(ps.hz);
      o.pushCd = ps.pushCd / 10; o.hookCd = ps.hookCd / 10;
      o.kills = ps.kills; o.hits = ps.hits; o.place = ps.place; o.wins = ps.wins;
      o.isLocal = ps.sid === this.sessionId;
      if (o.isLocal) { v.localSlot = slot; this._reconcileLocal(ps, state.phase); }
      // Anlık görüntüyü tampona ekle
      const base = slot * BUF * PF;
      let n = this.pN[slot];
      if (n >= BUF) { this.pBuf.copyWithin(base, base + PF, base + BUF * PF); n = BUF - 1; }
      const k = base + n * PF;
      this.pBuf[k] = tick; this.pBuf[k + 1] = fromCm(ps.x); this.pBuf[k + 2] = fromCm(ps.y); this.pBuf[k + 3] = fromCm(ps.z);
      this.pBuf[k + 4] = unpackAngle(ps.yaw); this.pBuf[k + 5] = unpackAngle(ps.pitch);
      this.pN[slot] = n + 1;
    });
    if (v.localSlot >= 0 && !v.players[v.localSlot].exists) v.localSlot = -1;

    state.items.forEach((s, key) => {
      const id = +key;
      const o = v.items[id];
      o.kind = s.kind; o.state = s.s; o.holder = s.h;
      const base = id * BUF * IF;
      let n = this.iN[id];
      if (n >= BUF) { this.iBuf.copyWithin(base, base + IF, base + BUF * IF); n = BUF - 1; }
      const k = base + n * IF;
      unpackQuat(s.q, this._q);
      if (s.q === 0) { this._q.x = 0; this._q.y = 0; this._q.z = 0; this._q.w = 1; }
      this.iBuf[k] = tick; this.iBuf[k + 1] = fromCm(s.x); this.iBuf[k + 2] = fromCm(s.y); this.iBuf[k + 3] = fromCm(s.z);
      this.iBuf[k + 4] = this._q.x; this.iBuf[k + 5] = this._q.y; this.iBuf[k + 6] = this._q.z; this.iBuf[k + 7] = this._q.w;
      this.iN[id] = n + 1;
    });
  }

  _reconcileLocal(ps, phase) {
    const wasAlive = this.localAlive;
    this.localAlive = ps.alive && ps.inRound;
    if (!this.localAlive) return;
    const r = this._rec;
    r.x = fromCm(ps.x); r.y = fromCm(ps.y); r.z = fromCm(ps.z);
    r.vx = fromCm(ps.vx); r.vy = fromCm(ps.vy); r.vz = fromCm(ps.vz);
    r.ack = ps.ack; r.stun = ps.stun / 50; r.hook = ps.hook;
    r.hx = fromCm(ps.hx); r.hy = fromCm(ps.hy); r.hz = fromCm(ps.hz); r.hookT = ps.hookT / 50; r.slow = ps.slow / 100;
    r.hookCd = ps.hookCd / 10;
    r.frozen = phase === PHASE.COUNTDOWN || phase === PHASE.LOBBY;
    if (!wasAlive) this.predictor.teleport(r.x, r.y, r.z);
    this.predictor.reconcile(r);
  }

  _onEvents(arr) {
    // Olayları görsellerle eşzamanlı göstermek için ara değer gecikmesi kadar beklet
    const at = performance.now() + INTERP_TICKS * TICK_MS * 0.8;
    for (let i = 0; i + 7 < arr.length; i += 8) {
      this.events.push({ at, type: arr[i], a: arr[i + 1], v: arr[i + 2], x: fromCm(arr[i + 3]), y: fromCm(arr[i + 4]), z: fromCm(arr[i + 5]), p: arr[i + 6] / 100, k: arr[i + 7] });
    }
  }

  pollEvents(fn) {
    const now = performance.now();
    let n = 0;
    while (n < this.events.length && this.events[n].at <= now) fn(this.events[n++]);
    if (n) this.events.splice(0, n);
  }

  // ----------------------------------------------------------------- Her kare
  update(dt, input) {
    const v = this.view;
    // Girdiyi tick hızında örnekle ve gönder (her karede değil!)
    this.acc += Math.min(dt, 0.25);
    let steps = 0;
    while (this.acc >= TICK_MS / 1000 && steps < 5) {
      this.acc -= TICK_MS / 1000;
      steps++;
      input.sample(this.input);
      const canPlay = this.room && this.localAlive && v.phase !== PHASE.LOBBY;
      if (canPlay) {
        this.input.seq = ++this.seq;
        this.room.send('i', encodeInput(this.input, this.arr));
        this.predictor.motor.frozen = v.phase === PHASE.COUNTDOWN;
        this.predictor.step(this.input);
      }
    }
    if (steps === 5) this.acc = 0;

    // Bant genişliği ölçümü
    this._bytesT += dt;
    if (this._bytesT >= 1) { this.kbps = this.bytes / 1024 / this._bytesT; this.bytes = 0; this._bytesT = 0; }

    // Diğerleri için ara değer zamanı
    const renderTick = this.clockOffset === null ? this.lastTick : (performance.now() - this.clockOffset) / TICK_MS - INTERP_TICKS;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const o = v.players[i];
      if (!o.exists) continue;
      if (o.isLocal && this.localAlive) {
        this.predictor.renderPos(this.acc / (TICK_MS / 1000), dt, this._rp);
        o.x = this._rp.x; o.y = this._rp.y; o.z = this._rp.z;
        o.yaw = input.yaw; o.pitch = input.pitch;
        continue;
      }
      this._interpPlayer(i, renderTick, o);
    }
    for (let i = 0; i < ITEM_COUNT; i++) this._interpItem(i, renderTick, v.items[i]);

    // Kendi tuttuğumuz eşyayı tahmin edilen konumumuza göre çiz (gecikmesin)
    const me = v.localSlot >= 0 ? v.players[v.localSlot] : null;
    if (me && me.alive && me.hold >= 0) {
      const it = v.items[me.hold];
      const f = forwardFromAngles(me.yaw, clamp(me.pitch, -0.6, 0.7) * 0.6, this._f);
      const d = HOLD_DISTANCE + itemRadius(it.kind);
      const tx = me.x + f.x * d, ty = me.y + 0.35 + f.y * d, tz = me.z + f.z * d;
      const k = 1 - Math.exp(-25 * dt);
      if (!this._holdInit || this._holdId !== me.hold) { this._hx = it.x; this._hy = it.y; this._hz = it.z; this._holdInit = true; this._holdId = me.hold; }
      this._hx += (tx - this._hx) * k; this._hy += (ty - this._hy) * k; this._hz += (tz - this._hz) * k;
      it.x = this._hx; it.y = this._hy; it.z = this._hz;
    } else this._holdInit = false;
  }

  _interpPlayer(slot, rt, o) {
    const n = this.pN[slot];
    if (!n) return;
    const base = slot * BUF * PF;
    let k0 = base + (n - 1) * PF, k1 = k0, t = 0;
    for (let j = n - 1; j > 0; j--) {
      const a = base + (j - 1) * PF;
      if (this.pBuf[a] <= rt) {
        k0 = a; k1 = a + PF;
        const span = this.pBuf[k1] - this.pBuf[k0];
        t = span > 0 ? Math.min(1, (rt - this.pBuf[k0]) / span) : 1;
        break;
      }
      if (j === 1) { k0 = base; k1 = base; t = 0; }
    }
    const b = this.pBuf;
    o.x = b[k0 + 1] + (b[k1 + 1] - b[k0 + 1]) * t;
    o.y = b[k0 + 2] + (b[k1 + 2] - b[k0 + 2]) * t;
    o.z = b[k0 + 3] + (b[k1 + 3] - b[k0 + 3]) * t;
    o.yaw = lerpAngle(b[k0 + 4], b[k1 + 4], t);
    o.pitch = b[k0 + 5] + (b[k1 + 5] - b[k0 + 5]) * t;
  }

  _interpItem(id, rt, o) {
    const n = this.iN[id];
    if (!n) return;
    const base = id * BUF * IF;
    let k0 = base + (n - 1) * IF, k1 = k0, t = 0;
    for (let j = n - 1; j > 0; j--) {
      const a = base + (j - 1) * IF;
      if (this.iBuf[a] <= rt) {
        k0 = a; k1 = a + IF;
        const span = this.iBuf[k1] - this.iBuf[k0];
        t = span > 0 ? Math.min(1, (rt - this.iBuf[k0]) / span) : 1;
        break;
      }
      if (j === 1) { k0 = base; k1 = base; t = 0; }
    }
    const b = this.iBuf;
    // Büyük sıçrama (yeniden doğma) varsa ara değer alma, direkt atla
    const jump = Math.abs(b[k1 + 2] - b[k0 + 2]) + Math.abs(b[k1 + 1] - b[k0 + 1]) > 6;
    if (jump) t = 1;
    o.x = b[k0 + 1] + (b[k1 + 1] - b[k0 + 1]) * t;
    o.y = b[k0 + 2] + (b[k1 + 2] - b[k0 + 2]) * t;
    o.z = b[k0 + 3] + (b[k1 + 3] - b[k0 + 3]) * t;
    nlerpQuat(o, b[k0 + 4], b[k0 + 5], b[k0 + 6], b[k0 + 7], b[k1 + 4], b[k1 + 5], b[k1 + 6], b[k1 + 7], t);
  }

  // ----------------------------------------------------------------- Yardımcılar
  aimingMetal(ray, maxDist, out) {
    return raycastMetal(this.predictor.world, this.predictor.arena, ray, maxDist, out);
  }

  /** Arenaya (duvar, direk...) ışın: kameranın duvarın içine girmemesi için. */
  castArena(ray, maxDist) {
    const hit = this.predictor.world.castRay(ray, maxDist, true, undefined, (0xffff << 16) | GROUP_ARENA);
    return hit ? hit.timeOfImpact : -1;
  }

  groundHeight(x, y, z) {
    const r = this._ray;
    r.origin.x = x; r.origin.y = y - 0.85; r.origin.z = z;
    const hit = this.predictor.world.castRay(r, 40, true, undefined, (0xffff << 16) | GROUP_ARENA);
    return hit ? r.origin.y - hit.timeOfImpact : null;
  }

  start() { if (this.room) this.room.send('start'); }
  again() { this.start(); }
  toLobby() { if (this.room) this.room.send('menu'); }
  setConfig(diff, fill) { if (this.room) this.room.send('cfg', { diff, fill }); }

  leave() {
    this.leaving = true;
    clearInterval(this._pingTimer);
    if (this.room) this.room.leave(true).catch(() => {});
    this.room = null;
    this.predictor.dispose();
  }
}
