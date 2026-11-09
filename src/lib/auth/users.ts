import type { Queryable } from '../db/index.ts';

export type Role = 'member' | 'admin';
export type SeatStatus = 'sin_activar' | 'activo' | 'bloqueado';

/** Usuario tal como lo ve el servidor (incluye el hash: NUNCA se envía al navegador). */
export interface UserRecord {
  id: number;
  seat: number | null;
  nick: string;
  role: Role;
  avatar: string | null;
  password_hash: string | null;
  must_change_password: boolean;
  status: SeatStatus;
}

/** Usuario seguro para exponer al propio interesado (sin hash). */
export interface PublicUser {
  id: number;
  nick: string;
  role: Role;
  avatar: string | null;
  mustChangePassword: boolean;
}

export const USER_COLUMNS = 'id, seat, nick, role, avatar, password_hash, must_change_password, status';

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    nick: user.nick,
    role: user.role,
    avatar: user.avatar,
    mustChangePassword: user.must_change_password,
  };
}

export async function findUserByNick(db: Queryable, nick: string, role: Role): Promise<UserRecord | null> {
  const { rows } = await db.query<UserRecord>(
    `SELECT ${USER_COLUMNS} FROM users WHERE lower(nick) = lower($1) AND role = $2`,
    [nick.trim(), role],
  );
  return rows[0] ?? null;
}

/** Tarjetas del login: solo datos públicos. `canLogin` = la plaza ya tiene código o clave. */
export interface LoginCard {
  nick: string;
  avatar: string | null;
  canLogin: boolean;
  blocked: boolean;
}

export async function listLoginCards(db: Queryable): Promise<LoginCard[]> {
  const { rows } = await db.query<{ nick: string; avatar: string | null; has_hash: boolean; status: SeatStatus }>(
    `SELECT nick, avatar, (password_hash IS NOT NULL) AS has_hash, status
       FROM users WHERE role = 'member' ORDER BY seat`,
  );
  return rows.map((r) => ({
    nick: r.nick,
    avatar: r.avatar,
    canLogin: r.has_hash && r.status !== 'bloqueado',
    blocked: r.status === 'bloqueado',
  }));
}
