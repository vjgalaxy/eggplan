import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../../lib/server.ts';
import { json, jsonError, parseBody } from '../../../lib/http.ts';
import { issueInitialCodes } from '../../../lib/auth/admin.ts';

const schema = z.union([z.object({ seatId: z.number().int().positive() }), z.object({ onlyMissing: z.literal(true) })]);

/** Los códigos se devuelven UNA sola vez en esta respuesta; en la base de datos solo queda el hash. */
export const POST: APIRoute = async ({ request, locals }) => {
  if (locals.user?.role !== 'admin') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;
  const codes = await issueInitialCodes(await db(), locals.user.id, body.data);
  if (codes.length === 0) {
    return jsonError(404, 'nothing_to_do', 'No hay plazas pendientes de código.');
  }
  return json({ ok: true, codes });
};
