// ============================================================================
// SİMÜLASYON — Oyunun kalbi.
// Fizik + kurallar + botlar burada. Tarayıcıya bağımlı HİÇBİR şey yok:
//   - Tek oyunculu modda tarayıcı bu sınıfı doğrudan çalıştırır.
//   - Çok oyunculu modda sunucu (Colyseus odası) aynı sınıfı çalıştırır.
// Böylece kurallar tek bir yerde yazılır, kod tekrarı olmaz.
//
// Bir "tick" = sabit zaman adımı (sunucuda 1/20 sn). Her tick'te:
//   1) Evre (geri sayım / oyun / bitiş) ve süre güncellenir
//   2) Botlar (saniyede 5 kez) karar verir
//   3) Her oyuncunun girdisi işlenir (çek, fırlat, dalga, kanca, yürü)
//   4) Eşyalar güncellenir (çekiliyor / tutuluyor / uçuyor)
//   5) Fizik adımı(ları) atılır, çarpışma olayları işlenir
//   6) Düşenler elenir, tur bitti mi bakılır
// ============================================================================
import {
  PHASE, ROUND_TIME, COUNTDOWN_TIME, END_SCREEN_TIME, SHRINK_WARN_TIME, SHRINK_INTERVAL,
  MAX_SLOTS, MAX_SUBSTEP, KILL_Y, ITEM_RESPAWN_Y, ITEM_RESPAWN_DELAY,
  CG_PLAYER, CG_ITEM, CG_ITEM_GHOST, PLAYER_RADIUS, PLAYER_HALF_HEIGHT, PLAYER_CENTER_Y, PLAYER_MASS,
  HOLD_DISTANCE, CATCH_DISTANCE, PULL_RANGE, STEAL_TIME, THROWN_GRAVITY, THROWN_MAX_TIME, THROWN_MIN_SPEED,
  SELF_HIT_GRACE, WAVE_RANGE, WAVE_ANGLE, WAVE_POWER, WAVE_COOLDOWN, HOOK_RANGE, HOOK_MAX_TIME,
  HOOK_COOLDOWN, ITEM_KINDS, ITEM_STATE, EV, GRAVITY, CAM_DISTANCE, PLAYER_COLORS, BOT_NAMES,
  itemRadius,
} from './constants.js';
import { buildArenaLayout, MAX_RING } from './arena.js';
import { createWorld, buildArenaColliders, applyShrink, raycastMetal } from './physicsWorld.js';
import { createMotor, applyMovement } from './playerController.js';
import { createInput, copyInput, BTN, EDGE_MASK } from './input.js';
import { cameraFromPlayer, forwardFromAngles, aimOrigin, clamp } from './math.js';
import { findAimTarget } from './aim.js';
import { BotBrain } from './bots.js';

const INPUT_QUEUE = 8; // oyuncu başına bekleyen girdi kuyruğu
const MAX_EVENTS = 64;
export const WAVE_KIND = 100; // ELIM olayında "itme dalgasıyla" demek
export const HOOK_PULL_KIND = 101;

export class Simulation {
  /**
   * @param RAPIER Rapier modülü (init() edilmiş olmalı)
   * @param opts { tickHz, difficulty }
   */
  constructor(RAPIER, opts = {}) {
    this.R = RAPIER;
    this.tickHz = opts.tickHz || 20;
    this.dt = 1 / this.tickHz;
    this.substeps = Math.max(1, Math.ceil(this.dt / MAX_SUBSTEP - 1e-6));
    this.subDt = this.dt / this.substeps;
    this.difficulty = opts.difficulty || 'orta';

    this.layout = buildArenaLayout();
    this.world = createWorld(RAPIER, this.subDt);
    this.arena = buildArenaColliders(RAPIER, this.world, this.layout);
    this.eventQueue = new RAPIER.EventQueue(true);
    this.owner = new Map(); // collider.handle -> oyuncu ya da eşya

    this.tick = 0;
    this.time = 0;
    this.phase = PHASE.LOBBY;
    this.timer = 0; // evreye göre kalan süre (oyunda: tur süresi, eksiye düşerse uzatma)
    this.shrink = 0;
    this.warnRing = -1;
    this.participants = 0;
    this.aliveCount = 0;
    this.winner = -1;
    this.elimOrder = 0;

    /** @type {Array<Object|null>} */
    this.players = new Array(MAX_SLOTS).fill(null);
    this.items = [];
    this._createItems();

    // Olay havuzu: her tick sıfırlanır, nesneler tekrar kullanılır
    this.events = [];
    for (let i = 0; i < MAX_EVENTS; i++) this.events.push({ type: 0, a: -1, v: -1, x: 0, y: 0, z: 0, p: 0, k: 0 });
    this.eventCount = 0;

    // Geçici vektörler (çöp üretmemek için)
    this._cam = { x: 0, y: 0, z: 0 };
    this._org = { x: 0, y: 0, z: 0 };
    this._fwd = { x: 0, y: 0, z: 0 };
    this._v = { x: 0, y: 0, z: 0 };
    this._p = { x: 0, y: 0, z: 0 };
    this._q = { x: 0, y: 0, z: 0, w: 1 };
    this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    this._collisionCb = (h1, h2, started) => { if (started) this._onCollision(h1, h2); };
  }

  // ======================================================================== EŞYALAR
  _createItems() {
    const R = this.R;
    const { itemKinds, itemSpawns } = this.layout;
    for (let i = 0; i < itemKinds.length; i++) {
      const k = ITEM_KINDS[itemKinds[i]];
      const sp = itemSpawns[i];
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.dynamic().setTranslation(sp.x, this._spawnHeight(k), sp.z)
          .setLinearDamping(0.05).setAngularDamping(0.4).setCanSleep(true),
      );
      let cd;
      if (k.shape === 'ball') cd = R.ColliderDesc.ball(k.r);
      else if (k.shape === 'capsule') cd = R.ColliderDesc.capsule(k.hh, k.r);
      else cd = R.ColliderDesc.cuboid(k.hx, k.hy, k.hz);
      cd.setMass(k.mass).setFriction(0.7).setRestitution(0.25)
        .setCollisionGroups(CG_ITEM).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
      const collider = this.world.createCollider(cd, body);
      const item = {
        id: i, kind: k.id, k, body, collider, state: ITEM_STATE.FREE, holder: -1, thrower: -1,
        thrownT: 0, lastSpeed: 0, lvx: 0, lvy: 0, lvz: 0, respawnT: 0, spawn: i, bumped: false,
        x: sp.x, y: this._spawnHeight(k), z: sp.z, qx: 0, qy: 0, qz: 0, qw: 1, sleeping: false, dirty: true,
      };
      this.owner.set(collider.handle, item);
      this.items.push(item);
    }
  }

  _spawnHeight(k) {
    return (k.shape === 'ball' ? k.r : k.shape === 'capsule' ? k.hh + k.r : k.hy) + 0.02;
  }

  _resetItem(item, dropFromSky) {
    const sp = this.layout.itemSpawns[item.spawn];
    let x = sp.x, z = sp.z;
    // Doğma karosu düştüyse rastgele sağlam bir karoya koy
    if (sp.ring > MAX_RING - this.shrink) {
      const alive = this.layout.tiles.filter((t) => t.ring <= MAX_RING - this.shrink);
      const t = alive[(item.id * 7 + this.tick) % alive.length];
      x = t.x + ((item.id % 3) - 1) * 0.9; z = t.z + (((item.id >> 1) % 3) - 1) * 0.9;
    }
    const y = this._spawnHeight(item.k) + (dropFromSky ? 9 + (item.id % 4) : 0);
    this._p.x = x; this._p.y = y; this._p.z = z;
    item.body.setEnabled(true);
    item.body.setTranslation(this._p, true);
    this._q.x = 0; this._q.y = 0; this._q.z = 0; this._q.w = 1;
    item.body.setRotation(this._q, true);
    this._v.x = 0; this._v.y = 0; this._v.z = 0;
    item.body.setLinvel(this._v, true);
    item.body.setAngvel(this._v, true);
    item.body.setGravityScale(1, true);
    item.body.enableCcd(false);
    item.collider.setCollisionGroups(CG_ITEM);
    item.state = ITEM_STATE.FREE; item.holder = -1; item.thrower = -1;
    item.x = x; item.y = y; item.z = z; item.qx = 0; item.qy = 0; item.qz = 0; item.qw = 1;
    item.sleeping = false;
    item.dirty = true; // uyusa bile yeni konumu ağa bir kez gönderilmeli
    if (!dropFromSky) item.body.sleep();
  }

  /** Eşyayı serbest bırak (çekme/tutma bitti). */
  _freeItem(item) {
    if (item.holder >= 0) {
      const h = this.players[item.holder];
      if (h) {
        if (h.holding === item.id) { h.holding = -1; h.motor.slow = 0; }
        if (h.pulling === item.id) h.pulling = -1;
      }
    }
    item.holder = -1;
    item.state = ITEM_STATE.FREE;
    item.body.setGravityScale(1, true);
    item.body.enableCcd(false);
    item.collider.setCollisionGroups(CG_ITEM);
  }

  // ======================================================================== OYUNCULAR
  /**
   * Yeni oyuncu ekler (insan ya da bot). Boş ilk slotu kullanır.
   * @returns oyuncu nesnesi ya da null (yer yoksa)
   */
  addPlayer(id, name, isBot = false) {
    const slot = this.players.indexOf(null);
    if (slot < 0) return null;
    const R = this.R;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(0, -100 - slot * 3, 0).lockRotations().setCanSleep(false).setEnabled(false),
    );
    const collider = this.world.createCollider(
      R.ColliderDesc.capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS).setMass(PLAYER_MASS).setFriction(0)
        .setFrictionCombineRule(R.CoefficientCombineRule.Min).setCollisionGroups(CG_PLAYER),
      body,
    );
    const used = new Set(this.players.filter(Boolean).map((p) => p.color));
    let color = 0;
    while (used.has(color) && color < PLAYER_COLORS.length - 1) color++;
    const p = {
      slot, id, name, color, isBot, brain: isBot ? new BotBrain(this.difficulty) : null,
      inRound: false, alive: false, body, collider, motor: createMotor(),
      input: createInput(), queue: [], qHead: 0, qCount: 0, ack: 0,
      x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
      holding: -1, pulling: -1, stealT: 0, pushCd: 0, hookCd: 0,
      lastHitter: -1, lastHitTime: -100, lastHitKind: -1,
      kills: 0, hits: 0, place: 0, wins: 0, score: 0,
    };
    for (let i = 0; i < INPUT_QUEUE; i++) p.queue.push(createInput());
    this.owner.set(collider.handle, p);
    this.players[slot] = p;
    // Oyun sürerken gelen oyuncu bir sonraki turu bekler (izleyici)
    return p;
  }

  removePlayer(slot) {
    const p = this.players[slot];
    if (!p) return;
    this._dropHeld(p);
    for (const it of this.items) if (it.holder === slot) this._freeItem(it);
    this.owner.delete(p.collider.handle);
    this.world.removeRigidBody(p.body);
    this.players[slot] = null;
    if (p.alive && this.phase === PHASE.PLAYING) {
      p.alive = false;
      this._countAlive();
      this._checkRoundEnd();
    }
  }

  /** İnsan oyuncu koptu -> karakteri bota devret (oyun çökmesin). */
  setBotControl(slot, on) {
    const p = this.players[slot];
    if (!p) return;
    p.isBot = on;
    p.brain = on ? new BotBrain(this.difficulty) : null;
    p.qCount = 0;
    p.input.buttons = 0; p.input.mx = 0; p.input.mz = 0; p.input.jump = false;
  }

  /** Ağdan gelen girdiyi kuyruğa ekle (her tick bir tane tüketilir). */
  pushInput(slot, inp) {
    const p = this.players[slot];
    if (!p || p.isBot) return;
    if (p.qCount >= INPUT_QUEUE) {
      // Kuyruk taştı (ağ takıldı, paketler birikti): en eskiyi at ama
      // tek seferlik tuşlarını (fırlat, kanca) kaybetme
      const old = p.queue[p.qHead];
      p.qHead = (p.qHead + 1) % INPUT_QUEUE;
      p.qCount--;
      p.queue[p.qHead].buttons |= old.buttons & EDGE_MASK;
    }
    const idx = (p.qHead + p.qCount) % INPUT_QUEUE;
    copyInput(p.queue[idx], inp);
    p.qCount++;
  }

  _consumeInput(p) {
    // Kuyruk birikirse (istemci saati biraz hızlı / ağ paketleri toplu geldi) gecikme
    // büyümesin: en eskileri at ama tek seferlik tuşlarını bir sonrakine aktar.
    while (p.qCount > 3) {
      const old = p.queue[p.qHead];
      p.qHead = (p.qHead + 1) % INPUT_QUEUE;
      p.qCount--;
      p.queue[p.qHead].buttons |= old.buttons & EDGE_MASK;
    }
    if (p.qCount > 0) {
      copyInput(p.input, p.queue[p.qHead]);
      p.qHead = (p.qHead + 1) % INPUT_QUEUE;
      p.qCount--;
      p.ack = p.input.seq;
    } else {
      // Girdi gelmedi: son girdiyi tekrarla ama tek seferlik tuşları temizle
      p.input.buttons &= ~EDGE_MASK;
    }
    p.yaw = p.input.yaw;
    p.pitch = p.input.pitch;
  }

  // ======================================================================== TUR AKIŞI
  /** Yeni tur başlat: herkes doğar, eşyalar yerine döner, geri sayım başlar. */
  startRound() {
    this.shrink = 0;
    this.warnRing = -1;
    applyShrink(this.arena, 0);
    for (const it of this.items) this._resetItem(it, false);
    let k = 0;
    const spawns = this.layout.spawns;
    // Doğma noktalarını karıştır ki herkes hep aynı yerde başlamasın
    const order = [0, 1, 2, 3, 4, 5, 6, 7].sort(() => Math.random() - 0.5);
    for (const p of this.players) {
      if (!p) continue;
      p.holding = -1; p.pulling = -1; p.stealT = 0; p.pushCd = 0; p.hookCd = 0;
      p.lastHitter = -1; p.lastHitKind = -1; p.kills = 0; p.hits = 0; p.place = 0;
      Object.assign(p.motor, createMotor());
      if (k >= 8) { p.inRound = false; p.alive = false; p.body.setEnabled(false); continue; }
      const sp = spawns[order[k++]];
      p.inRound = true; p.alive = true;
      this._p.x = sp.x; this._p.y = PLAYER_CENTER_Y + 0.05; this._p.z = sp.z;
      p.body.setEnabled(true);
      p.body.setTranslation(this._p, true);
      this._v.x = 0; this._v.y = 0; this._v.z = 0;
      p.body.setLinvel(this._v, true);
      p.x = sp.x; p.y = this._p.y; p.z = sp.z;
      p.yaw = sp.yaw; p.pitch = -0.15;
      p.input.yaw = sp.yaw; p.input.pitch = -0.15; p.input.buttons = 0; p.input.mx = 0; p.input.mz = 0;
      p.motor.frozen = true;
      if (p.brain) p.brain.reset(p);
    }
    this.participants = k;
    this.elimOrder = 0;
    this.winner = -1;
    this._countAlive();
    this.phase = PHASE.COUNTDOWN;
    this.timer = COUNTDOWN_TIME;
  }

  _countAlive() {
    let n = 0;
    for (const p of this.players) if (p && p.inRound && p.alive) n++;
    this.aliveCount = n;
  }

  _checkRoundEnd() {
    if (this.phase !== PHASE.PLAYING) return;
    if (this.aliveCount > 1) return;
    if (this.participants < 2 && this.aliveCount > 0) return; // tek kişilik test
    let w = -1;
    for (const p of this.players) if (p && p.inRound && p.alive) w = p.slot;
    this.winner = w;
    if (w >= 0) {
      const wp = this.players[w];
      wp.place = 1; wp.wins++;
      this._emit(EV.WIN, w, -1, wp.x, wp.y, wp.z, 0, 0);
    } else {
      this._emit(EV.WIN, -1, -1, 0, 0, 0, 0, 0);
    }
    this.phase = PHASE.ENDED;
    this.timer = END_SCREEN_TIME;
  }

  _emit(type, a, v, x, y, z, p, k) {
    if (this.eventCount >= MAX_EVENTS) return;
    const e = this.events[this.eventCount++];
    e.type = type; e.a = a; e.v = v; e.x = x; e.y = y; e.z = z; e.p = p; e.k = k;
  }

  // ======================================================================== ANA DÖNGÜ
  step() {
    const dt = this.dt;
    this.tick++;
    this.time += dt;
    this.eventCount = 0;
    if (this.phase === PHASE.LOBBY) return;

    // --- 1) Evre ve süre
    this.timer -= dt;
    if (this.phase === PHASE.COUNTDOWN && this.timer <= 0) {
      this.phase = PHASE.PLAYING;
      this.timer = ROUND_TIME;
      for (const p of this.players) if (p) p.motor.frozen = false;
    } else if (this.phase === PHASE.PLAYING && this.timer <= 0) {
      this._updateShrink(-this.timer);
    }

    // --- 2-3) Oyuncular
    const canAct = this.phase === PHASE.PLAYING || this.phase === PHASE.ENDED;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p) continue;
      if (p.isBot) { if (p.alive && canAct) p.brain.update(this, p, dt); else p.input.buttons = 0; } else this._consumeInput(p);
      if (p.isBot) { p.yaw = p.input.yaw; p.pitch = p.input.pitch; }
      if (!p.alive) continue;
      if (p.pushCd > 0) p.pushCd -= dt;
      if (p.hookCd > 0) p.hookCd -= dt;
      if (canAct) this._handleActions(p, dt);
      applyMovement(this.R, this.world, p.body, p.motor, p.input, dt);
    }

    // --- 4) Eşyalar
    for (let i = 0; i < this.items.length; i++) this._updateItem(this.items[i], dt);

    // --- 5) Fizik
    for (let s = 0; s < this.substeps; s++) {
      this.world.step(this.eventQueue);
      this.eventQueue.drainCollisionEvents(this._collisionCb);
    }

    // --- 6) Sonuçları oku, düşenleri kontrol et
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p || !p.alive) continue;
      const t = p.body.translation();
      const v = p.body.linvel();
      p.x = t.x; p.y = t.y; p.z = t.z; p.vx = v.x; p.vy = v.y; p.vz = v.z;
      if (p.y < KILL_Y) this._eliminate(p);
    }
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.state === ITEM_STATE.GONE) continue;
      it.sleeping = it.body.isSleeping();
      if (it.sleeping) continue; // uyuyan eşya hareket etmiyor: okumaya bile gerek yok
      const t = it.body.translation();
      const r = it.body.rotation();
      it.x = t.x; it.y = t.y; it.z = t.z; it.qx = r.x; it.qy = r.y; it.qz = r.z; it.qw = r.w;
      if (it.y < ITEM_RESPAWN_Y) {
        this._freeItem(it);
        it.state = ITEM_STATE.GONE;
        it.respawnT = ITEM_RESPAWN_DELAY;
        it.body.setEnabled(false);
      }
    }

    if (this.phase === PHASE.ENDED && this.timer < -600) this.timer = 0; // taşma koruması
  }

  _updateShrink(overtime) {
    // Uzatma süresinde her SHRINK_INTERVAL saniyede bir dış halka önce titrer, sonra düşer
    for (let level = 1; level <= MAX_RING; level++) {
      const warnAt = (level - 1) * SHRINK_INTERVAL;
      const fallAt = warnAt + SHRINK_WARN_TIME;
      if (this.shrink < level && overtime >= warnAt && overtime < fallAt) this.warnRing = MAX_RING - level + 1;
      if (this.shrink < level && overtime >= fallAt) {
        this.shrink = level;
        this.warnRing = -1;
        applyShrink(this.arena, level);
        // Düşen karoların üstünde uyuyan eşyalar havada asılı kalmasın: hepsini uyandır
        for (const it of this.items) if (it.state !== ITEM_STATE.GONE) it.body.wakeUp();
        this._emit(EV.RING, -1, -1, 0, 0, 0, MAX_RING - level + 1, level);
      }
    }
  }

  _eliminate(p) {
    p.alive = false;
    this._dropHeld(p);
    if (p.pulling >= 0) { const it = this.items[p.pulling]; if (it.holder === p.slot) this._freeItem(it); p.pulling = -1; }
    p.body.setEnabled(false);
    if (this.phase === PHASE.ENDED) return;
    this._countAlive();
    p.place = this.aliveCount + 1;
    let killer = -1;
    if (p.lastHitter >= 0 && p.lastHitter !== p.slot && this.time - p.lastHitTime < 7) {
      killer = p.lastHitter;
      const kp = this.players[killer];
      if (kp) kp.kills++;
    }
    this._emit(EV.ELIM, killer, p.slot, p.x, p.y, p.z, 0, killer >= 0 ? p.lastHitKind : -1);
    this._checkRoundEnd();
  }

  // ======================================================================== EYLEMLER
  _handleActions(p, dt) {
    const inp = p.input;
    const fwd = forwardFromAngles(inp.yaw, clamp(inp.pitch, -1.15, 1.0), this._fwd);
    const cam = cameraFromPlayer(p.x, p.y, p.z, inp.yaw, inp.pitch, this._cam);
    const org = aimOrigin(p.x, p.y, p.z, inp.yaw, inp.pitch, this._org); // ışınlar buradan başlar
    const b = inp.buttons;

    // --- Kanca (E)
    if (b & BTN.HOOK) {
      if (p.motor.hookOn) p.motor.hookOn = false; // tekrar basınca bırak
      else if (p.hookCd <= 0) {
        const ray = this._ray;
        ray.origin.x = org.x; ray.origin.y = org.y; ray.origin.z = org.z;
        ray.dir.x = fwd.x; ray.dir.y = fwd.y; ray.dir.z = fwd.z;
        if (raycastMetal(this.world, this.arena, ray, HOOK_RANGE, this._p)) {
          const m = p.motor;
          m.hookOn = true; m.hx = this._p.x; m.hy = this._p.y; m.hz = this._p.z; m.hookT = HOOK_MAX_TIME;
          m.stun = 0;
          p.hookCd = HOOK_COOLDOWN;
          this._emit(EV.HOOK, p.slot, -1, m.hx, m.hy, m.hz, 0, 0);
        }
      }
    }

    // --- Sağ tık: fırlat ya da itme dalgası
    if (b & BTN.THROW) {
      if (p.holding >= 0) this._throw(p, org, fwd);
      else if (p.pushCd <= 0) this._wave(p, fwd);
    }

    // --- Sol tık tekrar basıldı ve elimizde eşya var: bırak
    if ((b & BTN.PULL_PRESS) && p.holding >= 0) {
      this._dropHeld(p);
      return;
    }

    // --- Sol tık basılı: çek
    if (p.holding < 0) {
      if (b & BTN.PULL) {
        let it = p.pulling >= 0 ? this.items[p.pulling] : null;
        if (it && (it.state === ITEM_STATE.GONE || Math.abs(it.x - p.x) + Math.abs(it.z - p.z) > PULL_RANGE * 1.4)) {
          if (it.holder === p.slot) this._freeItem(it); // menzil dışına çıktı
          it = null;
        }
        if (!it) {
          p.pulling = findAimTarget(cam, fwd, this.items, p.slot);
          p.stealT = 0;
          it = p.pulling >= 0 ? this.items[p.pulling] : null;
        }
        if (it) this._pull(p, it, dt);
      } else if (p.pulling >= 0) {
        const it = this.items[p.pulling];
        if (it.holder === p.slot) this._freeItem(it);
        p.pulling = -1;
        p.stealT = 0;
      }
    }
  }

  _pull(p, it, dt) {
    if (it.holder === p.slot) return; // zaten bizde, _updateItem çekiyor
    if (it.holder >= 0) {
      // Başkasının kontrolünde: halat çekme! Yeterince uzun çekersen kaparsın.
      p.stealT += dt;
      if (p.stealT < STEAL_TIME) return;
      const prev = this.players[it.holder];
      if (prev) {
        if (prev.holding === it.id) { prev.holding = -1; prev.motor.slow = 0; }
        if (prev.pulling === it.id) prev.pulling = -1;
      }
      this._emit(EV.STEAL, p.slot, it.holder, it.x, it.y, it.z, 0, it.kind);
    }
    // Eşya artık bizim mıknatısımızda
    if (it.state === ITEM_STATE.THROWN) it.body.enableCcd(false);
    it.holder = p.slot;
    it.state = ITEM_STATE.PULLED;
    p.stealT = 0;
    it.body.setGravityScale(0, true);
    it.collider.setCollisionGroups(CG_ITEM_GHOST);
    it.body.wakeUp();
  }

  _dropHeld(p) {
    if (p.holding < 0) return;
    const it = this.items[p.holding];
    p.holding = -1;
    p.motor.slow = 0;
    if (it.holder === p.slot) this._freeItem(it);
  }

  /** Eşyanın tutulacağı nokta: oyuncunun önü, biraz bakış yönüne göre yukarı/aşağı. */
  _holdPoint(p, it, out) {
    const pitch = clamp(p.pitch, -0.6, 0.7);
    const f = forwardFromAngles(p.yaw, pitch * 0.6, this._v);
    const d = HOLD_DISTANCE + itemRadius(it.kind);
    out.x = p.x + f.x * d;
    out.y = p.y + 0.35 + f.y * d;
    out.z = p.z + f.z * d;
    return out;
  }

  _updateItem(it, dt) {
    if (it.state === ITEM_STATE.GONE) {
      it.respawnT -= dt;
      if (it.respawnT <= 0) this._resetItem(it, true); // gökten düşerek geri gelir
      return;
    }
    if (it.state === ITEM_STATE.PULLED || it.state === ITEM_STATE.HELD) {
      const h = it.holder >= 0 ? this.players[it.holder] : null;
      if (!h || !h.alive) { this._freeItem(it); return; }
      const hp = this._holdPoint(h, it, this._p);
      const t = it.body.translation();
      const dx = hp.x - t.x, dy = hp.y - t.y, dz = hp.z - t.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
      const lv = it.body.linvel();
      if (it.state === ITEM_STATE.PULLED) {
        if (d < CATCH_DISTANCE + itemRadius(it.kind) * 0.5) {
          // Yakalandı! Artık oyuncunun önünde süzülüyor
          it.state = ITEM_STATE.HELD;
          h.holding = it.id;
          h.pulling = -1;
          h.motor.slow = Math.min(0.35, it.k.mass / 160);
          this._emit(EV.CATCH, h.slot, -1, t.x, t.y, t.z, 0, it.kind);
        } else {
          // Ağır eşyalar yavaş, hafifler hızlı gelir
          const sp = Math.min(it.k.pullSpeed, d * 6);
          const k = Math.min(1, 9 * dt);
          this._v.x = lv.x + ((dx / d) * sp + h.vx * 0.5 - lv.x) * k;
          this._v.y = lv.y + ((dy / d) * sp - lv.y) * k;
          this._v.z = lv.z + ((dz / d) * sp + h.vz * 0.5 - lv.z) * k;
          it.body.setLinvel(this._v, true);
          const av = it.body.angvel();
          this._v.x = av.x * 0.9; this._v.y = av.y * 0.9; this._v.z = av.z * 0.9;
          it.body.setAngvel(this._v, true);
          return;
        }
      }
      // HELD: yaylı takip (spring) -> önümüzde süzülür, çarpınca hafifçe sallanır
      if (d > 4.5) { this._dropHeld(h); return; } // bir şeye sıkıştı, düşür
      const kf = 16;
      let vx = dx * kf + h.vx, vy = dy * kf, vz = dz * kf + h.vz;
      const vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (vl > 40) { vx *= 40 / vl; vy *= 40 / vl; vz *= 40 / vl; }
      this._v.x = vx; this._v.y = vy; this._v.z = vz;
      it.body.setLinvel(this._v, true);
      const av = it.body.angvel();
      this._v.x = av.x * 0.7; this._v.y = 1.1; this._v.z = av.z * 0.7; // yavaşça döner
      it.body.setAngvel(this._v, true);
      return;
    }
    if (it.state === ITEM_STATE.THROWN) {
      it.thrownT += dt;
      const lv = it.body.linvel();
      it.lvx = lv.x; it.lvy = lv.y; it.lvz = lv.z;
      it.lastSpeed = Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z);
      if (it.thrownT > THROWN_MAX_TIME || (it.thrownT > 0.2 && it.lastSpeed < THROWN_MIN_SPEED)) this._freeItem(it);
    }
  }

  _throw(p, cam, fwd) {
    const it = this.items[p.holding];
    const k = it.k;
    // Nişangâhın gösterdiği noktayı bul (kendimizi ve tuttuğumuz eşyayı yok say)
    const ray = this._ray;
    ray.origin.x = cam.x; ray.origin.y = cam.y; ray.origin.z = cam.z;
    ray.dir.x = fwd.x; ray.dir.y = fwd.y; ray.dir.z = fwd.z;
    const hit = this.world.castRay(ray, 90, true, undefined, undefined, it.collider, p.body);
    const toi = hit ? hit.timeOfImpact : 90;
    const tx = cam.x + fwd.x * toi, tz = cam.z + fwd.z * toi;
    let ty = cam.y + fwd.y * toi;
    const t = it.body.translation();
    let dx = tx - t.x, dz = tz - t.z;
    const hd = Math.sqrt(dx * dx + dz * dz);
    // Yerçekimi telafisi: uzağa atarken biraz yukarı nişan al ki tam isabet etsin
    const flight = hd / k.throwSpeed;
    ty += 0.5 * -GRAVITY * THROWN_GRAVITY * flight * flight;
    let dy = ty - t.y;
    let d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= d; dy /= d; dz /= d;
    if (dx * fwd.x + dy * fwd.y + dz * fwd.z < 0.4 || toi < 1) { dx = fwd.x; dy = fwd.y; dz = fwd.z; }

    p.holding = -1;
    p.motor.slow = 0;
    it.holder = -1;
    it.state = ITEM_STATE.THROWN;
    it.thrower = p.slot;
    it.thrownT = 0;
    it.bumped = false;
    it.collider.setCollisionGroups(CG_ITEM);
    it.body.setGravityScale(THROWN_GRAVITY, true);
    it.body.enableCcd(true); // hızlı uçan eşya ince şeylerin içinden geçmesin
    this._v.x = dx * k.throwSpeed + p.vx * 0.3;
    this._v.y = dy * k.throwSpeed;
    this._v.z = dz * k.throwSpeed + p.vz * 0.3;
    it.body.setLinvel(this._v, true);
    it.lvx = this._v.x; it.lvy = this._v.y; it.lvz = this._v.z;
    it.lastSpeed = k.throwSpeed;
    this._v.x = -dz * 8; this._v.y = 3; this._v.z = dx * 8; // havada takla
    it.body.setAngvel(this._v, true);
    this._emit(EV.THROW, p.slot, -1, t.x, t.y, t.z, k.throwSpeed, it.kind);
  }

  _wave(p, fwd) {
    p.pushCd = WAVE_COOLDOWN;
    let fx = fwd.x, fz = fwd.z;
    const fl = Math.sqrt(fx * fx + fz * fz) || 1;
    fx /= fl; fz /= fl;
    this._emit(EV.WAVE, p.slot, -1, p.x + fx, p.y, p.z + fz, Math.atan2(-fx, -fz), 0);
    const cosA = Math.cos(WAVE_ANGLE);
    for (const q of this.players) {
      if (!q || q === p || !q.alive) continue;
      const dx = q.x - p.x, dz = q.z - p.z, dy = q.y - p.y;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > WAVE_RANGE || Math.abs(dy) > 3) continue;
      const nx = d > 0.01 ? dx / d : fx, nz = d > 0.01 ? dz / d : fz;
      if (d > 1.4 && nx * fx + nz * fz < cosA) continue;
      const power = WAVE_POWER * (1 - (d / WAVE_RANGE) * 0.55);
      this._knock(q, nx * 0.6 + fx * 0.4, nz * 0.6 + fz * 0.4, power, 5, p.slot, WAVE_KIND);
    }
    for (const it of this.items) {
      if (it.state === ITEM_STATE.GONE || it.state === ITEM_STATE.HELD || it.state === ITEM_STATE.PULLED) continue;
      const dx = it.x - p.x, dz = it.z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > WAVE_RANGE || d < 0.01) continue;
      if (d > 1.4 && (dx / d) * fx + (dz / d) * fz < cosA) continue;
      const s = (18 / Math.sqrt(it.k.mass)) * (1 - d / (WAVE_RANGE * 1.3));
      it.body.wakeUp();
      const lv = it.body.linvel();
      this._v.x = lv.x + (dx / d) * s; this._v.y = lv.y + s * 0.4; this._v.z = lv.z + (dz / d) * s;
      it.body.setLinvel(this._v, true);
    }
  }

  /** Oyuncuyu savur: yatay yön (nx,nz), güç (m/s), yukarı zıplatma. */
  _knock(q, nx, nz, power, up, attacker, kindTag) {
    const l = Math.sqrt(nx * nx + nz * nz) || 1;
    nx /= l; nz /= l;
    q.motor.hookOn = false;
    const lv = q.body.linvel();
    this._v.x = nx * power + lv.x * 0.25;
    this._v.y = Math.max(lv.y, up);
    this._v.z = nz * power + lv.z * 0.25;
    q.body.setLinvel(this._v, true);
    q.motor.stun = Math.max(q.motor.stun, 0.3 + power * 0.035);
    q.motor.grounded = false;
    if (attacker >= 0 && attacker !== q.slot) {
      q.lastHitter = attacker; q.lastHitTime = this.time; q.lastHitKind = kindTag;
    }
    if (power > 18) this._dropHeld(q); // çok sert darbe elindekini düşürtür
  }

  // ======================================================================== ÇARPIŞMALAR
  _onCollision(h1, h2) {
    const a = this.owner.get(h1), b = this.owner.get(h2);
    // Fırlatılmış eşya hangisi?
    let it = null, other = null;
    if (a && a.k && a.state === ITEM_STATE.THROWN) { it = a; other = b; } else if (b && b.k && b.state === ITEM_STATE.THROWN) { it = b; other = a; }
    if (!it) return;
    const k = it.k;
    const speedF = clamp(it.lastSpeed / k.throwSpeed, 0.35, 1.15);
    if (other && other.motor) {
      // ---- Oyuncuya isabet!
      const q = other;
      if (!q.alive) return;
      if (q.slot === it.thrower && it.thrownT < SELF_HIT_GRACE) return;
      const power = k.knock * speedF;
      let nx = it.lvx, nz = it.lvz;
      const hl = Math.sqrt(nx * nx + nz * nz) || 1;
      nx = nx / hl * 0.75 + (q.x - it.x) * 0.25; nz = nz / hl * 0.75 + (q.z - it.z) * 0.25;
      this._knock(q, nx, nz, power, 3 + power * 0.22, it.thrower, it.kind);
      const tp = this.players[it.thrower];
      if (tp && tp !== q) tp.hits++;
      this._emit(EV.HIT, it.thrower, q.slot, it.x, it.y, it.z, power, it.kind);
      this._freeItem(it); // aynı eşya iki kez vurmasın
    } else if (other && other.k && other.state === ITEM_STATE.HELD && other.holder >= 0) {
      // ---- Kalkan! Tutulan eşya darbeyi karşıladı, sahibi sadece biraz itilir
      const h = this.players[other.holder];
      if (h && h.slot !== it.thrower) {
        const power = k.knock * speedF * 0.28;
        this._knock(h, it.lvx, it.lvz, power, 2, it.thrower, it.kind);
        this._emit(EV.BLOCK, it.thrower, h.slot, other.x, other.y, other.z, power, it.kind);
      }
      this._freeItem(it);
    } else if (!it.bumped && it.lastSpeed > 9) {
      // Yere / başka eşyaya sert çarpma: sadece toz ve ses efekti
      it.bumped = true;
      this._emit(EV.BUMP, it.thrower, -1, it.x, it.y, it.z, it.lastSpeed * 0.5, it.kind);
    }
  }

  // ======================================================================== YARDIMCILAR
  /** Bot için boşta bir isim seç. */
  pickBotName() {
    const used = new Set(this.players.filter(Boolean).map((p) => p.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    return free.length ? free[Math.floor(Math.random() * free.length)] : 'Bot ' + Math.floor(Math.random() * 99);
  }

  /** Rapier belleğini serbest bırak (oda kapanınca). */
  dispose() {
    this.eventQueue.free();
    this.world.free();
  }

  setDifficulty(level) {
    this.difficulty = level;
    for (const p of this.players) if (p && p.brain) p.brain.setLevel(level);
  }
}
