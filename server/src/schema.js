// ============================================================================
// AĞ DURUMU (Colyseus Schema)
// Colyseus bu nesneleri her "patch"te (saniyede 20 kez) istemcilere gönderir,
// ama SADECE DEĞİŞEN alanları (delta). Duran bir eşyanın hiçbir alanı
// değişmediği için onun için tek bayt bile gitmez.
//
// Bant genişliği için:
//  - Konumlar int16 santimetre (2 bayt), float yerine
//  - Dönüş tek uint32 (sıkıştırılmış quaternion), 4 float yerine
//  - Küçük sayılar uint8/int8
// Not: Alanlara başlangıç değerini constructor içinde veriyoruz; sınıf alanı
// (class field) olarak yazarsak Schema'nın izleme mekanizması bozulur.
// ============================================================================
import { Schema, MapSchema, defineTypes } from '@colyseus/schema';

export class PlayerState extends Schema {
  constructor() {
    super();
    this.sid = ''; // oturum kimliği (bot ise boş)
    this.name = '';
    this.color = 0;
    this.bot = false;
    this.afk = false; // bağlantısı koptu, bot oynatıyor
    this.inRound = false;
    this.alive = false;
    this.x = 0; this.y = 0; this.z = 0; // cm
    this.vx = 0; this.vy = 0; this.vz = 0; // cm/s (tahmin düzeltmesi için)
    this.yaw = 0; this.pitch = 0; // radyan*10000
    this.ack = 0; // sunucunun işlediği son girdi numarası
    this.hold = -1; this.pull = -1; // tutulan / çekilen eşya
    this.stun = 0; // sersemlik (1/50 sn birimi)
    this.hook = false; this.hx = 0; this.hy = 0; this.hz = 0; this.hookT = 0;
    this.slow = 0; // ağır eşya yavaşlatması (yüzde)
    this.pushCd = 0; this.hookCd = 0; // bekleme süreleri (1/10 sn)
    this.kills = 0; this.hits = 0; this.place = 0; this.wins = 0;
  }
}
defineTypes(PlayerState, {
  sid: 'string', name: 'string', color: 'uint8', bot: 'boolean', afk: 'boolean',
  inRound: 'boolean', alive: 'boolean',
  x: 'int16', y: 'int16', z: 'int16', vx: 'int16', vy: 'int16', vz: 'int16',
  yaw: 'int16', pitch: 'int16', ack: 'uint32',
  hold: 'int8', pull: 'int8', stun: 'uint8',
  hook: 'boolean', hx: 'int16', hy: 'int16', hz: 'int16', hookT: 'uint8', slow: 'uint8',
  pushCd: 'uint8', hookCd: 'uint8',
  kills: 'uint8', hits: 'uint8', place: 'uint8', wins: 'uint8',
});

export class ItemState extends Schema {
  constructor() {
    super();
    this.kind = 0;
    this.s = 0; // durum: serbest / çekiliyor / tutuluyor / uçuyor / yok
    this.h = -1; // tutan oyuncu
    this.x = 0; this.y = 0; this.z = 0; // cm
    this.q = 0; // sıkıştırılmış dönüş
  }
}
defineTypes(ItemState, { kind: 'uint8', s: 'uint8', h: 'int8', x: 'int16', y: 'int16', z: 'int16', q: 'uint32' });

export class GameState extends Schema {
  constructor() {
    super();
    this.code = '';
    this.host = ''; // odayı kuranın sessionId'si
    this.phase = 0;
    this.timer = 0; // tam saniye (saniyede bir değişir -> az veri)
    this.tick = 0;
    this.shrink = 0;
    this.warn = -1;
    this.alive = 0;
    this.total = 0;
    this.winner = -1;
    this.diff = 'orta';
    this.fill = 6; // botlarla kaç kişiye tamamlansın
    this.players = new MapSchema();
    this.items = new MapSchema();
  }
}
defineTypes(GameState, {
  code: 'string', host: 'string', phase: 'uint8', timer: 'int16', tick: 'uint32',
  shrink: 'uint8', warn: 'int8', alive: 'uint8', total: 'uint8', winner: 'int8',
  diff: 'string', fill: 'uint8',
  players: { map: PlayerState }, items: { map: ItemState },
});
