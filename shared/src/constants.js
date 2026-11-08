// ============================================================================
// SABİTLER — Oyunun bütün ayar düğmeleri burada. Dengeyi değiştirmek için
// önce bu dosyaya bak: hızlar, ağırlıklar, süreler...
// Bu dosya hem tarayıcıda hem sunucuda (Node.js) çalışır, o yüzden
// "window", "document" gibi tarayıcıya özel hiçbir şey kullanmaz.
// ============================================================================

/** Sunucu saniyede kaç kez oyunu günceller (tick). */
export const SERVER_TICK_HZ = 20;
/** Tek oyunculu modda tarayıcı simülasyonu daha sık çalıştırır (daha akıcı his). */
export const LOCAL_TICK_HZ = 60;
/** Fizik alt adımının en uzun süresi (s). 20 Hz'de her tick 2 alt adıma bölünür. */
export const MAX_SUBSTEP = 0.026;

/** Oyun evreleri (phase). Ağda tek bayt olarak gider. */
export const PHASE = { LOBBY: 0, COUNTDOWN: 1, PLAYING: 2, ENDED: 3 };

export const ROUND_TIME = 120; // saniye: tur süresi (bitince arena küçülür)
export const COUNTDOWN_TIME = 3; // "3, 2, 1, BAŞLA!"
export const END_SCREEN_TIME = 9; // tur sonu ekranının süresi (otomatik tekrar yok, bilgi için)
export const SHRINK_WARN_TIME = 3; // halka düşmeden önceki uyarı (titreme) süresi
export const SHRINK_INTERVAL = 11; // halkalar arası süre
export const MAX_PLAYERS = 8; // bir turdaki en fazla oyuncu (insan + bot)
export const MAX_SLOTS = 16; // izleyiciler dahil en fazla oyuncu kaydı

// ---------------------------------------------------------------- Fizik
export const GRAVITY = -20; // gerçekten biraz sert: zıplamalar daha "oyunsu" hissettirir
export const KILL_Y = -14; // bunun altına düşen elenir
export const ITEM_RESPAWN_Y = -30; // eşyalar bunun altına düşünce yeniden doğar
export const ITEM_RESPAWN_DELAY = 3.5; // saniye

// Çarpışma grupları (Rapier: üst 16 bit = üyelik, alt 16 bit = kimlerle çarpışır)
export const GROUP_PLAYER = 1;
export const GROUP_ARENA = 2;
export const GROUP_ITEM = 4;
export const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);
export const CG_PLAYER = groups(GROUP_PLAYER, 0xffff);
export const CG_ARENA = groups(GROUP_ARENA, 0xffff);
export const CG_ITEM = groups(GROUP_ITEM, 0xffff);
// Çekilen / tutulan eşya oyunculara çarpmaz (yoksa sahibini iter), ama arenaya ve diğer
// eşyalara çarpar -> kalkan olarak fırlatılan eşyaları durdurabilir.
export const CG_ITEM_GHOST = groups(GROUP_ITEM, GROUP_ARENA | GROUP_ITEM);

// ---------------------------------------------------------------- Oyuncu
export const PLAYER_RADIUS = 0.42;
export const PLAYER_HALF_HEIGHT = 0.48; // kapsülün düz kısmının yarısı -> toplam boy ~1.8 m
export const PLAYER_CENTER_Y = PLAYER_HALF_HEIGHT + PLAYER_RADIUS; // ayak -> merkez
export const PLAYER_MASS = 80;
export const MOVE_SPEED = 8.2;
export const GROUND_ACCEL = 14; // ne kadar çabuk hedef hıza ulaşılır
export const AIR_ACCEL = 4.5;
export const STUN_ACCEL = 0.9; // sersemken neredeyse kontrol yok -> darbe seni taşır
export const JUMP_SPEED = 8;
export const JUMP_COOLDOWN = 0.3;

// ---------------------------------------------------------------- Mıknatıs
export const PULL_RANGE = 30; // nişan alınan eşyanın en uzak mesafesi
export const HOLD_DISTANCE = 1.7; // eşya oyuncunun ne kadar önünde süzülür
export const CATCH_DISTANCE = 1.3; // tutma noktasına bu kadar yaklaşınca "yakalandı"
export const STEAL_TIME = 0.45; // başkasının tuttuğu eşyayı çekip almak için gereken süre
export const THROWN_GRAVITY = 0.35; // fırlatılan eşyalar daha düz uçar
export const THROWN_MAX_TIME = 2.5; // bu kadar süre sonra "tehlikeli" olmaktan çıkar
export const THROWN_MIN_SPEED = 5; // bundan yavaşsa artık tehlikeli değil
export const SELF_HIT_GRACE = 0.3; // kendi fırlattığın eşya ilk 0.3 sn sana çarpmaz

// İtme dalgası (eşya tutmuyorken sağ tık)
export const WAVE_RANGE = 7.5;
export const WAVE_ANGLE = 0.85; // radyan (yarım açı ~49°)
export const WAVE_POWER = 15;
export const WAVE_COOLDOWN = 1.5;

// Kanca (E)
export const HOOK_RANGE = 34;
export const HOOK_SPEED = 24;
export const HOOK_MAX_TIME = 1.4;
export const HOOK_COOLDOWN = 2.2;

// Kamera / nişan (sunucu da aynı hesaplamayı yapar ki nişangâh tam isabet etsin)
export const CAM_DISTANCE = 4.3;
export const CAM_RIGHT = 0.8;
export const CAM_UP = 0.45;
export const EYE_HEIGHT = 0.6; // gövde merkezinden göze
export const PITCH_MIN = -1.15;
export const PITCH_MAX = 1.0;

// ---------------------------------------------------------------- Eşyalar
// shape: 'ball' | 'box' | 'capsule'. Boyutlar "yarım" ölçülerdir (Rapier öyle ister).
// throwSpeed: fırlatma hızı (m/s), knock: vurunca rakibe verilen hız (m/s),
// pullSpeed: çekilirken gelme hızı. Hafif = hızlı ama az iter, ağır = yavaş ama çok iter.
export const ITEM_KINDS = [
  { id: 0, key: 'karpuz', name: 'karpuz', withName: 'karpuzla', shape: 'ball', r: 0.36, mass: 3, throwSpeed: 36, knock: 11, pullSpeed: 28, count: 4 },
  { id: 1, key: 'koni', name: 'trafik konisi', withName: 'koniyle', shape: 'capsule', hh: 0.22, r: 0.24, mass: 2, throwSpeed: 38, knock: 9.5, pullSpeed: 30, count: 3 },
  { id: 2, key: 'sandalye', name: 'sandalye', withName: 'sandalyeyle', shape: 'box', hx: 0.3, hy: 0.46, hz: 0.3, mass: 6, throwSpeed: 30, knock: 14.5, pullSpeed: 24, count: 4 },
  { id: 3, key: 'mikrodalga', name: 'mikrodalga', withName: 'mikrodalgayla', shape: 'box', hx: 0.36, hy: 0.24, hz: 0.28, mass: 9, throwSpeed: 27, knock: 16, pullSpeed: 21, count: 3 },
  { id: 4, key: 'varil', name: 'varil', withName: 'varille', shape: 'box', hx: 0.36, hy: 0.5, hz: 0.36, mass: 20, throwSpeed: 21, knock: 21, pullSpeed: 15, count: 4 },
  { id: 5, key: 'kasa', name: 'kasa', withName: 'kasayla', shape: 'box', hx: 0.5, hy: 0.5, hz: 0.5, mass: 30, throwSpeed: 18, knock: 24, pullSpeed: 12, count: 3 },
  { id: 6, key: 'buzdolabi', name: 'buzdolabı', withName: 'buzdolabıyla', shape: 'box', hx: 0.44, hy: 0.86, hz: 0.4, mass: 55, throwSpeed: 15, knock: 30, pullSpeed: 8.5, count: 1 },
];
export const ITEM_COUNT = ITEM_KINDS.reduce((s, k) => s + k.count, 0); // 22

/** Eşyanın sınır yarıçapı (nişan / tutma mesafesi hesapları için kaba bir değer). */
export function itemRadius(kind) {
  const k = ITEM_KINDS[kind];
  if (k.shape === 'ball') return k.r;
  if (k.shape === 'capsule') return k.hh + k.r;
  return Math.max(k.hx, k.hy, k.hz);
}

// Eşya durumları (ağda tek bayt)
export const ITEM_STATE = { FREE: 0, PULLED: 1, HELD: 2, THROWN: 3, GONE: 4 };

// ---------------------------------------------------------------- Botlar
export const BOT_DECISION_HZ = 5;
export const BOT_LEVELS = {
  kolay: { aimError: 0.1, turnSpeed: 3.2, reaction: 0.6, hookChance: 0, dodge: 0, lead: 0, waveChance: 0.3, throwDelay: 0.9 },
  orta: { aimError: 0.04, turnSpeed: 5.5, reaction: 0.35, hookChance: 0.55, dodge: 0.3, lead: 0.5, waveChance: 0.6, throwDelay: 0.45 },
  zor: { aimError: 0.015, turnSpeed: 9, reaction: 0.15, hookChance: 1, dodge: 0.75, lead: 1, waveChance: 0.9, throwDelay: 0.2 },
};
export const BOT_NAMES = [
  'Hurdacı Hüsnü', 'Mıknatıs Mahmut', 'Vida Vedat', 'Paslı Pakize', 'Somun Selim', 'Bobin Banu',
  'Tornavida Tülay', 'Cıvata Cemil', 'Pense Pelin', 'Kaynakçı Kenan', 'Akü Ayşe', 'Teneke Tarık',
];
/** Oyuncu renkleri (sıra numarasına göre). Canlı, birbirinden kolay ayırt edilen renkler. */
export const PLAYER_COLORS = [0xff4d4d, 0x3fa9ff, 0xffd23f, 0x4dff88, 0xc04dff, 0xff8c1a, 0x1affe0, 0xff5ec4];

// ---------------------------------------------------------------- Olaylar (efekt/ses/akış için)
export const EV = {
  HIT: 1, // fırlatılan eşya oyuncuya çarptı
  BLOCK: 2, // kalkan (tutulan eşya) darbeyi durdurdu
  WAVE: 3, // itme dalgası
  THROW: 4,
  ELIM: 5, // oyuncu elendi
  RING: 6, // arena halkası düştü
  HOOK: 7,
  CATCH: 8, // eşya yakalandı (mıknatısa yapıştı)
  STEAL: 9, // başkasının eşyası kapıldı
  BUMP: 10, // eşya-eşya ya da eşya-zemin sert çarpışması (sadece efekt)
  WIN: 11,
};
