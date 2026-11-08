// ============================================================================
// SES — Hiç ses dosyası yok! Bütün efektler Web Audio API ile anında
// sentezlenir (osilatör + gürültü). Böylece indirme boyutu sıfır.
// ============================================================================
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('ms_mute') === '1';
    this.master = null;
    this.noiseBuf = null;
    this.hum = null;
  }

  /** Tarayıcılar sesi ancak bir kullanıcı tıklamasından sonra başlatmaya izin verir. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    const comp = this.ctx.createDynamicsCompressor(); // ani patlamalar kulak tırmalamasın
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('ms_mute', this.muted ? '1' : '0');
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  _tone(type, f0, f1, dur, vol, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _noise(dur, vol, filterType, f0, f1, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf;
    f.type = filterType; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  /** vol: 0..1 (uzaklığa göre çağıran ayarlar) */
  play(name, vol = 1, power = 1) {
    if (!this.ctx || this.muted || vol < 0.03) return;
    switch (name) {
      case 'throw': this._noise(0.28, 0.5 * vol, 'bandpass', 600, 2800); this._tone('sine', 300, 900, 0.18, 0.12 * vol); break;
      case 'hit': {
        const p = Math.min(1.5, power);
        this._tone('sine', 160, 38, 0.35 + p * 0.15, 0.9 * vol);
        this._noise(0.22, 0.7 * vol * p, 'lowpass', 2400, 200);
        this._tone('square', 90, 50, 0.12, 0.15 * vol);
        break;
      }
      case 'block': this._tone('triangle', 900, 500, 0.15, 0.4 * vol); this._noise(0.12, 0.4 * vol, 'highpass', 3000, 1500); break;
      case 'bump': this._tone('sine', 120, 50, 0.2, 0.35 * vol * Math.min(1, power)); this._noise(0.15, 0.25 * vol, 'lowpass', 900, 150); break;
      case 'wave': this._tone('sine', 110, 40, 0.5, 0.8 * vol); this._noise(0.45, 0.6 * vol, 'bandpass', 300, 1800); break;
      case 'hook': this._tone('sawtooth', 220, 1300, 0.22, 0.18 * vol); this._tone('square', 1400, 1400, 0.05, 0.12 * vol, 0.2); break;
      case 'catch': this._tone('sine', 520, 880, 0.12, 0.3 * vol); this._tone('sine', 880, 1320, 0.1, 0.18 * vol, 0.06); break;
      case 'steal': this._tone('square', 700, 300, 0.18, 0.18 * vol); this._tone('square', 300, 900, 0.18, 0.18 * vol, 0.12); break;
      case 'fall': this._tone('sine', 1100, 160, 1.3, 0.35 * vol); break; // çizgi film düşme ıslığı
      case 'ring': this._noise(1.6, 0.9 * vol, 'lowpass', 500, 60); this._tone('sine', 70, 30, 1.6, 0.8 * vol); break;
      case 'beep': this._tone('square', 660, 660, 0.12, 0.2 * vol); break;
      case 'go': this._tone('square', 990, 990, 0.35, 0.22 * vol); this._tone('square', 1320, 1320, 0.3, 0.12 * vol, 0.05); break;
      case 'win': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this._tone('square', f, f, 0.16, 0.18 * vol, i * 0.12)); break;
      case 'lose': [440, 392, 349, 262].forEach((f, i) => this._tone('triangle', f, f * 0.98, 0.3, 0.25 * vol, i * 0.22)); break;
      case 'click': this._tone('sine', 1200, 900, 0.05, 0.15 * vol); break;
      case 'jump': this._tone('sine', 260, 520, 0.12, 0.12 * vol); break;
      case 'deny': this._tone('square', 180, 140, 0.12, 0.12 * vol); break;
      default: break;
    }
  }

  /** Mıknatıs çekerken sürekli uğultu. on=false olunca kısılır. */
  setHum(on, strength = 1) {
    if (!this.ctx) return;
    if (!this.hum) {
      const o = this.ctx.createOscillator(), o2 = this.ctx.createOscillator(), g = this.ctx.createGain(), lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = 72;
      o2.type = 'sine'; o2.frequency.value = 145;
      lfo.frequency.value = 9; lg.gain.value = 9;
      lfo.connect(lg); lg.connect(o.frequency);
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
      o.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
      g.gain.value = 0;
      o.start(); o2.start(); lfo.start();
      this.hum = { g, o };
    }
    const target = on && !this.muted ? 0.13 * strength : 0;
    this.hum.g.gain.setTargetAtTime(target, this.ctx.currentTime, 0.06);
    this.hum.o.frequency.setTargetAtTime(on ? 72 + 30 * strength : 60, this.ctx.currentTime, 0.1);
  }
}
