// ============================================================================
// OYUN ODASI (Colyseus Room)
// Her oda kendi Simulation'ını (shared) çalıştırır. Oda sadece "trafik polisi":
//   - Girdileri alır, simülasyona verir
//   - Simülasyonu 20 Hz'de ilerletir
//   - Sonucu Schema durumuna yazar (Colyseus değişenleri istemcilere yollar)
//   - Lobi, bot doldurma, bağlantı kopması, oda kurucusu gibi işleri yönetir
// ============================================================================
import { Room, ServerError } from '@colyseus/core';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  Simulation, SERVER_TICK_HZ, PHASE, MAX_PLAYERS, ITEM_STATE,
  createInput, decodeInput, toCm, packAngle, packQuat, BOT_LEVELS,
} from '@miknatis/shared';
import { GameState, PlayerState, ItemState } from './schema.js';

/** Aktif odalar. Ücretsiz sunucuyu korumak için en fazla MAX_ROOMS oda. */
export const activeRooms = new Set();
export const MAX_ROOMS = Number(process.env.MAX_ROOMS || 3);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // karışan harfler (O/0, I/1) yok
function makeCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (![...activeRooms].some((r) => r.roomId === c)) return c;
  }
}
const cleanName = (n) => (typeof n === 'string' ? n.replace(/[<>]/g, '').trim().slice(0, 16) : '') || 'Oyuncu';

export class GameRoom extends Room {
  maxClients = MAX_PLAYERS; // oda başına en fazla 8 gerçek oyuncu

  onCreate(options) {
    if (activeRooms.size >= MAX_ROOMS) {
      // İstemci bu kodu görünce "Sunucu dolu" mesajı gösterir
      throw new ServerError(4503, 'SUNUCU_DOLU');
    }
    activeRooms.add(this);
    this.roomId = makeCode(); // davet linkindeki kod: ?oda=ABC123
    this.autoDispose = true;

    this.sim = new Simulation(RAPIER, { tickHz: SERVER_TICK_HZ, difficulty: 'orta' });
    this.setState(new GameState());
    this.state.code = this.roomId;
    this.sessionSlot = new Map(); // sessionId -> slot
    this.leavers = new Set(); // turun sonunda silinecek (kopmuş) oyuncular
    this._input = createInput();
    this._evBuf = [];

    // Simülasyondaki eşyalar sabit: Schema karşılıklarını bir kez oluştur.
    // Diziler, her tick'te Map araması ve String() oluşturmamak için.
    this.itemStates = [];
    this.playerStates = new Array(16).fill(null);
    for (const it of this.sim.items) {
      const s = new ItemState();
      s.kind = it.kind;
      this.state.items.set(String(it.id), s);
      this.itemStates.push(s);
    }

    // ---- Mesajlar (istemciden gelenler)
    this.onMessage('i', (client, arr) => {
      const slot = this.sessionSlot.get(client.sessionId);
      if (slot === undefined) return;
      if (decodeInput(arr, this._input)) this.sim.pushInput(slot, this._input);
    });
    this.onMessage('start', (client) => {
      if (client.sessionId !== this.state.host) return;
      if (this.sim.phase === PHASE.LOBBY || this.sim.phase === PHASE.ENDED) this.startRound();
    });
    this.onMessage('cfg', (client, msg) => {
      if (client.sessionId !== this.state.host || !msg) return;
      if (this.sim.phase === PHASE.PLAYING || this.sim.phase === PHASE.COUNTDOWN) return;
      if (BOT_LEVELS[msg.diff]) { this.state.diff = msg.diff; this.sim.setDifficulty(msg.diff); }
      if (Number.isInteger(msg.fill)) this.state.fill = Math.max(0, Math.min(MAX_PLAYERS, msg.fill));
      this.fillBots();
    });
    this.onMessage('p', (client, t) => client.send('p', t)); // ping-pong (gecikme ölçümü)
    this.onMessage('menu', (client) => {
      // Tur bitince herkes lobiye döner
      if (client.sessionId === this.state.host && this.sim.phase === PHASE.ENDED) {
        this.sim.phase = PHASE.LOBBY;
        this.cleanupLeavers();
        this.fillBots();
      }
    });

    // ---- Oyun döngüsü: sabit 20 Hz. Patch (ağ gönderimi) de 20 Hz.
    this.setPatchRate(1000 / SERVER_TICK_HZ);
    this.setSimulationInterval(() => this.update(), 1000 / SERVER_TICK_HZ);
    this.tickMs = 0; this.tickSum = 0; this.tickN = 0; this.lastWarn = 0;
    this.clock.setInterval(() => {
      this.broadcast('srv', [Math.round(this.tickMs * 100) / 100, activeRooms.size]);
    }, 2000);
    console.log(`[oda ${this.roomId}] oluşturuldu (aktif oda: ${activeRooms.size}/${MAX_ROOMS})`);
  }

  onJoin(client, options) {
    const name = cleanName(options && options.name);
    // Lobide yer açmak için bir bot ayrılır
    if (this.sim.phase === PHASE.LOBBY || this.sim.phase === PHASE.ENDED) this.removeOneBot();
    const p = this.sim.addPlayer(client.sessionId, name, false);
    if (!p) throw new ServerError(4504, 'ODA_DOLU');
    this.sessionSlot.set(client.sessionId, p.slot);
    if (!this.state.host) this.state.host = client.sessionId;
    this.ensurePlayerState(p);
    if (this.sim.phase === PHASE.LOBBY) this.fillBots();
    console.log(`[oda ${this.roomId}] ${name} katıldı`);
  }

  async onLeave(client, consented) {
    const slot = this.sessionSlot.get(client.sessionId);
    if (slot === undefined) return;
    const p = this.sim.players[slot];
    const inGame = this.sim.phase === PHASE.PLAYING || this.sim.phase === PHASE.COUNTDOWN;
    if (!consented && p) {
      // Bağlantı koptu: oyun çökmesin, karakteri bot oynasın. 30 sn içinde dönerse geri alır.
      this.sim.setBotControl(slot, true);
      this.state.players.get(String(slot)).afk = true;
      this.passHost(client.sessionId);
      try {
        await this.allowReconnection(client, 30);
        this.sim.setBotControl(slot, false);
        const ps = this.state.players.get(String(slot));
        if (ps) ps.afk = false;
        if (!this.state.host) this.state.host = client.sessionId;
        return;
      } catch (e) { /* geri dönmedi */ }
    }
    this.sessionSlot.delete(client.sessionId);
    this.passHost(client.sessionId);
    const stillIn = this.sim.phase === PHASE.PLAYING || this.sim.phase === PHASE.COUNTDOWN;
    if ((inGame || stillIn) && p && p.alive) {
      // Tur sürüyor: karakter tur sonuna kadar bot olarak kalır
      this.sim.setBotControl(slot, true);
      const ps = this.state.players.get(String(slot));
      if (ps) ps.afk = true;
      this.leavers.add(slot);
    } else {
      this.removeSlot(slot);
      if (this.sim.phase === PHASE.LOBBY) this.fillBots();
    }
  }

  onDispose() {
    activeRooms.delete(this);
    if (this.sim) this.sim.dispose();
    console.log(`[oda ${this.roomId}] kapandı (aktif oda: ${activeRooms.size}/${MAX_ROOMS})`);
  }

  // ======================================================================== Yardımcılar
  passHost(leavingSid) {
    if (this.state.host !== leavingSid) return;
    this.state.host = '';
    for (const c of this.clients) {
      if (c.sessionId !== leavingSid && this.sessionSlot.has(c.sessionId)) { this.state.host = c.sessionId; break; }
    }
  }

  humans() {
    let n = 0;
    for (const p of this.sim.players) if (p && !p.id.startsWith('bot:') && !this.leavers.has(p.slot)) n++;
    return n;
  }

  bots() {
    return this.sim.players.filter((p) => p && p.isBot && p.id.startsWith('bot:'));
  }

  /** Lobide boş yerleri botlarla doldur (ya da fazla botu çıkar). */
  fillBots() {
    const humans = this.humans();
    let want = Math.max(0, Math.min(MAX_PLAYERS, this.state.fill) - humans);
    if (humans + want < 2) want = 2 - humans; // en az 2 kişi olmalı
    want = Math.min(want, MAX_PLAYERS - humans);
    const bots = this.bots();
    while (bots.length > want) this.removeSlot(bots.pop().slot);
    for (let i = bots.length; i < want; i++) {
      const p = this.sim.addPlayer('bot:' + Math.random().toString(36).slice(2, 7), this.sim.pickBotName(), true);
      if (!p) break;
      this.ensurePlayerState(p);
    }
  }

  removeOneBot() {
    const bots = this.bots();
    if (bots.length) this.removeSlot(bots[bots.length - 1].slot);
  }

  removeSlot(slot) {
    this.sim.removePlayer(slot);
    this.state.players.delete(String(slot));
    this.playerStates[slot] = null;
    this.leavers.delete(slot);
  }

  cleanupLeavers() {
    for (const slot of [...this.leavers]) this.removeSlot(slot);
  }

  ensurePlayerState(p) {
    const key = String(p.slot);
    let ps = this.state.players.get(key);
    if (!ps) { ps = new PlayerState(); this.state.players.set(key, ps); }
    this.playerStates[p.slot] = ps;
    ps.sid = p.isBot ? '' : p.id;
    ps.name = p.name;
    ps.color = p.color;
    ps.bot = p.id.startsWith('bot:');
    return ps;
  }

  startRound() {
    this.cleanupLeavers();
    this.fillBots();
    this.sim.startRound();
    this.state.winner = -1;
    console.log(`[oda ${this.roomId}] tur başladı: ${this.sim.participants} oyuncu`);
  }

  // ======================================================================== Döngü
  update() {
    const t0 = performance.now();
    this.sim.step();
    this.syncState();
    this.sendEvents();

    // Tick süresini ölç: ortalama 20 ms'yi geçerse uyar (0.1 CPU'da önemli!)
    const ms = performance.now() - t0;
    this.tickSum += ms; this.tickN++;
    if (this.tickN >= 100) {
      this.tickMs = this.tickSum / this.tickN;
      if (this.tickMs > 20) console.warn(`[oda ${this.roomId}] UYARI: ortalama tick ${this.tickMs.toFixed(1)} ms (>20 ms)`);
      this.tickSum = 0; this.tickN = 0;
    }
  }

  /** Simülasyonu Schema'ya yaz. Setter'lar aynı değeri yazınca değişiklik saymaz. */
  syncState() {
    const sim = this.sim, st = this.state;
    st.tick = sim.tick;
    st.phase = sim.phase;
    st.timer = Math.max(-999, Math.ceil(sim.timer));
    st.shrink = sim.shrink;
    st.warn = sim.warnRing;
    st.alive = sim.aliveCount;
    st.total = sim.participants;
    st.winner = sim.winner;

    for (const p of sim.players) {
      if (!p) continue;
      const ps = this.playerStates[p.slot];
      if (!ps) continue;
      ps.inRound = p.inRound;
      ps.alive = p.alive;
      ps.kills = p.kills; ps.hits = p.hits; ps.place = p.place; ps.wins = p.wins;
      if (!p.alive) continue; // elenmişin konumu değişmez -> gönderme
      ps.x = toCm(p.x); ps.y = toCm(p.y); ps.z = toCm(p.z);
      ps.yaw = packAngle(p.yaw); ps.pitch = packAngle(p.pitch);
      ps.hold = p.holding; ps.pull = p.pulling;
      const m = p.motor;
      ps.hook = m.hookOn;
      if (m.hookOn) { ps.hx = toCm(m.hx); ps.hy = toCm(m.hy); ps.hz = toCm(m.hz); }
      ps.stun = Math.min(255, Math.ceil(Math.max(0, m.stun) * 50)); // sersemlik (sallanma efekti için herkese)
      if (!p.isBot) {
        // Sadece insanlar için: kendi istemcisinin tahmini (prediction) düzeltmesi bunlara bakar
        ps.vx = toCm(p.vx); ps.vy = toCm(p.vy); ps.vz = toCm(p.vz);
        ps.ack = p.ack;
        ps.hookT = Math.min(255, Math.ceil(Math.max(0, m.hookT) * 50));
        ps.slow = Math.round(m.slow * 100);
        ps.pushCd = Math.ceil(Math.max(0, p.pushCd) * 10); // bekleme süreleri (arayüz göstergesi)
        ps.hookCd = Math.ceil(Math.max(0, p.hookCd) * 10);
      }
    }

    for (const it of sim.items) {
      const s = this.itemStates[it.id];
      s.s = it.state;
      s.h = it.holder;
      // Uyuyan (duran) eşyaların konumu değişmez -> hiç veri gitmez
      // (dirty: tur başında yerine konan eşya uyusa da yeni konumu bir kez gitmeli)
      if ((it.sleeping && !it.dirty) || it.state === ITEM_STATE.GONE) continue;
      it.dirty = false;
      s.x = toCm(it.x); s.y = toCm(it.y); s.z = toCm(it.z);
      s.q = packQuat(it.qx, it.qy, it.qz, it.qw);
    }
  }

  /** Bu tick'teki olayları (vuruş, eleme...) tek mesajda yolla. */
  sendEvents() {
    const sim = this.sim;
    if (sim.eventCount === 0) return;
    const buf = this._evBuf;
    buf.length = 0;
    for (let i = 0; i < sim.eventCount; i++) {
      const e = sim.events[i];
      buf.push(e.type, e.a, e.v, toCm(e.x), toCm(e.y), toCm(e.z), Math.round(e.p * 100), e.k);
    }
    // afterNextPatch: olaylar durum yamasıyla aynı pakette gider (daha az sistem çağrısı)
    this.broadcast('e', buf, { afterNextPatch: true });
  }
}
