// ============================================================================
// Türkçe ek yardımcıları: "Kemal" -> "Kemal'i", "Ayşe" -> "Ayşe'yi".
// Skor akışındaki "Ali, Kemal'i karpuzla düşürdü!" cümleleri için.
// Büyük ünlü uyumu: son ünlü a/ı -> ı, e/i -> i, o/u -> u, ö/ü -> ü
// ============================================================================
import { ITEM_KINDS } from './constants.js';

const VOWELS = 'aeıioöuü';
function lowerTr(s) {
  return s.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
}

/** Belirtme hâli (-i hâli) eki ekler. Ünlü bulunamazsa null döner. */
export function accusative(name) {
  const s = lowerTr(name.trim());
  let last = '';
  for (let i = s.length - 1; i >= 0; i--) if (VOWELS.includes(s[i])) { last = s[i]; break; }
  if (!last) return null;
  const suf = 'aı'.includes(last) ? 'ı' : 'ei'.includes(last) ? 'i' : 'ou'.includes(last) ? 'u' : 'ü';
  const endsVowel = VOWELS.includes(s[s.length - 1]);
  return name.trim() + "'" + (endsVowel ? 'y' : '') + suf;
}

/** Eleme mesajı üretir. kind: eşya türü, 100 = itme dalgası, -1 = kendi düştü */
export function elimMessage(killerName, victimName, kind) {
  if (!killerName) {
    const r = ['boşluğa yuvarlandı', 'kendi kendine düştü', 'aşağıyı merak etti', 'uçmayı denedi'];
    return `${victimName} ${r[Math.floor(Math.random() * r.length)]}!`;
  }
  const acc = accusative(victimName);
  const how = kind === 100 ? 'itme dalgasıyla' : ITEM_KINDS[kind] ? ITEM_KINDS[kind].withName : '';
  if (!acc) return `${killerName} → ${victimName} (${how})`;
  const verb = kind === 100 ? 'uçurdu' : 'düşürdü';
  return `${killerName}, ${acc} ${how} ${verb}!`;
}
