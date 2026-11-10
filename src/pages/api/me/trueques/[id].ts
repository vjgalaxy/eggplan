import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../../../lib/server.ts';
import { json, jsonError, parseBody } from '../../../../lib/http.ts';
import { acceptTrade, cancelTrade, counterTrade, getTrade, markDelivered, markReturned, postMessage, rejectTrade } from '../../../../lib/trades/trades.ts';
import { tradeError } from '../../../../lib/trades/messages.ts';
import { lines, mensaje } from '../../../../lib/trades/schemas.ts';
import { routeId } from '../../../../lib/stock/schemas.ts';
import { config } from '../../../../data/config.ts';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept') }),
  z.object({ action: z.literal('reject') }),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('delivered') }),
  z.object({ action: z.literal('returned'), lineId: z.number().int().positive() }),
  z.object({ action: z.literal('message'), cuerpo: z.string().max(config.propuestas.maxCaracteresMensaje * 2) }),
  z.object({ action: z.literal('counter'), doy: lines, recibo: lines, mensaje }),
]);

/** Una propuesta con su hilo. Solo para sus dos partes; para cualquier otra persona, 404 (IDOR). */
export const GET: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (user?.role !== 'member') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  const id = routeId(params['id']);
  const trade = id === null ? null : await getTrade(await db(), user.id, id);
  if (!trade) return tradeError('not_found');
  return json({ ok: true, trade });
};

export const POST: APIRoute = async ({ request, locals, params }) => {
  const user = locals.user;
  if (user?.role !== 'member') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  const id = routeId(params['id']);
  if (id === null) return tradeError('not_found');
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;

  const database = await db();
  const { data } = body;
  switch (data.action) {
    case 'accept': {
      const r = await acceptTrade(database, user.id, id);
      return r.ok ? json({ ok: true }) : tradeError(r.code, r.detail);
    }
    case 'reject': {
      const r = await rejectTrade(database, user.id, id);
      return r.ok ? json({ ok: true }) : tradeError(r.code, r.detail);
    }
    case 'cancel': {
      const r = await cancelTrade(database, user.id, id);
      return r.ok ? json({ ok: true }) : tradeError(r.code, r.detail);
    }
    case 'delivered': {
      const r = await markDelivered(database, user.id, id);
      return r.ok ? json({ ok: true, completed: r.value.completed }) : tradeError(r.code, r.detail);
    }
    case 'returned': {
      const r = await markReturned(database, user.id, id, data.lineId);
      return r.ok ? json({ ok: true }) : tradeError(r.code, r.detail);
    }
    case 'message': {
      const r = await postMessage(database, user.id, id, data.cuerpo);
      return r.ok ? json({ ok: true }) : tradeError(r.code, r.detail);
    }
    case 'counter': {
      const r = await counterTrade(database, user.id, id, { doy: data.doy, recibo: data.recibo, mensaje: data.mensaje });
      return r.ok ? json({ ok: true, id: r.value.id }) : tradeError(r.code, r.detail);
    }
  }
};
