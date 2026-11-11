/**
 * Casos de uso de acceso: login, cambio de clave, avatar. Reciben la `Db` y los datos como
 * parámetros (sin tocar `Request`/cookies) para poder probarlos con tests de integración.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/index.ts';
import { config } from '../../data/config.ts';
import { checkPassword, type PasswordProblem } from '../domain/password-policy.ts';
import { isValidAvatar } from '../domain/avatars.ts';
import { hashPassword, verifyPassword } from '../security/password.ts';
import { normalizeCode } from '../security/tokens.ts';
import { attemptKeys, checkLock, clearNickFailures, purgeOldAttempts, recordFailure } from './rate-limit.ts';
import { createSession, revokeUserSessions } from './sessions.ts';
import { findUserByNick, toPublicUser, type PublicUser, type Role } from './users.ts';

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; user: PublicUser }
  | { ok: false; code: 'invalid'; remaining: number }
  | { ok: false; code: 'locked'; retryAfterSec: number }
  | { ok: false; code: 'blocked' | 'not_activated' };

export interface LoginInput {
  nick: string;
  password: string;
  role: Role;
  ip: string | undefined;
  secret: string;
  /** Solo para role 'admin': la clave esperada (variable de entorno ADMIN_PASSWORD). */
  adminPassword?: string | undefined;
}

/** Comparación en tiempo constante (se comparan los SHA-256 para igualar longitudes). */
function safeEqual(a: string, b: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s.normalize('NFKC')).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export async function login(db: Db, input: LoginInput): Promise<LoginResult> {
  const keys = attemptKeys(input.secret, input.nick, input.ip);

  const lock = await checkLock(db, keys);
  if (lock.locked) return { ok: false, code: 'locked', retryAfterSec: lock.retryAfterSec };

  const user = await findUserByNick(db, input.nick, input.role);
  if (!user) {
    const failure = await recordFailure(db, keys);
    return failure.nowLocked
      ? { ok: false, code: 'locked', retryAfterSec: config.acceso.bloqueoMin * 60 }
      : { ok: false, code: 'invalid', remaining: failure.remaining };
  }
  if (user.status === 'bloqueado') return { ok: false, code: 'blocked' };

  let valid: boolean;
  if (input.role === 'admin') {
    // El admin no tiene clave en la base: se compara con la variable de entorno, tal cual.
    const expected = input.adminPassword;
    valid = !!expected && [...expected].length >= config.acceso.adminClaveMinLongitud && safeEqual(input.password, expected);
  } else {
    if (!user.password_hash) return { ok: false, code: 'not_activated' };
    // Mientras la plaza espera su primer acceso, la "clave" es el código inicial (se normaliza:
    // los móviles ponen mayúscula inicial). Una clave elegida por la persona se compara tal cual.
    const candidate = user.must_change_password ? normalizeCode(input.password) : input.password;
    valid = await verifyPassword(candidate, user.password_hash);
  }
  if (!valid) {
    const failure = await recordFailure(db, keys);
    return failure.nowLocked
      ? { ok: false, code: 'locked', retryAfterSec: config.acceso.bloqueoMin * 60 }
      : { ok: false, code: 'invalid', remaining: failure.remaining };
  }

  await clearNickFailures(db, keys);
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  const { token, expiresAt } = await createSession(db, user.id);
  await purgeOldAttempts(db);
  return { ok: true, token, expiresAt, user: toPublicUser(user) };
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; code: 'problems'; problems: PasswordProblem[] }
  | { ok: false; code: 'wrong_current' };

export interface ChangePasswordInput {
  userId: number;
  nick: string;
  role: Role;
  mustChangePassword: boolean;
  /** Hash del token de la sesión actual: se conserva; el resto se cierran. */
  currentTokenHash: string;
  currentPassword: string | undefined;
  newPassword: string;
  repeatPassword: string;
}

export async function changePassword(db: Db, input: ChangePasswordInput): Promise<ChangePasswordResult> {
  const minLength = input.role === 'admin' ? config.acceso.adminClaveMinLongitud : config.acceso.claveMinLongitud;

  const { rows } = await db.query<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE id = $1', [
    input.userId,
  ]);
  const storedHash = rows[0]?.password_hash ?? null;

  // En el cambio obligatorio (primer acceso) la persona acaba de entrar con el código en esta
  // misma sesión: no se le pide de nuevo. En el cambio voluntario sí se exige la clave actual.
  if (!input.mustChangePassword) {
    if (!input.currentPassword || !storedHash || !(await verifyPassword(input.currentPassword, storedHash))) {
      return { ok: false, code: 'wrong_current' };
    }
  }

  const problems = checkPassword({
    password: input.newPassword,
    nick: input.nick,
    minLength,
    currentPassword: input.mustChangePassword ? undefined : input.currentPassword,
  });
  if (input.newPassword !== input.repeatPassword) problems.push('no_coincide');
  // Tampoco se puede "elegir" otra vez el propio código inicial.
  if (input.mustChangePassword && storedHash && (await verifyPassword(normalizeCode(input.newPassword), storedHash))) {
    problems.push('igual_actual');
  }
  if (problems.length > 0) return { ok: false, code: 'problems', problems };

  const newHash = await hashPassword(input.newPassword);
  await db.tx(async (q) => {
    await q.query(
      `UPDATE users SET password_hash = $2, must_change_password = false,
              status = CASE WHEN status = 'sin_activar' THEN 'activo' ELSE status END,
              password_changed_at = now()
        WHERE id = $1`,
      [input.userId, newHash],
    );
    await revokeUserSessions(q, input.userId, input.currentTokenHash);
    await q.query(`INSERT INTO notifications (user_id, tipo) VALUES ($1, 'clave_cambiada')`, [input.userId]);
  });
  return { ok: true };
}

export type SetAvatarResult = { ok: true } | { ok: false; code: 'invalid_avatar' };

export async function setAvatar(db: Db, userId: number, avatar: unknown, available: readonly string[]): Promise<SetAvatarResult> {
  if (!isValidAvatar(avatar, available)) return { ok: false, code: 'invalid_avatar' };
  await db.query('UPDATE users SET avatar = $2 WHERE id = $1', [userId, avatar]);
  return { ok: true };
}
