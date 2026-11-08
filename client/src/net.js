// ============================================================================
// SUNUCU BAĞLANTISI
// Render'ın ücretsiz sunucusu boşta kalınca uyur; ilk istekte uyanması ~1 dk
// sürebilir. Bu yüzden önce /health adresini yoklarız, "Sunucu başlatılıyor..."
// ekranında geri sayarak otomatik tekrar deneriz. Uyanınca odaya bağlanırız.
// ============================================================================
import { Client } from 'colyseus.js';

/** Sunucu adresi: ?sunucu=... parametresi > derleme ayarı (VITE_SERVER_URL) > yerel. */
export function getServerUrl() {
  const q = new URLSearchParams(location.search).get('sunucu');
  if (q) return q;
  const env = import.meta.env.VITE_SERVER_URL;
  if (env) return env;
  const host = location.hostname || 'localhost';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${host}:2567`;
}

const toHttp = (ws) => ws.replace(/^ws/, 'http');

export class Cancelled extends Error {}

/**
 * Sunucu uyanana kadar bekler.
 * @param onProgress (saniye, deneme) => void
 * @param token { cancelled: boolean }
 */
export async function wakeServer(onProgress, token, maxSeconds = 150) {
  const url = toHttp(getServerUrl()) + '/health';
  const t0 = performance.now();
  let attempt = 0;
  for (;;) {
    if (token.cancelled) throw new Cancelled();
    attempt++;
    const elapsed = (performance.now() - t0) / 1000;
    onProgress(elapsed, attempt);
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(to);
      if (res.ok) return await res.json();
    } catch (e) { /* uyuyor ya da ağ yok: tekrar dene */ }
    if (elapsed > maxSeconds) throw new Error('Sunucuya ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.');
    await new Promise((r) => setTimeout(r, 2500));
  }
}

/** Colyseus hata kodlarını Türkçe mesaja çevir. */
export function errorText(e) {
  const msg = String((e && e.message) || e || '');
  const code = e && e.code;
  if (code === 4503 || msg.includes('SUNUCU_DOLU')) return 'Sunucu dolu, biraz sonra tekrar dene.';
  if (code === 4504 || msg.includes('ODA_DOLU') || /locked|full/i.test(msg)) return 'Oda dolu (en fazla 8 oyuncu).';
  if (/not found|invalid|no rooms/i.test(msg) || code === 4212) return 'Oda bulunamadı. Kodu kontrol et.';
  return 'Bağlantı hatası: ' + (msg || 'bilinmiyor');
}

/**
 * Oda kur ya da odaya katıl.
 * @param mode 'create' | 'join'
 */
export async function connectRoom(mode, name, code) {
  const client = new Client(getServerUrl());
  const room = mode === 'create'
    ? await client.create('oyun', { name })
    : await client.joinById(code.toUpperCase().trim(), { name });
  return { client, room };
}
