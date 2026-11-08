// ============================================================================
// OYUN DÖNGÜSÜ — Her karede (requestAnimationFrame):
//   1) Oturumu ilerlet (tek oyunculu: simülasyon / çok oyunculu: ağ + tahmin)
//   2) Olayları işle (vuruş efekti, ses, skor akışı, kamera sarsıntısı)
//   3) Kamerayı yerleştir (omuz üstü / izleyici / menü turu)
//   4) Sahneyi güncelle ve çiz, arayüzü güncelle
// ============================================================================
import * as THREE from 'three';
import {
  PHASE, EV, PLAYER_COLORS, HOOK_RANGE, CAM_DISTANCE, ITEM_STATE, MAX_RING, TILE, PITCH_MIN, PITCH_MAX,
  cameraFromPlayer, forwardFromAngles, aimOrigin, findAimTarget, elimMessage,
} from '@miknatis/shared';
import { esc, hex } from '../hud.js';

const ITEM_FX_COLORS = [0x4fbf4a, 0xff6a13, 0xe23b3b, 0xd8d8d8, 0xc62f2f, 0xc8935a, 0xbfe8e0];

/** Menüdeki demo için "hiçbir şeye basmayan" girdi. */
const idleInput = { yaw: 0, pitch: 0, sample(out) { out.mx = 0; out.mz = 0; out.buttons = 0; out.jump = false; return out; } };

export class Game {
  constructor(renderer, input, audio, hud) {
    this.r = renderer;
    this.input = input;
    this.audio = audio;
    this.hud = hud;
    this.session = null; // gerçek oyun
    this.demo = null; // menü arkasında dövüşen botlar
    this.callbacks = {};
    this.lastPhase = -1;
    this.lastCount = -1;
    this.overtimeShown = false;
    this.endTimer = -1;
    this.shake = 0;
    this.fovKick = 0;
    this.orbitA = 0.6;
    this.specSlot = -1;
    this.specYaw = 0;
    this.debugOn = false;
    this.tabOn = false;
    this.cam = { x: 0, y: 0, z: 0 };
    this.fwd = { x: 0, y: 0, z: -1 };
    this.metalHit = { x: 0, y: 0, z: 0 };
    this.ray = null;
    this.aimTarget = -1;
    this._look = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._smoothCam = new THREE.Vector3();
    this._shakeV = new THREE.Vector3();
    this.camPull = 0;
    this.time = 0;
    this.groundFn = (x, y, z) => (this.activeSession() ? this.activeSession().groundHeight(x, y, z) : 0);

    input.onKey = (code, down) => this._onKey(code, down);
    input.onClick = () => this._onClick();
    input.onLockChange = () => { if (this.input.locked) this.audio.unlock(); };
    this._prev = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  activeSession() { return this.session || this.demo; }

  setSession(s) {
    if (this.session) this.session.leave();
    this.session = s;
    this.lastPhase = -1;
    this.specSlot = -1;
    this.endTimer = -1;
    this.hud.clearFeed();
    if (s) {
      if (!this.ray) this.ray = new s.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
      this.input.yaw = 0; this.input.pitch = -0.15;
      // Menüdeki demo duruyor (boşuna CPU harcamasın)
      if (this.demo) { this.demo.leave(); this.demo = null; }
    } else {
      this.input.enabled = false;
      this.hud.show(false);
      this.audio.setHum(false);
    }
  }

  setDemo(s) { if (this.demo) this.demo.leave(); this.demo = s; }

  _onKey(code, down) {
    if (code === 'F3' && down) this.debugOn = !this.debugOn;
    if (code === 'Tab') this.tabOn = down;
    if (code === 'KeyM' && down) {
      const m = this.audio.toggleMute();
      this.hud.subOnly(m ? '🔇 Ses kapalı' : '🔊 Ses açık');
    }
    if (code === 'KeyR' && down && this.session && this.session.kind === 'local') {
      const v = this.session.view, me = v.players[v.localSlot];
      if (me && !me.alive && v.phase === PHASE.PLAYING) this.session.again();
    }
  }

  _onClick() {
    const s = this.session;
    if (!s) return;
    const v = s.view, me = v.localSlot >= 0 ? v.players[v.localSlot] : null;
    if (me && me.alive) return;
    this._nextSpectate(v);
  }

  _nextSpectate(v) {
    for (let k = 1; k <= v.players.length; k++) {
      const i = (this.specSlot + k + v.players.length) % v.players.length;
      const p = v.players[i];
      if (p.exists && p.inRound && p.alive && !p.isLocal) { this.specSlot = i; return; }
    }
    this.specSlot = -1;
  }

  // ===================================================================== Döngü
  _loop(now) {
    requestAnimationFrame((t) => this._loop(t));
    const dt = Math.min(0.1, (now - this._prev) / 1000);
    this._prev = now;
    this.time += dt;
    const s = this.activeSession();
    const real = !!this.session;
    const view = s ? s.view : null;

    if (s) {
      // Girdi sadece oyun ekranında ve fare kilitliyken etkin
      if (real) {
        const ph = view.phase;
        this.input.enabled = ph === PHASE.COUNTDOWN || ph === PHASE.PLAYING || (ph === PHASE.ENDED && this.endTimer > 0);
      }
      s.update(dt, real ? this.input : idleInput);
      if (!real && view.phase === PHASE.ENDED && view.timer < 4) s.again(); // demo kendini yeniden başlatır
      s.pollEvents((e) => this._onEvent(e, view, real));
      if (real) this._phaseLogic(view, dt);
    }

    this._updateCamera(view, real, dt);
    if (view) this._updateWorld(view, real, dt);
    else {
      this.r.arena.update(dt, 0, -1);
      this.r.effects.beginFrame(dt);
      this.r.effects.update(dt);
    }
    this.r.clouds.update(dt);
    this.r.render();
    this.r.measure(dt, real);

    if (real) this._updateHud(view, dt);
    if (this.debugOn) this._debug(view);
    else this.hud.debug(null);
  }

  // ===================================================================== Evreler
  _phaseLogic(v, dt) {
    const ph = v.phase;
    if (ph !== this.lastPhase) {
      if (ph === PHASE.COUNTDOWN) {
        this.hud.clearFeed(); this.overtimeShown = false; this.lastCount = -1; this.specSlot = -1;
        this.r.arena.reset();
        if (this.callbacks.onPlaying) this.callbacks.onPlaying();
      }
      if (ph === PHASE.PLAYING && this.lastPhase === PHASE.COUNTDOWN) { this.hud.big('BAŞLA!'); this.audio.play('go'); }
      if (ph === PHASE.PLAYING && this.lastPhase !== PHASE.COUNTDOWN && this.callbacks.onPlaying) this.callbacks.onPlaying();
      if (ph === PHASE.ENDED) this.endTimer = 2.2; // son vuruşu görebilmek için biraz bekle
      if (ph === PHASE.LOBBY && this.callbacks.onLobby) this.callbacks.onLobby();
      this.lastPhase = ph;
    }
    if (ph === PHASE.COUNTDOWN) {
      const n = Math.ceil(v.timer);
      if (n !== this.lastCount && n > 0) { this.lastCount = n; this.hud.big(String(n)); this.audio.play('beep'); }
    }
    if (ph === PHASE.PLAYING && v.timer <= 0 && !this.overtimeShown) {
      this.overtimeShown = true;
      this.hud.big('SÜRE BİTTİ!', '⚠ Arena kenarlardan çöküyor!');
      this.audio.play('ring', 0.5);
    }
    if (ph === PHASE.ENDED && this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && this.callbacks.onEnded) {
        this.input.exitLock();
        this.callbacks.onEnded(v);
      }
    }
  }

  // ===================================================================== Olaylar
  _onEvent(e, v, real) {
    const local = real ? v.localSlot : -2;
    const cx = this.r.camera.position.x, cy = this.r.camera.position.y, cz = this.r.camera.position.z;
    const d = Math.hypot(e.x - cx, e.y - cy, e.z - cz);
    const vol = real ? Math.max(0, 1 - d / 55) : Math.max(0, 0.35 - d / 160);
    const fx = this.r.effects;
    const name = (slot) => (slot >= 0 && v.players[slot] && v.players[slot].exists ? v.players[slot].name : '?');
    switch (e.type) {
      case EV.HIT: {
        fx.hit(e.x, e.y, e.z, e.p, ITEM_FX_COLORS[e.k] || 0xffffff);
        this.r.players.flash(e.v);
        this.audio.play('hit', vol, e.p / 15);
        if (e.v === local) { this.shake = Math.min(1, this.shake + 0.35 + e.p / 40); this.hud.subOnly('💢 VURULDUN!'); } else if (d < 14) this.shake = Math.min(1, this.shake + (e.p / 60) * (1 - d / 14));
        if (e.a === local && e.v !== local) { this.hud.hitMarker(); this.audio.play('click', 1); }
        break;
      }
      case EV.BLOCK:
        fx.block(e.x, e.y, e.z);
        this.audio.play('block', vol);
        if (e.v === local) { this.hud.subOnly('🛡️ KALKAN!'); this.shake = Math.min(1, this.shake + 0.15); }
        break;
      case EV.WAVE:
        fx.wave(e.x, e.y, e.z, e.p);
        this.audio.play('wave', vol);
        if (d < 9) this.shake = Math.min(1, this.shake + 0.12);
        break;
      case EV.THROW:
        this.r.players.recoil(e.a);
        this.audio.play('throw', vol);
        if (e.a === local) this.fovKick = 6;
        break;
      case EV.BUMP:
        fx.dustPuff(e.x, e.y, e.z, e.p);
        this.audio.play('bump', vol * 0.7, e.p / 10);
        if (d < 8) this.shake = Math.min(1, this.shake + 0.06);
        break;
      case EV.CATCH:
        fx.catchFx(e.x, e.y, e.z);
        if (e.a === local) this.audio.play('catch', 0.8);
        break;
      case EV.STEAL:
        fx.catchFx(e.x, e.y, e.z);
        if (e.a === local) { this.hud.subOnly('😈 KAPTIN!'); this.audio.play('steal', 0.9); } else if (e.v === local) { this.hud.subOnly('😱 Eşyan kapıldı!'); this.audio.play('steal', 0.9); }
        break;
      case EV.HOOK:
        fx.hookFx(e.x, e.y, e.z);
        this.audio.play('hook', e.a === local ? 0.9 : vol);
        break;
      case EV.ELIM: {
        const victim = v.players[e.v];
        const color = victim ? PLAYER_COLORS[victim.color] : 0xffffff;
        fx.elim(e.x, Math.max(e.y, -9), e.z, color);
        if (!real) break;
        this.audio.play('fall', Math.max(0.35, vol));
        const msg = elimMessage(e.a >= 0 ? name(e.a) : null, name(e.v), e.k);
        const mine = e.a === local || e.v === local;
        this.hud.feed(`<span style="color:${hex(color)}">●</span> ${esc(msg)}`, mine);
        if (e.v === local) {
          const place = victim ? victim.place : 0;
          this.hud.big('DÜŞTÜN! 😵', `${place}. oldun` + (this.session.kind === 'local' ? ' · R: hemen tekrar oyna' : ''));
          this.audio.play('lose', 0.8);
          this._nextSpectate(v);
        } else if (e.a === local) {
          this.hud.subOnly('💥 DÜŞÜRDÜN!');
          this.audio.play('go', 0.6);
        }
        if (this.specSlot === e.v) this._nextSpectate(v);
        break;
      }
      case EV.RING:
        fx.ringFall((e.p + 0.5) * TILE);
        this.audio.play('ring', real ? 0.9 : 0.25);
        if (real) { this.shake = Math.min(1, this.shake + 0.4); if (e.k < MAX_RING) this.hud.subOnly('💥 Bir halka daha çöktü!'); }
        break;
      case EV.WIN:
        if (!real) break;
        if (e.a === local) { this.hud.big('KAZANDIN! 🏆'); this.audio.play('win', 1); } else if (e.a >= 0) { this.hud.big(`${name(e.a)} KAZANDI!`); this.audio.play('win', 0.5); } else this.hud.big('BERABERE!');
        break;
      default: break;
    }
  }

  // ===================================================================== Kamera
  _updateCamera(v, real, dt) {
    const cam = this.r.camera;
    const local = real && v && v.localSlot >= 0 ? v.players[v.localSlot] : null;
    const playing = real && v && v.phase !== PHASE.LOBBY;
    let mode = 'orbit';
    if (playing && local && local.alive && local.inRound) mode = 'play';
    else if (playing && v.phase === PHASE.PLAYING) mode = 'spectate';
    if (playing && v.phase === PHASE.ENDED && this.endTimer <= 0) mode = 'orbit';

    if (mode === 'play') {
      cameraFromPlayer(local.x, local.y, local.z, local.yaw, local.pitch, this.cam);
      forwardFromAngles(local.yaw, local.pitch, this.fwd);
      // Kamera duvara/direğe girmesin: omuzdan geriye ışın at, çarparsa kamerayı
      // NİŞAN ÇİZGİSİ ÜZERİNDE öne kaydır. Böylece nişangâh sunucunun hesapladığı
      // ışınla birebir aynı kalır (sadece başlangıç noktası öne gelir).
      const pc = Math.max(PITCH_MIN, Math.min(PITCH_MAX, local.pitch));
      const d = pc > 0 ? CAM_DISTANCE * (1 - pc * 0.45) : CAM_DISTANCE;
      let pull = 0;
      const s = this.activeSession();
      if (this.ray && s.castArena) {
        const ray = this.ray;
        ray.origin.x = this.cam.x + this.fwd.x * d; ray.origin.y = this.cam.y + this.fwd.y * d; ray.origin.z = this.cam.z + this.fwd.z * d;
        ray.dir.x = -this.fwd.x; ray.dir.y = -this.fwd.y; ray.dir.z = -this.fwd.z;
        const toi = s.castArena(ray, d);
        if (toi >= 0) pull = Math.min(d - 0.3, d - toi + 0.3);
      }
      this.camPull = pull > this.camPull ? pull : this.camPull + (pull - this.camPull) * Math.min(1, dt * 5);
      this._camPos.set(this.cam.x + this.fwd.x * this.camPull, this.cam.y + this.fwd.y * this.camPull, this.cam.z + this.fwd.z * this.camPull);
      this._smoothCam.copy(this._camPos);
    } else if (mode === 'spectate') {
      let t = this.specSlot >= 0 ? v.players[this.specSlot] : null;
      if (!t || !t.alive || !t.exists) { this._nextSpectate(v); t = this.specSlot >= 0 ? v.players[this.specSlot] : null; }
      if (t) {
        this.specYaw += (((t.yaw - this.specYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 3);
        cameraFromPlayer(t.x, t.y, t.z, this.specYaw, -0.3, this.cam);
        this._camPos.set(this.cam.x, this.cam.y + 1.2, this.cam.z);
        this._smoothCam.lerp(this._camPos, Math.min(1, dt * 6));
        this._look.set(t.x, t.y + 0.8, t.z);
      }
    } else {
      // Menü / lobi / tur sonu: arenanın etrafında yavaşça dön
      this.orbitA += dt * 0.07;
      let cx = 0, cz = 0, rad = 36, h = 17;
      if (real && v && v.phase === PHASE.ENDED && v.winner >= 0 && v.players[v.winner].alive) {
        const w = v.players[v.winner]; cx = w.x; cz = w.z; rad = 9; h = w.y + 4;
      }
      this._camPos.set(cx + Math.cos(this.orbitA) * rad, h, cz + Math.sin(this.orbitA) * rad);
      this._smoothCam.lerp(this._camPos, Math.min(1, dt * 2));
      this._look.set(cx, real && v && v.phase === PHASE.ENDED ? h - 3.5 : 0, cz);
    }

    // Kamera sarsıntısı (trauma^2 ile)
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const s = this.shake * this.shake * 0.45;
    cam.position.copy(this._smoothCam);
    if (s > 0.001) cam.position.add(this._shakeV.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    if (mode === 'play') {
      cam.lookAt(this.cam.x + this.fwd.x * 10, this.cam.y + this.fwd.y * 10, this.cam.z + this.fwd.z * 10);
    } else if (mode === 'spectate') {
      const t = this.specSlot >= 0 ? v.players[this.specSlot] : null;
      if (t) cam.lookAt(t.x, t.y + 0.8, t.z);
    } else {
      let cx = 0, cz = 0, ly = 0;
      if (real && v && v.phase === PHASE.ENDED && v.winner >= 0 && v.players[v.winner].alive) { const w = v.players[v.winner]; cx = w.x; cz = w.z; ly = w.y + 0.5; }
      cam.lookAt(cx, ly, cz);
    }
    // FOV vuruşu (fırlatınca hafif zoom-out hissi)
    this.fovKick = Math.max(0, this.fovKick - dt * 25);
    const fov = this.r.baseFov + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  // ===================================================================== Sahne
  _updateWorld(v, real, dt) {
    const r = this.r;
    const local = real && v.localSlot >= 0 ? v.players[v.localSlot] : null;
    const s = this.activeSession();

    // Nişan alınan eşya (sadece görsel vurgu; asıl seçimi sunucu yapar)
    this.aimTarget = -1;
    this.crossState = '';
    if (local && local.alive && local.inRound) {
      if (local.hold >= 0) this.crossState = 'holding';
      else {
        this.aimTarget = findAimTarget(this.cam, this.fwd, v.items, local.slot);
        if (this.aimTarget >= 0) this.crossState = 'item';
        else if (this.ray && s.aimingMetal) {
          const ray = this.ray;
          aimOrigin(local.x, local.y, local.z, local.yaw, local.pitch, ray.origin); // sunucuyla aynı başlangıç
          ray.dir.x = this.fwd.x; ray.dir.y = this.fwd.y; ray.dir.z = this.fwd.z;
          if (s.aimingMetal(ray, HOOK_RANGE, this.metalHit)) this.crossState = 'metal';
        }
      }
      // Mıknatıs uğultusu
      const pulling = local.pull >= 0, holding = local.hold >= 0;
      this.audio.setHum(pulling || holding, pulling ? 1 : 0.35);
    } else this.audio.setHum(false);

    r.arena.update(dt, v.shrink, v.warnRing);
    r.items.update(v.items, this.aimTarget, dt);
    r.players.update(v.players, dt, this.groundFn);

    // Işınlar ve halatlar
    const fx = r.effects;
    fx.beginFrame(dt);
    for (let i = 0; i < v.players.length; i++) {
      const p = v.players[i];
      if (!p.exists || !p.alive || !p.inRound) continue;
      const a = r.players.anim[i];
      const m = a.muzzle;
      const target = p.hold >= 0 ? p.hold : p.pull;
      if (target >= 0) {
        const it = v.items[target];
        if (it.state !== ITEM_STATE.GONE) fx.beam(m.x, m.y, m.z, it.x, it.y, it.z, p.hold >= 0 ? 0.35 : 1, p.pull >= 0 && it.holder !== i && it.holder >= 0);
      }
      if (p.hook) fx.cable(m.x, m.y, m.z, p.hx, p.hy, p.hz);
    }
    fx.update(dt);
    if (real) this.hud.updateTags(v, r.renderer, r.camera, r.players.anim);
  }

  // ===================================================================== HUD
  _updateHud(v, dt) {
    const local = v.localSlot >= 0 ? v.players[v.localSlot] : null;
    const ph = v.phase;
    const inGame = ph === PHASE.COUNTDOWN || ph === PHASE.PLAYING || (ph === PHASE.ENDED && this.endTimer > 0);
    this.hud.show(inGame);
    if (!inGame) { this.hud.clickToPlay(false); return; }
    this.hud.update(v, local, this.crossState || '', dt);
    const dead = !local || !local.alive || !local.inRound;
    if (dead && ph === PHASE.PLAYING) {
      const t = this.specSlot >= 0 ? v.players[this.specSlot] : null;
      this.hud.spectate(t ? t.name : '—', this.session.kind === 'local');
    } else this.hud.spectate(null);
    this.hud.clickToPlay(!this.input.locked);
    this.hud.scoreboard(v, this.tabOn);
  }

  _debug(v) {
    const s = this.activeSession();
    const lines = [
      `FPS: ${this.r.fps.toFixed(0)}   kalite: ${['düşük', 'orta', 'yüksek'][this.r.quality]}`,
      `draw call: ${this.r.drawCalls}   üçgen: ${this.r.triangles}`,
      `mod: ${!this.session ? 'menü (demo)' : this.session.kind === 'local' ? 'tek oyunculu' : 'çok oyunculu'}`,
    ];
    if (this.session && this.session.kind === 'net') {
      const n = this.session;
      lines.push(`ping: ${n.rtt.toFixed(0)} ms`);
      lines.push(`sunucu tick: ${n.serverTickMs.toFixed(2)} ms`);
      lines.push(`gelen veri: ${n.kbps.toFixed(2)} KB/s`);
      lines.push(`tahmin düzeltmesi: ${n.predictor.corrections}  bekleyen girdi: ${n.predictor.hCount}`);
    } else if (s) {
      lines.push(`sim tick: ${s.sim.tickHz} Hz`);
    }
    if (v) lines.push(`evre: ${['lobi', 'geri sayım', 'oyun', 'bitti'][v.phase]}  hayatta: ${v.alive}/${v.total}  küçülme: ${v.shrink}`);
    this.hud.debug(lines.join('\n'));
  }
}

