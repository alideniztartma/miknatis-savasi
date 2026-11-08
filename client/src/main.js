// ============================================================================
// GİRİŞ NOKTASI — Menüler ve ekranlar arası akış.
//   Ana menü -> (Tek Oyna) -> oyun
//   Ana menü -> (Oda Kur / Odaya Katıl) -> "Sunucu başlatılıyor..." -> lobi -> oyun
//   Oyun -> tur sonu -> tekrar / lobi / ana menü
// ============================================================================
import './style.css';
import { PHASE, PLAYER_COLORS } from '@miknatis/shared';
import { Renderer } from './render/Renderer.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Hud, esc, hex } from './hud.js';
import { Game } from './game/Game.js';
import { LocalSession } from './game/LocalSession.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- Rapier'i ARKA PLANDA yükle
// Menü açılır açılmaz fizik motorunun WebAssembly dosyası iner ve hazırlanır,
// oyuncu "Tek Oyna"ya bastığında beklemez.
let RAPIER = null;
const rapierReady = import('@dimforge/rapier3d-compat').then(async (m) => {
  const R = m.default || m;
  const w = console.warn; console.warn = () => {}; // zararsız "deprecated" uyarısını gizle
  await R.init();
  console.warn = w;
  RAPIER = R;
  return R;
});
// Çok oyunculu modülleri de boşta önceden indir (ilk tıklamada hızlı olsun)
const netModules = () => Promise.all([import('./net.js'), import('./game/NetSession.js')]);
setTimeout(() => netModules().catch(() => {}), 1500);

// ---------------------------------------------------------------- Temel parçalar
const renderer = new Renderer($('game'));
const input = new Input(renderer.canvas);
const audio = new Audio();
const hud = new Hud();
const game = new Game(renderer, input, audio, hud);

const screens = ['menu', 'connecting', 'lobby', 'end'];
function show(id) { for (const s of screens) $(s).classList.toggle('hidden', s !== id); }

let toastTimer = 0;
function toast(msg, ok = false, ms = 3500) {
  const t = $('toast');
  t.textContent = msg;
  t.className = ok ? 'ok' : '';
  clearTimeout(toastTimer);
  if (ms > 0) toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}
function hideToast() { $('toast').classList.add('hidden'); }

// ---------------------------------------------------------------- Menü
const params = new URLSearchParams(location.search);
$('nameInput').value = localStorage.getItem('ms_name') || '';
$('diffSelect').value = localStorage.getItem('ms_diff') || 'orta';
const inviteCode = (params.get('oda') || '').toUpperCase().slice(0, 6);
if (inviteCode) {
  $('codeInput').value = inviteCode;
  $('loadStatus').textContent = `🎉 ${inviteCode} odasına davet edildin! Adını yaz ve "Odaya Katıl"a bas.`;
  $('btnJoin').classList.add('green');
}

function playerName() {
  const n = $('nameInput').value.replace(/[<>]/g, '').trim().slice(0, 16) || 'Oyuncu' + Math.floor(Math.random() * 90 + 10);
  localStorage.setItem('ms_name', n);
  $('nameInput').value = n;
  return n;
}

rapierReady.then((R) => {
  if (!inviteCode) $('loadStatus').textContent = '✅ Hazır! Bir mod seç.';
  if (!game.session) game.setDemo(new LocalSession(R, { demo: true, difficulty: 'orta' }));
}).catch((e) => {
  $('loadStatus').textContent = '❌ Fizik motoru yüklenemedi: ' + e.message;
});

$('btnSolo').onclick = async () => {
  audio.unlock();
  const name = playerName();
  const diff = $('diffSelect').value;
  localStorage.setItem('ms_diff', diff);
  input.requestLock(); // tıklama anında istenmeli (tarayıcı kuralı)
  const R = await rapierReady;
  game.setSession(new LocalSession(R, { name, difficulty: diff }));
  show(null);
};

$('codeInput').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('btnCreate').onclick = () => startMultiplayer('create');
$('btnJoin').onclick = () => {
  const code = $('codeInput').value.trim();
  if (code.length !== 6) { toast('6 haneli oda kodunu yaz.'); $('codeInput').focus(); return; }
  startMultiplayer('join', code);
};
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') (inviteCode ? $('btnJoin') : $('btnSolo')).click(); });
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });

// ---------------------------------------------------------------- Çok oyunculu bağlantı
let connectToken = null;
let lobbyTimer = 0;

async function startMultiplayer(mode, code = '') {
  audio.unlock();
  const name = playerName();
  const token = { cancelled: false };
  connectToken = token;
  show('connecting');
  $('connTitle').textContent = 'Sunucuya bağlanılıyor...';
  $('connText').textContent = '';
  try {
    const [net, { NetSession }] = await netModules();
    const R = await rapierReady;
    await net.wakeServer((sec) => {
      if (sec > 3) {
        $('connTitle').textContent = 'Sunucu başlatılıyor... ☕';
        $('connText').textContent = `Ücretsiz sunucu uykudan uyanıyor, bu yaklaşık 1 dakika sürebilir. Otomatik tekrar deniyorum... (${Math.floor(sec)} sn)`;
      }
    }, token);
    if (token.cancelled) return;
    $('connTitle').textContent = mode === 'create' ? 'Oda kuruluyor...' : 'Odaya katılınıyor...';
    const { client, room } = await net.connectRoom(mode, name, code);
    if (token.cancelled) { room.leave(true); return; }
    const session = new NetSession(R, client, room, { onStatus: onNetStatus });
    game.setSession(session);
    const url = new URL(location.href);
    url.searchParams.set('oda', room.roomId);
    history.replaceState(null, '', url);
    enterLobby();
  } catch (e) {
    if (token.cancelled) return;
    const net = await import('./net.js');
    if (e instanceof net.Cancelled) return;
    console.error(e);
    show('menu');
    toast(net.errorText(e), false, 5000);
  }
}

$('btnConnCancel').onclick = () => { if (connectToken) connectToken.cancelled = true; show('menu'); };

function onNetStatus(status) {
  if (status === 'reconnecting') toast('📡 Bağlantı koptu, yeniden bağlanılıyor...', false, 0);
  if (status === 'ok') toast('✅ Yeniden bağlandın!', true);
  if (status === 'lost') { leaveToMenu(); toast('Sunucu bağlantısı koptu.', false, 5000); }
}

// ---------------------------------------------------------------- Lobi
function enterLobby() {
  show('lobby');
  clearInterval(lobbyTimer);
  lobbyTimer = setInterval(renderLobby, 200);
  renderLobby();
}

let lastLobbyHtml = '';
function renderLobby() {
  const s = game.session;
  if (!s || s.kind !== 'net') { clearInterval(lobbyTimer); return; }
  const v = s.view;
  if (v.phase !== PHASE.LOBBY) return;
  $('lobbyCode').textContent = v.code;
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('oda', v.code);
  const sp = params.get('sunucu');
  if (sp) url.searchParams.set('sunucu', sp);
  if ($('inviteLink').value !== url.href) $('inviteLink').value = url.href;
  const ps = v.players.filter((p) => p.exists);
  const humans = ps.filter((p) => !p.bot).length;
  $('lobbyCount').textContent = `(${humans} oyuncu + ${ps.length - humans} bot)`;
  const html = ps.map((p) => `<li class="${p.isLocal ? 'me' : ''}"><span class="swatch" style="color:${hex(PLAYER_COLORS[p.color])};background:${hex(PLAYER_COLORS[p.color])}"></span>${p.bot ? '🤖 ' : ''}${esc(p.name)}<span class="tag">${p.sid && p.sid === v.hostSid ? '👑 kurucu' : p.bot ? 'bot' : p.afk ? 'bağlantı koptu' : ''}${p.isLocal ? ' (sen)' : ''}</span></li>`).join('');
  if (html !== lastLobbyHtml) { $('lobbyPlayers').innerHTML = html; lastLobbyHtml = html; }
  $('hostControls').classList.toggle('hidden', !v.isHost);
  $('lobbyWait').classList.toggle('hidden', v.isHost);
  if (document.activeElement !== $('lobbyDiff')) $('lobbyDiff').value = v.diff;
  if (document.activeElement !== $('lobbyFill')) $('lobbyFill').value = String(v.fill <= 2 ? 2 : v.fill <= 4 ? 4 : v.fill <= 6 ? 6 : 8);
}

$('btnCopy').onclick = async () => {
  const link = $('inviteLink').value;
  try { await navigator.clipboard.writeText(link); } catch (e) { $('inviteLink').select(); document.execCommand('copy'); }
  toast('🔗 Davet linki kopyalandı! Arkadaşlarına gönder.', true);
};
const sendCfg = () => game.session && game.session.setConfig && game.session.setConfig($('lobbyDiff').value, Number($('lobbyFill').value));
$('lobbyDiff').onchange = sendCfg;
$('lobbyFill').onchange = sendCfg;
$('btnStart').onclick = () => { audio.unlock(); input.requestLock(); game.session.start(); };
$('btnLeave').onclick = () => leaveToMenu();

// ---------------------------------------------------------------- Oyun olayları
game.callbacks.onPlaying = () => {
  clearInterval(lobbyTimer);
  show(null);
};
game.callbacks.onLobby = () => enterLobby();
game.callbacks.onEnded = (v) => showEnd(v);

function showEnd(v) {
  const s = game.session;
  if (!s) return;
  const local = v.localSlot >= 0 ? v.players[v.localSlot] : null;
  const w = v.winner >= 0 ? v.players[v.winner] : null;
  $('endTitle').textContent = !w ? 'BERABERE!' : local && w.slot === local.slot ? 'KAZANDIN! 🎉' : `KAZANAN: ${w.name}`;
  $('endTrophy').textContent = !w ? '🤝' : local && w.slot === local.slot ? '🏆' : '🧲';
  const rows = v.players.filter((p) => p.exists && p.inRound).sort((a, b) => (a.place || 1) - (b.place || 1));
  $('endTable').innerHTML = '<tr><th>Sıra</th><th>Oyuncu</th><th>Düşürme</th><th>İsabet</th><th>Galibiyet</th></tr>'
    + rows.map((p) => `<tr class="${p.isLocal ? 'me' : ''} ${(p.place || 1) === 1 ? 'first' : ''}"><td>${(p.place || 1) === 1 ? '🥇' : (p.place === 2 ? '🥈' : p.place === 3 ? '🥉' : p.place + '.')}</td><td><span class="dotc" style="background:${hex(PLAYER_COLORS[p.color])}"></span>${p.bot ? '🤖 ' : ''}${esc(p.name)}</td><td>${p.kills}</td><td>${p.hits}</td><td>${p.wins}</td></tr>`).join('');
  const host = s.kind === 'local' || v.isHost;
  $('btnAgain').classList.toggle('hidden', !host);
  $('btnToLobby').classList.toggle('hidden', !(s.kind === 'net' && v.isHost));
  $('endWait').classList.toggle('hidden', host);
  show('end');
}

$('btnAgain').onclick = () => { audio.unlock(); input.requestLock(); game.session.again(); show(null); };
$('btnToLobby').onclick = () => { game.session.toLobby(); };
$('btnToMenu').onclick = () => leaveToMenu();
$('clickToPlay').onclick = () => { audio.unlock(); input.requestLock(); };
$('btnQuit').onclick = (e) => { e.stopPropagation(); leaveToMenu(); };

function leaveToMenu() {
  clearInterval(lobbyTimer);
  input.exitLock();
  game.setSession(null);
  hideToast();
  show('menu');
  const url = new URL(location.href);
  url.searchParams.delete('oda');
  history.replaceState(null, '', url);
  if (RAPIER) game.setDemo(new LocalSession(RAPIER, { demo: true, difficulty: 'orta' }));
}

show('menu');
// Hata ayıklama için konsoldan erişim
window.__ms = { game, renderer };
