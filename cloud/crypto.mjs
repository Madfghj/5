import { scryptAsync } from '@noble/hashes/scrypt.js';

export const encoder = new TextEncoder();
export const bytes = (value) => encoder.encode(value);
export const base64url = (value) => btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unbase64url = (value) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export const secret = (length = 32) => base64url(crypto.getRandomValues(new Uint8Array(length)));
export const hash = async (value) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(value)))].map((v) => v.toString(16).padStart(2, '0')).join('');
export const challenge = async (value) => base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(value))));
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = bytes(a), right = bytes(b);
  if (left.length !== right.length) return false;
  let delta = 0;
  for (let i = 0; i < left.length; i++) delta |= left[i] ^ right[i];
  return delta === 0;
}
// OWASP's scrypt alternative: N=2^14, r=8, p=5, 16 MiB memory.
// Workers WebCrypto has a PBKDF2 iteration cap; scrypt avoids weakening that work factor.
export const passwordParameters = { N: 16384, r: 8, p: 5, dkLen: 32 };
export async function passwordHash(password, salt) {
  return base64url(await scryptAsync(bytes(password), unbase64url(salt), { ...passwordParameters, maxmem: 32 * 1024 * 1024, asyncTick: 15 }));
}
async function tokenKey(env) {
  const material = env.TOKEN_ENCRYPTION_KEY || `${env.APPLE_PRIVATE_KEY}\0opencalendar-apple-revocation-v1`;
  const digest = await crypto.subtle.digest('SHA-256', bytes(material));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptToken(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(env), bytes(value)));
  return `${base64url(iv)}.${base64url(encrypted)}`;
}
export async function decryptToken(value, env) {
  const [iv, encrypted] = value.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64url(iv) }, await tokenKey(env), unbase64url(encrypted));
  return new TextDecoder().decode(plain);
}
