import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { config } from '../../data/config.ts';

/** Token de sesión aleatorio (256 bits) para la cookie. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Hash SHA-256 del token: es lo único que se guarda en la base de datos. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** HMAC con secreto: para guardar nick/IP de los intentos sin guardar el dato en claro. */
export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** Código inicial fácil de dictar: palabra común + 4 dígitos (p. ej. `berenjena-4821`). */
export function newInitialCode(words: readonly string[] = config.palabrasCodigo): string {
  const word = words[randomInt(words.length)] ?? 'berenjena';
  const digits = String(randomInt(10_000)).padStart(4, '0');
  return `${word}-${digits}`;
}

/** Los móviles ponen mayúscula inicial y espacios: el código se compara normalizado. */
export function normalizeCode(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '');
}
