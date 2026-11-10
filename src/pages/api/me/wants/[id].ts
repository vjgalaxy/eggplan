import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../../../lib/server.ts';
import { json, jsonError, parseBody } from '../../../../lib/http.ts';
import { closeWant } from '../../../../lib/stock/wants.ts';
import { domainError } from '../../../../lib/stock/messages.ts';
import { routeId } from '../../../../lib/stock/schemas.ts';

const schema = z.object({ action: z.literal('close') });

/** Solo quien publicó la búsqueda puede quitarla. */
export const POST: APIRoute = async ({ request, locals, params }) => {
  const user = locals.user;
  if (user?.role !== 'member') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  const id = routeId(params['id']);
  if (id === null) return domainError('not_found');
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;
  const result = await closeWant(await db(), user.id, id);
  return result.ok ? json({ ok: true }) : domainError(result.code);
};
