// Tahmin (prediction) doğruluk testi: Node'da sahte bir istemci 60 FPS'te koşar,
// ileri yürür, zıplar, durur. Sonunda tahmin edilen konum ile sunucunun konumu karşılaştırılır.
// Önce sunucuyu başlat: npm run dev:server  ->  sonra: node client/test/predTest.js
import RAPIER from '@dimforge/rapier3d-compat';
import { Client } from 'colyseus.js';
import { NetSession } from '../src/game/NetSession.js';
import { fromCm, PHASE } from '@miknatis/shared';

const w = console.warn; console.warn = () => {}; await RAPIER.init(); console.warn = w;
const client = new Client(process.env.URL || 'ws://localhost:2567');
const room = await client.create('oyun', { name: 'Test' });
const s = new NetSession(RAPIER, client, room, {});
room.send('cfg', { diff: 'kolay', fill: 2 });
await new Promise((r) => setTimeout(r, 300));
room.send('start');
const input = { yaw: 0, pitch: 0, keys: { w: false, jump: false },
  sample(o) { o.mx = 0; o.mz = this.keys.w ? 1 : 0; o.yaw = this.yaw; o.pitch = this.pitch; o.buttons = this.keys.jump ? 1 : 0; o.jump = this.keys.jump; return o; } };
let last = performance.now();
const loop = setInterval(() => { const n = performance.now(); s.update((n - last) / 1000, input); last = n; }, 16);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
while (s.view.phase !== PHASE.PLAYING) await wait(50);
input.yaw = Math.PI; // merkeze doğru değil, rastgele bir yön
input.keys.w = true; await wait(1200);
input.keys.jump = true; await wait(300); input.keys.jump = false;
input.yaw = Math.PI / 2; await wait(800);
input.keys.w = false; await wait(1500);
const me = s.view.players[s.view.localSlot];
const ps = [...room.state.players.values()].find((p) => p.sid === room.sessionId);
const err = Math.hypot(me.x - fromCm(ps.x), me.z - fromCm(ps.z));
console.log(`tahmin: (${me.x.toFixed(2)}, ${me.z.toFixed(2)})  sunucu: (${fromCm(ps.x).toFixed(2)}, ${fromCm(ps.z).toFixed(2)})  fark: ${err.toFixed(3)} m`);
console.log(`belirgin düzeltme sayısı: ${s.predictor.corrections}, bekleyen girdi: ${s.predictor.hCount}, gelen: ${s.kbps.toFixed(2)} KB/s, ping: ${s.rtt.toFixed(0)} ms`);
clearInterval(loop);
s.leave();
setTimeout(() => process.exit(0), 300);
