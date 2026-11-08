// ============================================================================
// GİRDİ — Klavye, fare ve pointer lock.
// Tek seferlik tuşlar (sağ tık, E, sol tık basışı) bir sonraki tick'e kadar
// "mandallanır" (latch). Böylece iki tick arasında yapılan çok kısa bir tık
// bile kaybolmaz.
// ============================================================================
import { BTN, PITCH_MIN, PITCH_MAX } from '@miknatis/shared';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = -0.15;
    this.sensitivity = 0.0023;
    this.lmb = false;
    this.rmb = false;
    this.latch = 0; // bekleyen tek seferlik butonlar
    this.locked = false;
    this.enabled = false; // oyun ekranında mıyız
    this.onKey = null; // (code) => void, özel tuşlar için (F3, M, Tab, R)
    this.onClick = null; // izleyici modunda tık
    this.onLockChange = null;

    document.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (['Space', 'Tab', 'F3', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code) && this.enabled) {
        if (e.code === 'KeyE') this.latch |= BTN.HOOK;
      }
      this.keys.add(e.code);
      if (this.onKey && !e.repeat) this.onKey(e.code, true);
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (this.onKey) this.onKey(e.code, false);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.lmb = false; this.rmb = false; });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    document.addEventListener('mousedown', (e) => {
      if (!this.enabled || !this.locked) return;
      if (e.button === 0) { this.lmb = true; this.latch |= BTN.PULL_PRESS; if (this.onClick) this.onClick(); }
      if (e.button === 2) { this.rmb = true; this.latch |= BTN.THROW; }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Bazı tarayıcılar kilitlenince ilk olayda dev bir sıçrama gönderir: yok say
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      if (this.pitch < PITCH_MIN) this.pitch = PITCH_MIN;
      if (this.pitch > PITCH_MAX) this.pitch = PITCH_MAX;
      if (this.yaw > Math.PI) this.yaw -= Math.PI * 2; else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.lmb = false; this.rmb = false; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  requestLock() {
    if (this.locked) return;
    try {
      const r = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (r && r.catch) r.catch(() => { try { this.canvas.requestPointerLock(); } catch (e) { /* yok say */ } });
    } catch (e) {
      try { this.canvas.requestPointerLock(); } catch (e2) { /* yok say */ }
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /**
   * O anki girdiyi out nesnesine yazar ve mandallı tuşları temizler.
   * Tick hızında (sunucuda 20 Hz) çağrılır.
   */
  sample(out) {
    const k = this.keys;
    const active = this.enabled && this.locked;
    let mx = 0, mz = 0;
    if (active) {
      if (k.has('KeyW') || k.has('ArrowUp')) mz += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) mz -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    }
    out.mx = mx; out.mz = mz;
    out.yaw = this.yaw; out.pitch = this.pitch;
    let b = active ? this.latch : 0;
    if (active && k.has('Space')) b |= BTN.JUMP;
    if (active && this.lmb) b |= BTN.PULL;
    out.buttons = b;
    out.jump = (b & BTN.JUMP) !== 0;
    this.latch = 0;
    return out;
  }
}
