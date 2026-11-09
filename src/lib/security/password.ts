/**
 * Hash de claves con scrypt (node:crypto, sin dependencias nativas).
 * Formato guardado: `scrypt$N$r$p$salt(base64)$hash(base64)`; los parámetros viajan con el hash,
 * así se pueden subir más adelante sin invalidar las claves existentes.
 * N=2^15, r=8, p=1 → ~32 MB y ~80–150 ms por verificación: cabe de sobra en una función de Netlify.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const DEFAULT_PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

function derive(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  const options: ScryptOptions = { N, r, p, maxmem: 128 * N * r * 2 };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(
  password: string,
  params: { N: number; r: number; p: number } = DEFAULT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, params.N, params.r, params.p);
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 2 ** 20) return false;
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length !== KEY_LENGTH) return false;
  try {
    const actual = await derive(password, Buffer.from(saltB64, 'base64'), N, r, p);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
