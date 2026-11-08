// Başsız (headless) simülasyon testi: 8 bot dövüşür, tur biter mi, tick ne kadar sürer?
// Çalıştır: npm run test:sim
import RAPIER from '@dimforge/rapier3d-compat';
import { Simulation, PHASE, EV, elimMessage, ITEM_STATE } from '../src/index.js';

const w = console.warn; console.warn = () => {};
await RAPIER.init();
console.warn = w;
const level = process.argv[2] || 'orta';
const sim = new Simulation(RAPIER, { tickHz: 20, difficulty: level });
for (let i = 0; i < 8; i++) sim.addPlayer('b' + i, sim.pickBotName(), true);
sim.startRound();
let ticks = 0, total = 0, max = 0;
const counts = {};
while (sim.phase !== PHASE.ENDED && ticks < 20 * 260) {
  const t0 = performance.now();
  sim.step();
  const dt = performance.now() - t0;
  total += dt; if (dt > max) max = dt; ticks++;
  for (let i = 0; i < sim.eventCount; i++) {
    const e = sim.events[i];
    counts[e.type] = (counts[e.type] || 0) + 1;
    if (e.type === EV.ELIM) {
      const k = e.a >= 0 ? sim.players[e.a].name : null;
      console.log(`[${(sim.time).toFixed(1)}s] ${elimMessage(k, sim.players[e.v].name, e.k)}`);
    }
    if (e.type === EV.RING) console.log(`[${sim.time.toFixed(1)}s] Halka düştü: seviye ${e.k}`);
  }
  for (const p of sim.players) if (p && p.alive && !Number.isFinite(p.x)) throw new Error('NaN!');
}
const moving = sim.items.filter((i) => !i.sleeping && i.state !== ITEM_STATE.GONE).length;
console.log('Bitiş:', sim.phase === PHASE.ENDED ? 'TUR BİTTİ' : 'ZAMAN AŞIMI', 'süre', sim.time.toFixed(1), 's');
console.log('Kazanan:', sim.winner >= 0 ? sim.players[sim.winner].name : 'yok');
console.log('Olay sayıları (1=HIT 2=BLOCK 3=WAVE 4=THROW 5=ELIM 7=HOOK 8=CATCH 9=STEAL):', JSON.stringify(counts));
console.log(`Tick ortalama ${(total / ticks).toFixed(3)} ms, en fazla ${max.toFixed(2)} ms, ${ticks} tick. Hareketli eşya: ${moving}`);
for (const p of sim.players) if (p) console.log(`  ${p.name.padEnd(16)} sıra ${p.place} düşürme ${p.kills} isabet ${p.hits}`);
