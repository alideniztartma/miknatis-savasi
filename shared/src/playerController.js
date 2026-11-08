// ============================================================================
// OYUNCU HAREKETİ
// Bu fonksiyon hem sunucuda (gerçek sonuç) hem istemcide (tahmin / client-side
// prediction) çalışır. İkisi AYNI kodu çalıştırdığı için tahmin neredeyse her
// zaman doğru çıkar; küçük farkları istemci yumuşakça düzeltir.
//
// Oyuncu, dönmesi kilitli dinamik bir kapsüldür. Hareketi "hedef hıza doğru
// yaklaştırarak" yaparız. Sersemlemişken (stun) kontrol çok zayıflar, böylece
// bir darbe seni gerçekten savurur.
// ============================================================================
import {
  MOVE_SPEED, GROUND_ACCEL, AIR_ACCEL, STUN_ACCEL, JUMP_SPEED, JUMP_COOLDOWN,
  PLAYER_CENTER_Y, HOOK_SPEED,
} from './constants.js';

/** Hareket durumunu tutan küçük nesne (her oyuncu için bir tane, tekrar kullanılır). */
export function createMotor() {
  return {
    stun: 0, // kalan sersemlik süresi (s)
    hookOn: false, hx: 0, hy: 0, hz: 0, hookT: 0, // kanca
    jumpCd: 0,
    slow: 0, // ağır eşya taşırken yavaşlama oranı (0..0.35)
    grounded: false,
    frozen: false, // geri sayımda hareket yok
  };
}

export function copyMotor(dst, src) {
  dst.stun = src.stun; dst.hookOn = src.hookOn; dst.hx = src.hx; dst.hy = src.hy; dst.hz = src.hz;
  dst.hookT = src.hookT; dst.jumpCd = src.jumpCd; dst.slow = src.slow; dst.grounded = src.grounded; dst.frozen = src.frozen;
}

// Önceden ayrılmış geçici nesneler (çöp oluşturmamak için)
const _vel = { x: 0, y: 0, z: 0 };
let _ray = null;

/** Ayağın altında zemin var mı? Kısa bir aşağı ışın atarız. */
export function checkGrounded(RAPIER, world, body, pos) {
  if (!_ray) _ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const footY = pos.y - PLAYER_CENTER_Y;
  // Ortadan ve kapsülün 4 kenarından ışın: kenarda dururken de "yerde" sayılalım
  for (let k = 0; k < 5; k++) {
    const ox = k === 1 ? 0.3 : k === 2 ? -0.3 : 0;
    const oz = k === 3 ? 0.3 : k === 4 ? -0.3 : 0;
    _ray.origin.x = pos.x + ox; _ray.origin.y = footY + 0.15; _ray.origin.z = pos.z + oz;
    const hit = world.castRay(_ray, 0.3, true, undefined, undefined, undefined, body);
    if (hit) return true;
  }
  return false;
}

/**
 * Bir tick'lik hareket uygular.
 * input: { mx, mz (-1..1), yaw, jump }
 * Dönüş: yok. Gövdenin hızını ayarlar; konumu fizik adımı değiştirir.
 */
export function applyMovement(RAPIER, world, body, motor, input, dt) {
  const pos = body.translation();
  const lv = body.linvel();
  let vx = lv.x, vy = lv.y, vz = lv.z;

  motor.grounded = checkGrounded(RAPIER, world, body, pos);
  if (motor.jumpCd > 0) motor.jumpCd -= dt;
  if (motor.stun > 0) motor.stun -= dt;

  // --- Kanca: oyuncuyu bağlanma noktasına doğru çeker
  if (motor.hookOn) {
    motor.hookT -= dt;
    const dx = motor.hx - pos.x, dy = motor.hy - pos.y, dz = motor.hz - pos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1.8 || motor.hookT <= 0) {
      motor.hookOn = false; // vardık ya da süre bitti: momentum korunur
    } else {
      const k = Math.min(1, 10 * dt);
      vx += ((dx / d) * HOOK_SPEED - vx) * k;
      vy += ((dy / d) * HOOK_SPEED + 2 - vy) * k;
      vz += ((dz / d) * HOOK_SPEED - vz) * k;
      _vel.x = vx; _vel.y = vy; _vel.z = vz;
      body.setLinvel(_vel, true);
      return;
    }
  }

  if (motor.frozen) {
    _vel.x = 0; _vel.y = vy; _vel.z = 0;
    body.setLinvel(_vel, true);
    return;
  }

  // --- Yürüme: girdiyi bakış yönüne göre dünyaya çevir
  const sy = Math.sin(input.yaw), cy = Math.cos(input.yaw);
  let wx = cy * input.mx - sy * input.mz; // sağ * mx + ileri * mz
  let wz = -sy * input.mx - cy * input.mz;
  const wl = Math.sqrt(wx * wx + wz * wz);
  if (wl > 1) { wx /= wl; wz /= wl; }
  const speed = MOVE_SPEED * (1 - motor.slow);

  let accel;
  if (motor.stun > 0) accel = STUN_ACCEL;
  else if (motor.grounded) accel = GROUND_ACCEL;
  else accel = wl > 0.1 ? AIR_ACCEL : 0.6; // havada tuşa basmıyorsan momentum korunur
  const k = 1 - Math.exp(-accel * dt); // kare hızından bağımsız yumuşak yaklaşım
  vx += (wx * speed - vx) * k;
  vz += (wz * speed - vz) * k;

  // --- Zıplama
  if (input.jump && motor.grounded && motor.jumpCd <= 0 && motor.stun <= 0) {
    vy = JUMP_SPEED;
    motor.jumpCd = JUMP_COOLDOWN;
    motor.grounded = false;
  }
  _vel.x = vx; _vel.y = vy; _vel.z = vz;
  body.setLinvel(_vel, true);
}
