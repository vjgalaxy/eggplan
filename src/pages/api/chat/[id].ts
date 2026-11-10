import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../../lib/server.ts';
import { json, jsonError, parseBody } from '../../../lib/http.ts';
import { deleteChatMessage } from '../../../lib/chat/chat.ts';
import { chatError } from '../../../lib/chat/messages.ts';
import { routeId } from '../../../lib/stock/schemas.ts';

const schema = z.object({ action: z.literal('delete') });

/** Borrar un mensaje: el propio, o cualquiera si es la administración (moderación). */
export const POST: APIRoute = async ({ request, locals, params }) => {
  const user = locals.user;
  if (!user) return jsonError(401, 'unauthenticated', 'Tu sesión ha caducado. Vuelve a entrar.');
  const id = routeId(params['id']);
  if (id === null) return chatError('not_found');
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;
  const result = await deleteChatMessage(await db(), user, id);
  return result.ok ? json({ ok: true }) : chatError(result.code);
};
