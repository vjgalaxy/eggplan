import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../../../lib/server.ts';
import { json, jsonError, parseBody } from '../../../../lib/http.ts';
import { renameSeat, setSeatBlocked } from '../../../../lib/auth/admin.ts';

const schema = z.union([
  z.object({ action: z.literal('block') }),
  z.object({ action: z.literal('unblock') }),
  z.object({ action: z.literal('rename'), nick: z.string().min(1).max(40) }),
]);

const messages = {
  not_found: [404, 'Esa plaza no existe.'],
  nick_invalid: [400, 'El nick debe ser una sola palabra, de 3 a 20 letras.'],
  nick_reserved: [400, 'Ese nick está reservado.'],
  nick_taken: [409, 'Ese nick ya lo usa otra plaza.'],
} as const;

export const POST: APIRoute = async ({ request, locals, params }) => {
  if (locals.user?.role !== 'admin') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  const seatId = Number(params['id']);
  if (!Number.isInteger(seatId) || seatId <= 0) return jsonError(404, 'not_found', 'Esa plaza no existe.');
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;

  const database = await db();
  const adminId = locals.user.id;
  const result =
    body.data.action === 'rename'
      ? await renameSeat(database, adminId, seatId, body.data.nick)
      : await setSeatBlocked(database, adminId, seatId, body.data.action === 'block');
  if (result.ok) return json({ ok: true });
  const [status, message] = messages[result.code];
  return jsonError(status, result.code, message);
};
