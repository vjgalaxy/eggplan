import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../../lib/server.ts';
import { json, jsonError, parseBody } from '../../../lib/http.ts';
import { listAvisos, markRead, unreadCount } from '../../../lib/avisos.ts';

const schema = z.union([z.object({ action: z.literal('read'), ids: z.array(z.number().int().positive()).max(200) }), z.object({ action: z.literal('read_all') })]);

/**
 * Buzón de avisos de la persona con sesión (privado). `?count=1` devuelve solo el contador, que es
 * lo que consulta la navegación cada ~30 s con la pestaña visible.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  if (user?.role !== 'member') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  const database = await db();
  if (url.searchParams.get('count') === '1') return json({ ok: true, unread: await unreadCount(database, user.id) });
  return json({ ok: true, unread: await unreadCount(database, user.id), avisos: await listAvisos(database, user.id) });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (user?.role !== 'member') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;
  const database = await db();
  await markRead(database, user.id, body.data.action === 'read_all' ? 'all' : body.data.ids);
  return json({ ok: true, unread: await unreadCount(database, user.id) });
};
