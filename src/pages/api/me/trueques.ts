import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../../lib/server.ts';
import { json, jsonError, parseBody } from '../../../lib/http.ts';
import { createTrade, listTrades } from '../../../lib/trades/trades.ts';
import { tradeError } from '../../../lib/trades/messages.ts';
import { lines, mensaje } from '../../../lib/trades/schemas.ts';

const schema = z.object({
  receiverId: z.number().int().positive(),
  doy: lines,
  recibo: lines,
  mensaje,
});

export const GET: APIRoute = async ({ locals }) => {
  if (locals.user?.role !== 'member') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  return json({ ok: true, trades: await listTrades(await db(), locals.user.id) });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (user?.role !== 'member') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;
  const result = await createTrade(await db(), user.id, body.data);
  return result.ok ? json({ ok: true, id: result.value.id }) : tradeError(result.code, result.detail);
};
