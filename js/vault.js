// Unlocks the bundled Google Maps key with a password.
// The key is stored only as AES-GCM ciphertext (key derived with PBKDF2), never in plain text.
// This keeps casual readers out, but it is not strong secrecy: protect the key itself by
// restricting it to this site's HTTP referrer and capping its quota in Google Cloud.

import { VAULT } from './data/vault-data.js';

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const hasVault = () => Boolean(VAULT?.ct);

/** Resolves to the API key, or rejects with Error('wrong-password'). */
export async function unlockKey(password) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const aes = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64(VAULT.salt), iterations: VAULT.iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(VAULT.iv) }, aes, b64(VAULT.ct));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('wrong-password');
  }
}
