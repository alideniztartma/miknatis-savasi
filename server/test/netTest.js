// Ağ testi: sunucuya bağlanan sahte istemciler. Bant genişliğini ölçer.
// Önce sunucuyu başlat (npm run dev:server), sonra: node server/test/netTest.js
import { Client } from 'colyseus.js';

const url = process.env.URL || 'ws://localhost:2567';
const c = new Client(url);
const room = await c.create('oyun', { name: 'Testçi' });
console.log('oda kodu:', room.roomId, 'session', room.sessionId);
let bytes = 0;
room.connection.transport.ws.addEventListener('message', (e) => { bytes += e.data.byteLength || e.data.length || 0; });
let events = 0;
room.onMessage('e', (m) => { events += m.length / 8; });
room.onMessage('srv', (m) => console.log('sunucu tick ms:', m[0], 'oda:', m[1]));
room.onMessage('p', () => {});
await new Promise((r) => setTimeout(r, 500));
console.log('oyuncular:', [...room.state.players.values()].map((p) => p.name + (p.bot ? '(bot)' : '')).join(', '));
// İkinci oyuncu katılsın (link ile)
const c2 = new Client(url);
const room2 = await c2.joinById(room.roomId, { name: 'Ayşe' });
for (const t of ['e', 'srv', 'p']) room2.onMessage(t, () => {});
await new Promise((r) => setTimeout(r, 300));
console.log('ikinci katıldı, oyuncular:', room.state.players.size);
room.send('cfg', { diff: 'zor', fill: 8 });
await new Promise((r) => setTimeout(r, 300));
room.send('start');
let seq = 0;
const iv = setInterval(() => {
  seq++;
  room.send('i', [seq, 0, 100, 0, 0, seq % 20 < 10 ? 2 : 4]);
}, 50);
for (let s = 0; s < Number(process.env.SECS || 10); s++) {
  bytes = 0;
  await new Promise((r) => setTimeout(r, 1000));
  const me = [...room.state.players.values()].find((p) => p.sid === room.sessionId);
  console.log(`t=${s + 1}s faz=${room.state.phase} süre=${room.state.timer} hayatta=${room.state.alive}/${room.state.total} gelen=${(bytes / 1024).toFixed(2)} KB/s ack=${me.ack} konum=(${me.x},${me.y},${me.z}) olay=${events}`);
}
// Oda limiti testi
const extra = [];
for (let i = 0; i < 3; i++) {
  try { extra.push(await new Client(url).create('oyun', { name: 'x' })); console.log('ek oda', i + 2, 'açıldı'); } catch (e) { console.log('ek oda reddedildi:', e.code, e.message); }
}
// Bağlantı kopması: room2'yi zorla kapat
room2.connection.close();
await new Promise((r) => setTimeout(r, 1500));
const p2 = [...room.state.players.values()].find((p) => p.name === 'Ayşe');
console.log('Ayşe koptu -> afk:', p2 && p2.afk);
clearInterval(iv);
for (const r of extra) await r.leave();
await room.leave();
process.exit(0);
