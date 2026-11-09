import type { Queryable } from '../db/index.ts';
import { config } from '../../data/config.ts';
import { hmac } from '../security/tokens.ts';

/**
 * Limitación de intentos guardada en Postgres (las funciones serverless no comparten memoria).
 * Al llegar al máximo de fallos en la ventana se inserta una fila `lock` (y se borran los fallos),
 * de modo que el bloqueo dura exactamente `bloqueoMin` desde que se produce.
 */

export interface AttemptKeys {
  nickKey: string;
  ipKey: string;
}

export function attemptKeys(secret: string, nick: string, ip: string | undefined): AttemptKeys {
  return {
    nickKey: hmac(secret, `nick:${nick.trim().toLowerCase()}`),
    ipKey: hmac(secret, `ip:${ip ?? 'desconocida'}`),
  };
}

export type LockState = { locked: false } | { locked: true; retryAfterSec: number; scope: 'nick' | 'ip' };

async function lockRemainingSec(db: Queryable, key: string): Promise<number> {
  const { rows } = await db.query<{ secs: string | null }>(
    `SELECT ceil(extract(epoch FROM (max(at) + make_interval(mins => $2) - now())))::text AS secs
       FROM login_attempts
      WHERE key_hash = $1 AND kind = 'lock' AND at > now() - make_interval(mins => $2)`,
    [key, config.acceso.bloqueoMin],
  );
  const secs = Number(rows[0]?.secs ?? 0);
  return Number.isFinite(secs) && secs > 0 ? secs : 0;
}

export async function checkLock(db: Queryable, keys: AttemptKeys): Promise<LockState> {
  const [nickSecs, ipSecs] = await Promise.all([lockRemainingSec(db, keys.nickKey), lockRemainingSec(db, keys.ipKey)]);
  if (nickSecs > 0) return { locked: true, retryAfterSec: nickSecs, scope: 'nick' };
  if (ipSecs > 0) return { locked: true, retryAfterSec: ipSecs, scope: 'ip' };
  return { locked: false };
}

async function failuresInWindow(db: Queryable, key: string, kind: 'nick' | 'ip'): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM login_attempts
      WHERE key_hash = $1 AND kind = $3 AND at > now() - make_interval(mins => $2)`,
    [key, config.acceso.ventanaFallosMin, kind],
  );
  return Number(rows[0]?.count ?? 0);
}

async function lockIfExceeded(db: Queryable, key: string, kind: 'nick' | 'ip', max: number): Promise<boolean> {
  if ((await failuresInWindow(db, key, kind)) < max) return false;
  await db.query(`DELETE FROM login_attempts WHERE key_hash = $1 AND kind = $2`, [key, kind]);
  await db.query(`INSERT INTO login_attempts (key_hash, kind) VALUES ($1, 'lock')`, [key]);
  return true;
}

/**
 * Registra un fallo. Devuelve si este fallo ha provocado el bloqueo y cuántos intentos quedan.
 */
export async function recordFailure(
  db: Queryable,
  keys: AttemptKeys,
): Promise<{ nowLocked: boolean; remaining: number }> {
  await db.query(`INSERT INTO login_attempts (key_hash, kind) VALUES ($1, 'nick'), ($2, 'ip')`, [
    keys.nickKey,
    keys.ipKey,
  ]);
  const nickLocked = await lockIfExceeded(db, keys.nickKey, 'nick', config.acceso.maxFallosPorNick);
  const ipLocked = await lockIfExceeded(db, keys.ipKey, 'ip', config.acceso.maxFallosPorIp);
  const remaining = nickLocked
    ? 0
    : Math.max(0, config.acceso.maxFallosPorNick - (await failuresInWindow(db, keys.nickKey, 'nick')));
  return { nowLocked: nickLocked || ipLocked, remaining };
}

export async function clearNickFailures(db: Queryable, keys: AttemptKeys): Promise<void> {
  await db.query(`DELETE FROM login_attempts WHERE key_hash = $1 AND kind = 'nick'`, [keys.nickKey]);
}

/** Las IP (siempre como HMAC) y los intentos antiguos se purgan pasadas `retencionIpHoras`. */
export async function purgeOldAttempts(db: Queryable): Promise<void> {
  await db.query(`DELETE FROM login_attempts WHERE at < now() - make_interval(hours => $1)`, [
    config.acceso.retencionIpHoras,
  ]);
}
