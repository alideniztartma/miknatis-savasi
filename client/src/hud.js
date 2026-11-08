// ============================================================================
// HUD — Oyun içi arayüz: süre, hayatta kalan sayısı, nişangâh, bekleme
// süreleri, skor akışı, büyük mesajlar, isim etiketleri, skor tablosu.
// DOM'a sadece değer DEĞİŞTİĞİNDE yazarız (her karede yazmak tarayıcıyı yorar).
// ============================================================================
import * as THREE from 'three';
import { PLAYER_COLORS, PHASE, ITEM_KINDS, WAVE_COOLDOWN, HOOK_COOLDOWN, MAX_SLOTS } from '@miknatis/shared';

const $ = (id) => document.getElementById(id);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const ITEM_EMOJI = ['🍉', '🚧', '🪑', '📟', '🛢️', '📦', '🧊'];
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), timer: $('timer'), alive: $('aliveCount'), cross: $('crosshair'), cdWave: $('cdWave'), cdHook: $('cdHook'),
      hold: $('holdInfo'), feed: $('feed'), big: $('bigMsg'), sub: $('subMsg'), spec: $('spectate'), specName: $('specName'),
      spRestart: $('spRestart'), score: $('scoreboard'), tags: $('tags'), debug: $('debug'), click: $('clickToPlay'),
    };
    // Bu öğelerin görünürlüğünü style.display ile yönetiyoruz
    for (const k of ['hold', 'spec', 'score', 'debug', 'click']) { this.el[k].classList.remove('hidden'); this.el[k].style.display = 'none'; }
    this.cache = {};
    this.tags = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const d = document.createElement('div');
      d.className = 'tag3d';
      d.style.display = 'none';
      this.el.tags.appendChild(d);
      this.tags.push({ el: d, text: '', shown: false, color: '' });
    }
    this._v = new THREE.Vector3();
  }

  _set(key, el, prop, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    if (prop === 'text') el.textContent = value;
    else if (prop === 'html') el.innerHTML = value;
    else if (prop === 'class') el.className = value;
    else if (prop === 'display') el.style.display = value;
    else el.style.setProperty(prop, value);
  }

  show(on) { this.el.hud.classList.toggle('hidden', !on); if (!on) this.hideTags(); }

  update(view, local, crossState, dt) {
    const e = this.el;
    // Süre
    let t = '';
    let cls = 'pill';
    if (view.phase === PHASE.COUNTDOWN) t = 'HAZIR';
    else if (view.phase === PHASE.PLAYING) {
      if (view.timer > 0) { const s = Math.ceil(view.timer); t = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; if (s <= 10) cls = 'pill overtime'; } else { t = '⚠ UZATMA'; cls = 'pill overtime'; }
    } else if (view.phase === PHASE.ENDED) t = 'BİTTİ';
    this._set('timer', e.timer, 'text', t);
    this._set('timerc', e.timer, 'class', cls);
    this._set('alive', e.alive, 'text', `👥 ${view.alive}/${view.total}`);

    // Nişangâh
    this._set('cross', e.cross, 'class', crossState);
    const show = local && local.alive && local.inRound;
    this._set('crossd', e.cross, 'display', show ? 'block' : 'none');
    this._set('cdd', $('cooldowns'), 'display', show ? 'flex' : 'none');
    if (show) {
      const pw = Math.max(0, local.pushCd) / WAVE_COOLDOWN, ph = Math.max(0, local.hookCd) / HOOK_COOLDOWN;
      this._set('cdw', e.cdWave, '--p', (Math.round(pw * 20) / 20).toString());
      this._set('cdh', e.cdHook, '--p', (Math.round(ph * 20) / 20).toString());
      this._set('cdwc', e.cdWave, 'class', pw <= 0 && local.hold < 0 ? 'cd ready' : 'cd');
      this._set('cdhc', e.cdHook, 'class', ph <= 0 ? 'cd ready' : 'cd');
      if (local.hold >= 0) {
        const it = view.items[local.hold];
        const k = ITEM_KINDS[it.kind];
        this._set('hold', e.hold, 'text', `${ITEM_EMOJI[it.kind]} ${k.name.toUpperCase()} — Sağ tık: FIRLAT · Sol tık: bırak`);
        this._set('holdd', e.hold, 'display', 'block');
      } else this._set('holdd', e.hold, 'display', 'none');
    } else this._set('holdd', e.hold, 'display', 'none');
  }

  hitMarker() {
    const c = this.el.cross;
    c.classList.remove('hit');
    void c.offsetWidth; // animasyonu yeniden başlat
    c.classList.add('hit');
    this.cache.cross = null;
  }

  big(text, sub = '') {
    const b = this.el.big, s = this.el.sub;
    b.textContent = text;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    if (sub) { s.textContent = sub; s.classList.remove('show'); void s.offsetWidth; s.classList.add('show'); }
  }

  subOnly(text) {
    const s = this.el.sub;
    s.textContent = text;
    s.classList.remove('show'); void s.offsetWidth; s.classList.add('show');
  }

  feed(html, mine) {
    const d = document.createElement('div');
    d.className = 'feed-item' + (mine ? ' mine' : '');
    d.innerHTML = html;
    this.el.feed.prepend(d);
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
    setTimeout(() => d.classList.add('fade'), 6000);
    setTimeout(() => d.remove(), 6700);
  }

  clearFeed() { this.el.feed.innerHTML = ''; }

  spectate(name, single) {
    if (name === null) { this._set('spec', this.el.spec, 'display', 'none'); return; }
    this._set('spec', this.el.spec, 'display', 'block');
    this._set('specn', this.el.specName, 'text', name);
    this._set('spr', this.el.spRestart, 'display', single ? 'inline' : 'none');
  }

  clickToPlay(on) { this._set('click', this.el.click, 'display', on ? 'flex' : 'none'); }

  scoreboard(view, on) {
    const el = this.el.score;
    if (!on) { this._set('score', el, 'display', 'none'); return; }
    this._set('score', el, 'display', 'block');
    const rows = view.players.filter((p) => p.exists).sort((a, b) => b.kills - a.kills || b.wins - a.wins);
    const html = '<table><tr><th>Oyuncu</th><th>Durum</th><th>Düşürme</th><th>İsabet</th><th>Galibiyet</th></tr>'
      + rows.map((p) => `<tr class="${p.isLocal ? 'me' : ''}"><td><span class="dotc" style="background:${hex(PLAYER_COLORS[p.color])}"></span>${p.bot ? '🤖 ' : ''}${esc(p.name)}</td><td>${!p.inRound ? 'bekliyor' : p.alive ? '✅' : '💀'}</td><td>${p.kills}</td><td>${p.hits}</td><td>${p.wins}</td></tr>`).join('')
      + '</table>';
    this._set('scoreh', el, 'html', html);
  }

  /** 3B isim etiketleri: kafanın üstündeki noktayı ekrana yansıt. */
  updateTags(view, renderer, camera, anims) {
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const p = view.players[i], tag = this.tags[i], a = anims[i];
      let visible = p.exists && p.inRound && p.alive && !p.isLocal && a.visible;
      if (visible) {
        this._v.copy(a.head);
        const dist = this._v.distanceTo(camera.position);
        this._v.project(camera);
        if (this._v.z > 1 || dist > 70) visible = false;
        else {
          const x = (this._v.x * 0.5 + 0.5) * w, y = (-this._v.y * 0.5 + 0.5) * h;
          tag.el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -100%)`;
          tag.el.style.opacity = dist > 40 ? '0.55' : '1';
          const text = (p.bot ? '🤖 ' : p.afk ? '📵 ' : '') + p.name;
          if (tag.text !== text) { tag.text = text; tag.el.textContent = text; }
          const col = hex(PLAYER_COLORS[p.color]);
          if (tag.color !== col) { tag.color = col; tag.el.style.color = col; }
        }
      }
      if (visible !== tag.shown) { tag.shown = visible; tag.el.style.display = visible ? 'block' : 'none'; }
    }
  }

  hideTags() { for (const t of this.tags) if (t.shown) { t.shown = false; t.el.style.display = 'none'; } }

  debug(text) {
    if (text === null) { this._set('dbg', this.el.debug, 'display', 'none'); return; }
    this._set('dbg', this.el.debug, 'display', 'block');
    this.el.debug.textContent = text;
  }
}

export { hex, ITEM_EMOJI };
