/**
 * La Plaza: chat comunitario de sala única. Sin WebSockets (Netlify Functions no los admite):
 * las islas consultan por polling `GET /api/chat?since=<id>` solo con la pestaña visible.
 *
 *  - Límites por persona, comprobados en el servidor con la fila de la persona bloqueada (así dos
 *    envíos a la vez no se saltan el límite): 1 mensaje cada `minMsEntreMensajes` y
 *    `maxPorMinuto` por minuto; `maxCaracteres` por mensaje.
 *  - La autora o el autor borra sus mensajes; la administración borra cualquiera (moderación).
 *    Al borrar, el texto se elimina de la base de datos.
 *  - Los mensajes de la administración son anuncios, con estilo diferenciado.
 *  - Retención: lo anterior a `retencionDias` se borra de forma oportunista al publicar.
 * Los textos se guardan tal cual y la interfaz los muestra siempre como texto (nunca como HTML).
 */
import type { Db, Queryable } from '../db/index.ts';
import { config } from '../../data/config.ts';
import { audit } from '../auth/admin.ts';
import type { Role } from '../auth/users.ts';

export interface ChatMessageView {
  id: number;
  userId: number;
  nick: string;
  avatar: string | null;
  kind: 'mensaje' | 'anuncio';
  /** null si se ha borrado. */
  cuerpo: string | null;
  createdAt: string;
  deleted: boolean;
  /** Borrado por la administración (y no por quien lo escribió). */
  deletedByAdmin: boolean;
}

interface RawMessage {
  id: number;
  user_id: number;
  nick: string;
  avatar: string | null;
  kind: 'mensaje' | 'anuncio';
  cuerpo: string | null;
  created_at: Date;
  deleted_at: Date | null;
  deleted_by: number | null;
}

const SELECT = `
  SELECT m.id, m.user_id, u.nick, u.avatar, m.kind, m.cuerpo, m.created_at, m.deleted_at, m.deleted_by
    FROM chat_messages m JOIN users u ON u.id = m.user_id`;

const toView = (r: RawMessage): ChatMessageView => ({
  id: r.id,
  userId: r.user_id,
  nick: r.nick,
  avatar: r.avatar,
  kind: r.kind,
  cuerpo: r.deleted_at ? null : r.cuerpo,
  createdAt: new Date(r.created_at).toISOString(),
  deleted: r.deleted_at !== null,
  deletedByAdmin: r.deleted_at !== null && r.deleted_by !== null && r.deleted_by !== r.user_id,
});

export interface ChatPage {
  messages: ChatMessageView[];
  /** Hay mensajes más antiguos que los devueltos. */
  hasMore: boolean;
  /** Ids borrados desde `deletedSince` (para quitarlos de la pantalla en el siguiente sondeo). */
  deletedIds: number[];
  /** Hora del servidor: se devuelve como `deletedSince` en el siguiente sondeo. */
  now: string;
}

/**
 * - Sin parámetros: los últimos `ultimos` mensajes.
 * - `since`: solo los posteriores a ese id (sondeo).
 * - `before`: los anteriores a ese id («cargar anteriores»).
 */
export async function listMessages(
  db: Queryable,
  options: { since?: number | undefined; before?: number | undefined; deletedSince?: string | undefined; limit?: number } = {},
): Promise<ChatPage> {
  const limit = options.limit ?? config.chat.ultimos;
  const retention = `m.created_at > now() - ($1::int * interval '1 day')`;
  let rows: RawMessage[];
  let hasMore = false;

  if (options.since !== undefined) {
    ({ rows } = await db.query<RawMessage>(`${SELECT} WHERE ${retention} AND m.id > $2 ORDER BY m.id LIMIT $3`, [
      config.chat.retencionDias,
      options.since,
      limit,
    ]));
  } else {
    const before = options.before ?? 2_147_483_647;
    const { rows: desc } = await db.query<RawMessage>(`${SELECT} WHERE ${retention} AND m.id < $2 ORDER BY m.id DESC LIMIT $3`, [
      config.chat.retencionDias,
      before,
      limit + 1,
    ]);
    hasMore = desc.length > limit;
    rows = desc.slice(0, limit).reverse();
  }

  let deletedIds: number[] = [];
  if (options.deletedSince) {
    const since = new Date(options.deletedSince);
    if (!Number.isNaN(since.getTime())) {
      const { rows: deleted } = await db.query<{ id: number }>('SELECT id FROM chat_messages WHERE deleted_at >= $1', [since]);
      deletedIds = deleted.map((d) => d.id);
    }
  }
  const { rows: clock } = await db.query<{ now: Date }>('SELECT now() AS now');
  return { messages: rows.map(toView), hasMore, deletedIds, now: new Date(clock[0]?.now ?? Date.now()).toISOString() };
}

export type ChatError = 'empty' | 'too_long' | 'too_fast' | 'too_many' | 'not_found' | 'forbidden' | 'blocked';

export type ChatResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; value: T })
  | { ok: false; code: ChatError; retryAfterSec?: number };

/** Publica un mensaje (o un anuncio, si es la administración). */
export async function postChatMessage(
  db: Db,
  user: { id: number; role: Role },
  text: string,
): Promise<ChatResult<{ message: ChatMessageView }>> {
  const cuerpo = text.replace(/\r\n?/g, '\n').trim();
  if (cuerpo.length === 0) return { ok: false, code: 'empty' };
  if ([...cuerpo].length > config.chat.maxCaracteres) return { ok: false, code: 'too_long' };

  return db.tx(async (q): Promise<ChatResult<{ message: ChatMessageView }>> => {
    // La fila de la persona hace de cerrojo: los límites no se pueden saltar enviando a la vez.
    const { rows: me } = await q.query<{ status: string }>('SELECT status FROM users WHERE id = $1 FOR UPDATE', [user.id]);
    if (!me[0] || me[0].status === 'bloqueado') return { ok: false, code: 'blocked' };

    const { rows: recent } = await q.query<{ last_ms: number | null; per_minute: number }>(
      `SELECT (EXTRACT(EPOCH FROM (now() - max(created_at))) * 1000)::float8 AS last_ms,
              count(*) FILTER (WHERE created_at > now() - interval '1 minute')::int AS per_minute
         FROM chat_messages WHERE user_id = $1 AND created_at > now() - interval '1 minute'`,
      [user.id],
    );
    const lastMs = recent[0]?.last_ms ?? null;
    if (lastMs !== null && lastMs < config.chat.minMsEntreMensajes) {
      return { ok: false, code: 'too_fast', retryAfterSec: Math.max(1, Math.ceil((config.chat.minMsEntreMensajes - lastMs) / 1000)) };
    }
    if ((recent[0]?.per_minute ?? 0) >= config.chat.maxPorMinuto) return { ok: false, code: 'too_many', retryAfterSec: 60 };

    const kind = user.role === 'admin' ? 'anuncio' : 'mensaje';
    const { rows } = await q.query<{ id: number }>('INSERT INTO chat_messages (user_id, kind, cuerpo) VALUES ($1, $2, $3) RETURNING id', [
      user.id,
      kind,
      cuerpo,
    ]);
    const id = rows[0]?.id as number;
    if (user.role === 'admin') await audit(q, user.id, 'plaza_anuncio_publicado', null, { mensajeId: id });

    // Retención: limpieza oportunista (barata gracias al índice por fecha).
    await purgeOldMessages(q);

    const { rows: created } = await q.query<RawMessage>(`${SELECT} WHERE m.id = $1`, [id]);
    return { ok: true, value: { message: toView(created[0] as RawMessage) } };
  });
}

/** Borra un mensaje: el propio, o cualquiera si es la administración. El texto desaparece de la base de datos. */
export async function deleteChatMessage(db: Db, user: { id: number; role: Role }, messageId: number): Promise<ChatResult> {
  return db.tx(async (q): Promise<ChatResult> => {
    const { rows } = await q.query<{ user_id: number; nick: string; deleted_at: Date | null }>(
      `SELECT m.user_id, u.nick, m.deleted_at FROM chat_messages m JOIN users u ON u.id = m.user_id WHERE m.id = $1 FOR UPDATE OF m`,
      [messageId],
    );
    const row = rows[0];
    if (!row || row.deleted_at !== null) return { ok: false, code: 'not_found' };
    if (user.role !== 'admin' && row.user_id !== user.id) return { ok: false, code: 'forbidden' };
    await q.query('UPDATE chat_messages SET cuerpo = NULL, deleted_at = now(), deleted_by = $2 WHERE id = $1', [messageId, user.id]);
    if (user.role === 'admin' && row.user_id !== user.id) {
      await audit(q, user.id, 'plaza_mensaje_borrado', row.nick, { mensajeId: messageId });
    }
    return { ok: true };
  });
}

/** Borra los mensajes más antiguos que la retención configurada. Devuelve cuántos ha borrado. */
export async function purgeOldMessages(q: Queryable): Promise<number> {
  const { rows } = await q.query<{ id: number }>(
    `DELETE FROM chat_messages WHERE created_at < now() - ($1::int * interval '1 day') RETURNING id`,
    [config.chat.retencionDias],
  );
  return rows.length;
}
