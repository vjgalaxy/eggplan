/**
 * Gestión de plazas por el administrador (Fase 0). IMPORTANTE: el administrador nunca ve
 * claves ni hashes, sesiones, mensajes de propuestas ni los avisos personales de las familias.
 * `listSeats` selecciona columnas explícitas (sin `password_hash`) y no hay ninguna otra
 * consulta de datos privados en este módulo.
 */
import type { Db, Queryable } from '../db/index.ts';
import { validateNick } from '../domain/nick.ts';
import { hashPassword } from '../security/password.ts';
import { newInitialCode } from '../security/tokens.ts';
import { revokeUserSessions } from './sessions.ts';

export interface SeatSummary {
  id: number;
  seat: number;
  nick: string;
  avatar: string | null;
  status: 'sin_activar' | 'activo' | 'bloqueado';
  /** Tiene un código inicial o una clave guardados (no se revela cuál ni su valor). */
  hasCredential: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export async function listSeats(db: Queryable): Promise<SeatSummary[]> {
  const { rows } = await db.query<{
    id: number;
    seat: number;
    nick: string;
    avatar: string | null;
    status: SeatSummary['status'];
    has_credential: boolean;
    must_change_password: boolean;
    last_login_at: Date | null;
  }>(
    `SELECT id, seat, nick, avatar, status, (password_hash IS NOT NULL) AS has_credential,
            must_change_password, last_login_at
       FROM users WHERE role = 'member' ORDER BY seat`,
  );
  return rows.map((r) => ({
    id: r.id,
    seat: r.seat,
    nick: r.nick,
    avatar: r.avatar,
    status: r.status,
    hasCredential: r.has_credential,
    mustChangePassword: r.must_change_password,
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
  }));
}

export async function audit(
  q: Queryable,
  adminId: number,
  accion: string,
  objetivo: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await q.query('INSERT INTO admin_audit (admin_id, accion, objetivo, payload) VALUES ($1, $2, $3, $4::jsonb)', [
    adminId,
    accion,
    objetivo,
    JSON.stringify(payload),
  ]);
}

export interface IssuedCode {
  seatId: number;
  nick: string;
  avatar: string | null;
  code: string;
}

/**
 * Genera códigos iniciales. `seatId` = regenerar esa plaza (olvido de clave: la plaza vuelve a
 * `sin_activar`, se cierran sus sesiones y debe elegir clave nueva). Sin `seatId` = "Generar
 * códigos iniciales": solo para las plazas que aún no tienen ni código ni clave (nunca pisa las
 * claves de familias que ya están usando la app).
 * Los códigos se devuelven UNA sola vez; en la base de datos solo queda su hash.
 */
export async function issueInitialCodes(
  db: Db,
  adminId: number,
  target: { seatId: number } | { onlyMissing: true },
): Promise<IssuedCode[]> {
  const columns = 'id, nick, avatar';
  const { rows: seats } =
    'seatId' in target
      ? await db.query<{ id: number; nick: string; avatar: string | null }>(
          `SELECT ${columns} FROM users WHERE role = 'member' AND id = $1`,
          [target.seatId],
        )
      : await db.query<{ id: number; nick: string; avatar: string | null }>(
          `SELECT ${columns} FROM users
            WHERE role = 'member' AND password_hash IS NULL AND status <> 'bloqueado' ORDER BY seat`,
        );

  // Se calculan los hashes (scrypt, lento) fuera de la transacción.
  const prepared: { seat: (typeof seats)[number]; code: string; hash: string }[] = [];
  for (const seat of seats) {
    const code = newInitialCode();
    prepared.push({ seat, code, hash: await hashPassword(code) });
  }

  await db.tx(async (q) => {
    for (const { seat, hash } of prepared) {
      await q.query(
        `UPDATE users SET password_hash = $2, must_change_password = true,
                status = CASE WHEN status = 'bloqueado' THEN status ELSE 'sin_activar' END
          WHERE id = $1`,
        [seat.id, hash],
      );
      await revokeUserSessions(q, seat.id);
      await audit(q, adminId, 'codigo_inicial_generado', seat.nick, {});
    }
  });

  return prepared.map(({ seat, code }) => ({ seatId: seat.id, nick: seat.nick, avatar: seat.avatar, code }));
}

export type AdminActionResult = { ok: true } | { ok: false; code: 'not_found' | 'nick_invalid' | 'nick_reserved' | 'nick_taken' };

export async function setSeatBlocked(db: Db, adminId: number, seatId: number, blocked: boolean): Promise<AdminActionResult> {
  return db.tx(async (q) => {
    // Al desbloquear: "activo" si la persona ya eligió su propia clave; si no, "sin_activar".
    const { rows } = await q.query<{ nick: string }>(
      `UPDATE users
          SET status = CASE
                WHEN $2::boolean THEN 'bloqueado'
                WHEN password_hash IS NOT NULL AND NOT must_change_password THEN 'activo'
                ELSE 'sin_activar' END
        WHERE id = $1 AND role = 'member'
        RETURNING nick`,
      [seatId, blocked],
    );
    const row = rows[0];
    if (!row) return { ok: false, code: 'not_found' } as const;
    if (blocked) await revokeUserSessions(q, seatId);
    await audit(q, adminId, blocked ? 'plaza_bloqueada' : 'plaza_desbloqueada', row.nick);
    return { ok: true } as const;
  });
}

export async function renameSeat(db: Db, adminId: number, seatId: number, newNick: string): Promise<AdminActionResult> {
  const valid = validateNick(newNick);
  if (!valid.ok) return { ok: false, code: valid.reason === 'reservado' ? 'nick_reserved' : 'nick_invalid' };
  return db.tx(async (q) => {
    const { rows: current } = await q.query<{ nick: string }>(`SELECT nick FROM users WHERE id = $1 AND role = 'member'`, [seatId]);
    if (!current[0]) return { ok: false, code: 'not_found' } as const;
    const { rows: clash } = await q.query(`SELECT 1 FROM users WHERE lower(nick) = lower($1) AND id <> $2`, [valid.nick, seatId]);
    if (clash.length > 0) return { ok: false, code: 'nick_taken' } as const;
    await q.query('UPDATE users SET nick = $2 WHERE id = $1', [seatId, valid.nick]);
    await audit(q, adminId, 'plaza_renombrada', current[0].nick, { nuevo: valid.nick });
    return { ok: true } as const;
  });
}
