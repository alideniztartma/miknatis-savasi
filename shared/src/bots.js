// ============================================================================
// BOTLAR — Yapay zekâ rakipler.
// Botlar da insan gibi "girdi" üretir (WASD, bakış, tıklamalar). Böylece
// oyun kuralları için bot / insan ayrımı yoktur, hile de yapamazlar :)
//
// Performans: KARAR saniyede 5 kez verilir (pahalı kısım: hedef seçme,
// kenar kontrolü). Her tick'te sadece nişanı hedefe doğru yumuşakça çevirir.
// ============================================================================
import {
  BOT_LEVELS, BOT_DECISION_HZ, ITEM_STATE, PULL_RANGE, HOOK_RANGE, WAVE_RANGE, PHASE,
} from './constants.js';
import { BTN } from './input.js';
import { cameraFromPlayer, angleDiff, clamp } from './math.js';
import { isOnArena, arenaRadius, ringAlive } from './arena.js';

const _cam = { x: 0, y: 0, z: 0 };

export class BotBrain {
  constructor(level = 'orta') {
    this.setLevel(level);
    this.decideT = Math.random() * 0.2;
    this.reset(null);
  }

  setLevel(level) {
    this.level = BOT_LEVELS[level] ? level : 'orta';
    this.cfg = BOT_LEVELS[this.level];
  }

  reset(p) {
    this.aimYaw = p ? p.yaw : 0;
    this.aimPitch = 0;
    this.moveX = 0; // dünya koordinatında istenen yürüme yönü
    this.moveZ = 0;
    this.wantPull = false;
    this.wantThrow = false;
    this.wantWave = false;
    this.wantHook = false;
    this.wantJump = false;
    this.wantDrop = false;
    this.holdTime = 0;
    this.targetPlayer = -1;
    this.errYaw = 0;
    this.errPitch = 0;
    this.stuckT = 0;
    this.reactT = 0;
    this.hasAim = false;
    this.tx = 0; this.ty = 0; this.tz = 0;
  }

  /** Her tick çağrılır: karar zamanı geldiyse düşün, sonra girdiyi üret. */
  update(sim, p, dt) {
    this.decideT -= dt;
    if (this.decideT <= 0) {
      this.decideT += 1 / BOT_DECISION_HZ;
      this.decide(sim, p);
    }
    const inp = p.input;
    // Hedef noktası her tick yeniden hesaplanır (biz hareket ettikçe açı değişir; ucuz bir işlem)
    if (this.hasAim) this._solveAim(p);
    // Nişanı yumuşakça hedefe çevir (insan gibi, ani dönmesin)
    const maxTurn = this.cfg.turnSpeed * dt;
    const dy = angleDiff(inp.yaw, this.aimYaw + this.errYaw);
    inp.yaw += clamp(dy, -maxTurn, maxTurn);
    if (inp.yaw > Math.PI) inp.yaw -= Math.PI * 2; else if (inp.yaw < -Math.PI) inp.yaw += Math.PI * 2;
    const dp = this.aimPitch + this.errPitch - inp.pitch;
    inp.pitch += clamp(dp, -maxTurn, maxTurn);

    // Dünya yönündeki hareketi bakışa göre yerel WASD'ye çevir
    const sy = Math.sin(inp.yaw), cy = Math.cos(inp.yaw);
    inp.mx = clamp(this.moveX * cy - this.moveZ * sy, -1, 1); // sağ bileşen
    inp.mz = clamp(-this.moveX * sy - this.moveZ * cy, -1, 1); // ileri bileşen

    let b = 0;
    if (this.wantJump) { b |= BTN.JUMP; this.wantJump = false; }
    if (this.wantPull) b |= BTN.PULL;
    if (this.wantHook) { b |= BTN.HOOK; this.wantHook = false; }
    if (this.wantDrop) { b |= BTN.PULL_PRESS; this.wantDrop = false; }
    const aligned = Math.abs(dy) < 0.07 && Math.abs(dp) < 0.08;
    if (p.holding >= 0) this.holdTime += dt; else this.holdTime = 0;
    if (this.wantThrow && aligned && this.holdTime > this.cfg.throwDelay) { b |= BTN.THROW; this.wantThrow = false; }
    if (this.wantWave && aligned) { b |= BTN.THROW; this.wantWave = false; }
    inp.buttons = b;
    inp.jump = (b & BTN.JUMP) !== 0;
  }

  /** Hedef noktaya bakmak için gereken yaw/pitch (kamera omuz üstünde olduğu için 2 tur düzeltme). */
  aimAt(p, tx, ty, tz) {
    this.tx = tx; this.ty = ty; this.tz = tz; this.hasAim = true;
    this._solveAim(p);
  }

  _solveAim(p) {
    const tx = this.tx, ty = this.ty, tz = this.tz;
    let yaw = p.input.yaw, pitch = p.input.pitch;
    for (let i = 0; i < 3; i++) {
      cameraFromPlayer(p.x, p.y, p.z, yaw, pitch, _cam);
      const dx = tx - _cam.x, dy = ty - _cam.y, dz = tz - _cam.z;
      yaw = Math.atan2(-dx, -dz);
      pitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
    }
    this.aimYaw = yaw;
    this.aimPitch = clamp(pitch, -1.1, 0.95);
  }

  decide(sim, p) {
    const cfg = this.cfg;
    this.errYaw = (Math.random() - 0.5) * 2 * cfg.aimError;
    this.errPitch = (Math.random() - 0.5) * cfg.aimError;
    if (sim.phase !== PHASE.PLAYING && sim.phase !== PHASE.ENDED) { this.moveX = 0; this.moveZ = 0; return; }
    const layout = sim.layout;
    const shrink = sim.shrink;
    const radius = arenaRadius(shrink);
    const distC = Math.sqrt(p.x * p.x + p.z * p.z);
    const toCx = -p.x / (distC || 1), toCz = -p.z / (distC || 1);
    const onGround = isOnArena(layout, p.x, p.z, shrink);

    // ---- 1) Acil durum: arenanın dışına savrulduk!
    if (!onGround && p.y < 0.5) {
      this.moveX = toCx; this.moveZ = toCz;
      this.wantPull = false;
      if (p.hookCd <= 0 && !p.motor.hookOn && Math.random() < cfg.hookChance) {
        const anchor = this.findAnchor(sim, p);
        if (anchor) { this.aimAt(p, anchor.x, anchor.y, anchor.z); this.errYaw = 0; this.errPitch = 0; this.wantHook = true; }
      }
      return;
    }
    // Uyarı veren (düşmek üzere) halkadan merkeze kaç
    const myTile = Math.round(Math.sqrt((p.x / 4) ** 2 + (p.z / 4) ** 2));
    const danger = sim.warnRing >= 0 && myTile >= sim.warnRing - 0.5;

    // ---- 2) En yakın rakip
    let enemy = null, ed = 1e9;
    for (const q of sim.players) {
      if (!q || q === p || !q.alive || !q.inRound) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < ed) { ed = d; enemy = q; }
    }

    // ---- 3) Kaçınma: bize doğru uçan eşya var mı?
    if (cfg.dodge > 0) {
      for (const it of sim.items) {
        if (it.state !== ITEM_STATE.THROWN || it.thrower === p.slot) continue;
        const rx = p.x - it.x, rz = p.z - it.z;
        const d = Math.hypot(rx, rz);
        if (d > 14) continue;
        const sp = Math.hypot(it.lvx, it.lvz) || 1;
        const approach = (rx * it.lvx + rz * it.lvz) / (d * sp);
        if (approach > 0.92 && Math.random() < cfg.dodge) {
          // yana kaç + zıpla
          const sx = -it.lvz / sp, sz = it.lvx / sp;
          const side = isOnArena(layout, p.x + sx * 3, p.z + sz * 3, shrink) ? 1 : -1;
          this.moveX = sx * side; this.moveZ = sz * side;
          this.wantJump = true;
          return;
        }
      }
    }

    let mx = 0, mz = 0;
    if (p.holding >= 0) {
      // ---- 4) Elimizde eşya var: rakibe fırlat
      this.wantPull = false;
      if (enemy) {
        const it = sim.items[p.holding];
        const flight = ed / it.k.throwSpeed;
        const lead = cfg.lead * flight;
        this.aimAt(p, enemy.x + enemy.vx * lead, enemy.y + 0.2, enemy.z + enemy.vz * lead);
        if (ed < 19) this.wantThrow = true;
        // İdeal mesafe: 8-15 m
        const k = ed > 12 ? 1 : ed < 6 ? -0.7 : 0;
        mx = ((enemy.x - p.x) / ed) * k; mz = ((enemy.z - p.z) / ed) * k;
        // biraz yanlamasına gezin (hedef olmamak için)
        mx += -((enemy.z - p.z) / ed) * 0.4 * Math.sin(sim.time + p.slot);
        mz += ((enemy.x - p.x) / ed) * 0.4 * Math.sin(sim.time + p.slot);
      }
    } else {
      // ---- 5) Eşya yok: yakındaki rakibi it ya da eşya çek
      if (enemy && ed < WAVE_RANGE * 0.8 && p.pushCd <= 0 && Math.random() < cfg.waveChance) {
        this.aimAt(p, enemy.x, enemy.y, enemy.z);
        this.wantWave = true;
        this.wantPull = false;
        mx = (enemy.x - p.x) / ed; mz = (enemy.z - p.z) / ed;
      } else {
        let best = null, bd = 1e9;
        for (const it of sim.items) {
          if (it.state === ITEM_STATE.GONE || it.holder === p.slot) continue;
          if (it.holder >= 0 && this.level === 'kolay') continue;
          if (!isOnArena(layout, it.x, it.z, shrink) && it.state !== ITEM_STATE.THROWN) continue;
          let d = Math.hypot(it.x - p.x, it.z - p.z);
          if (it.holder >= 0) d += 8; // başkasınınkini kapmak daha zor
          if (d < bd) { bd = d; best = it; }
        }
        if (best) {
          this.aimAt(p, best.x, best.y, best.z);
          this.wantPull = bd < PULL_RANGE * 0.85;
          if (bd > 14) { mx = (best.x - p.x) / bd; mz = (best.z - p.z) / bd; }
        } else if (enemy) {
          mx = (enemy.x - p.x) / ed; mz = (enemy.z - p.z) / ed;
        }
      }
    }

    // ---- 6) Kenardan uzak dur
    const ahead = 3.2;
    if (danger || distC > radius - 3.5) { mx = mx * 0.3 + toCx; mz = mz * 0.3 + toCz; }
    const ml = Math.hypot(mx, mz);
    if (ml > 0.05) {
      mx /= ml; mz /= ml;
      if (!isOnArena(layout, p.x + mx * ahead, p.z + mz * ahead, shrink)) {
        mx = toCx; mz = toCz; // önümüz boşluk: merkeze dön
      }
    }
    this.moveX = mx; this.moveZ = mz;

    // Takıldıysa zıpla (engel önünde)
    const sp = Math.hypot(p.vx, p.vz);
    if (ml > 0.3 && sp < 1.2) this.stuckT += 1 / BOT_DECISION_HZ; else this.stuckT = 0;
    if (this.stuckT > 0.4) { this.wantJump = true; this.stuckT = 0; }
  }

  /** Kanca atılabilecek en iyi metal nokta (arenaya doğru olanı tercih et). */
  findAnchor(sim, p) {
    let best = null, bs = 1e9;
    for (const o of sim.layout.obstacles) {
      if (!o.metal || !ringAlive(o.ring, sim.shrink)) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y, o.z - p.z);
      if (d > HOOK_RANGE) continue;
      const score = d + Math.hypot(o.x, o.z) * 0.6; // merkeze yakın olan iyi
      if (score < bs) { bs = score; best = o; }
    }
    return best;
  }
}
