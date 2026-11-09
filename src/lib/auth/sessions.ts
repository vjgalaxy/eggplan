import type { Queryable } from '../db/index.ts';
import { config } from '../../data/config.ts';
import { hashToken, newToken } from '../security/tokens.ts';
import { USER_COLUMNS, type UserRecord } from './users.ts';

const DAY_MS = 86_400_000;
/** La caducidad deslizante solo se renueva si la última renovación tiene más de este tiempo. */
const TOUCH_AFTER_MS = 10 * 60_000;

export function sessionExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + config.acceso.sesionDias * DAY_MS);
}

export async function createSession(db: Queryable, userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = sessionExpiry();
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    hashToken(token),
    userId,
    expiresAt,
  ]);
  // Limpieza oportunista de sesiones caducadas.
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  return { token, expiresAt };
}

export interface ResolvedSession {
  user: UserRecord;
  /** Hash del token de esta sesión (para cerrar "todas las demás"). */
  tokenHash: string;
  /** Nueva caducidad si se ha renovado (para refrescar la cookie). */
  renewedUntil: Date | null;
}

/** Resuelve el token de la cookie. Devuelve null si no existe, caducó o la plaza está bloqueada. */
export async function resolveSession(db: Queryable, token: string): Promise<ResolvedSession | null> {
  const tokenHash = hashToken(token);
  const { rows } = await db.query<UserRecord & { last_seen_at: Date }>(
    `SELECT ${USER_COLUMNS.split(', ').map((c) => `u.${c}`).join(', ')}, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status <> 'bloqueado'`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) return null;

  let renewedUntil: Date | null = null;
  if (Date.now() - new Date(row.last_seen_at).getTime() > TOUCH_AFTER_MS) {
    renewedUntil = sessionExpiry();
    await db.query('UPDATE sessions SET last_seen_at = now(), expires_at = $2 WHERE token_hash = $1', [
      tokenHash,
      renewedUntil,
    ]);
  }
  const user: UserRecord = {
    id: row.id,
    seat: row.seat,
    nick: row.nick,
    role: row.role,
    avatar: row.avatar,
    password_hash: row.password_hash,
    must_change_password: row.must_change_password,
    status: row.status,
  };
  return { user, tokenHash, renewedUntil };
}

export async function revokeSession(db: Queryable, token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

/** Cierra todas las sesiones de una persona (opcionalmente conservando una). */
export async function revokeUserSessions(db: Queryable, userId: number, exceptTokenHash?: string): Promise<void> {
  if (exceptTokenHash) {
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, exceptTokenHash]);
  } else {
    await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }
}

// --- Cookie -------------------------------------------------------------------------------

/** En producción se usa el prefijo `__Host-` (Secure, Path=/, sin Domain). En localhost (http) no se puede. */
export function sessionCookieName(production: boolean): string {
  return production ? '__Host-eggplan_sid' : 'eggplan_sid';
}

export function sessionCookieOptions(production: boolean, expires: Date) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: 'lax' as const,
    path: '/',
    expires,
  };
}
