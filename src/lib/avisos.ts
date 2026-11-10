/**
 * Buzón de avisos de cada familia. PRIVADO: solo se leen aquí, con el identificador de la
 * persona con sesión; no existe ningún endpoint ni pantalla de administración que los lea.
 */
import type { Queryable } from './db/index.ts';

export interface AvisoView {
  id: number;
  tipo: string;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

export async function listAvisos(db: Queryable, userId: number, limit = 50): Promise<AvisoView[]> {
  const { rows } = await db.query<{ id: number; tipo: string; payload: Record<string, unknown>; read_at: Date | null; created_at: Date }>(
    'SELECT id, tipo, payload, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
    [userId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    tipo: r.tipo,
    payload: r.payload,
    read: r.read_at !== null,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/** Contador ligero para el polling de la navegación. */
export async function unreadCount(db: Queryable, userId: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId]);
  return rows[0]?.n ?? 0;
}

/** Marca como leídos unos avisos (solo los de esta persona) o todos. */
export async function markRead(db: Queryable, userId: number, which: readonly number[] | 'all'): Promise<void> {
  if (which === 'all') {
    await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
  } else if (which.length > 0) {
    await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::int[])', [userId, [...which]]);
  }
}
