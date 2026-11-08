// ============================================================================
// SUNUCU GİRİŞ NOKTASI
// Express (basit HTTP: /health) + Colyseus (WebSocket oyun odaları).
// Render'ın ücretsiz planında PORT ortam değişkeni verilir.
// ============================================================================
import http from 'node:http';
import express from 'express';
import RAPIER from '@dimforge/rapier3d-compat';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom, activeRooms, MAX_ROOMS } from './GameRoom.js';

const PORT = Number(process.env.PORT || 2567);

// Rapier (fizik motoru) WebAssembly'sini bir kez yükle.
// (Rapier'in zararsız "deprecated parameters" uyarısını gizliyoruz.)
const warn = console.warn;
console.warn = () => {};
await RAPIER.init();
console.warn = warn;

const app = express();
// Tarayıcı GitHub Pages'ten (başka bir alan adından) soracağı için CORS izni
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});
// İstemci sunucu uyanık mı diye buraya bakar ("Sunucu başlatılıyor..." ekranı)
app.get('/health', (req, res) => {
  res.json({ ok: true, rooms: activeRooms.size, maxRooms: MAX_ROOMS, full: activeRooms.size >= MAX_ROOMS });
});
app.get('/', (req, res) => res.type('text').send('MIKNATIS SAVAŞI sunucusu çalışıyor 🧲'));

const server = http.createServer(app);
const gameServer = new Server({
  greet: false,
  transport: new WebSocketTransport({
    server,
    pingInterval: 4000, // kopan bağlantıları ~12 sn'de fark et
    pingMaxRetries: 3,
    perMessageDeflate: false, // sıkıştırma CPU yer; mesajlarımız zaten küçük
  }),
});
gameServer.define('oyun', GameRoom);

await gameServer.listen(PORT);
console.log(`🧲 Mıknatıs Savaşı sunucusu: http://localhost:${PORT} (en fazla ${MAX_ROOMS} oda)`);

// Bellek / CPU özetini arada bir yaz (Render loglarında görürsün)
setInterval(() => {
  const mb = (process.memoryUsage().rss / 1048576).toFixed(0);
  if (activeRooms.size > 0) console.log(`[durum] oda: ${activeRooms.size}, bellek: ${mb} MB`);
}, 60000).unref();
