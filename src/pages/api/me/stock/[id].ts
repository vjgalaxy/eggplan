import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../../../lib/server.ts';
import { json, jsonError, parseBody } from '../../../../lib/http.ts';
import { changeArticleState, undoDelete, updateArticle } from '../../../../lib/stock/stock.ts';
import { domainError } from '../../../../lib/stock/messages.ts';
import { cb, condicion, date, notaStock, quantityOrZero, routeId } from '../../../../lib/stock/schemas.ts';

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    cantidad: quantityOrZero.optional(),
    condicion: condicion.optional(),
    ownValueCb: cb.nullable().optional(),
    confirmado: z.boolean().optional(),
    caducaEl: date.nullable().optional(),
    nota: notaStock,
  }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('delete') }),
  z.object({ action: z.literal('undo') }),
]);

/** Cada acción comprueba en el servidor que el artículo es de la persona con sesión. */
export const POST: APIRoute = async ({ request, locals, params }) => {
  const user = locals.user;
  if (user?.role !== 'member') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  const id = routeId(params['id']);
  if (id === null) return domainError('not_found');
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;

  const database = await db();
  const { data } = body;
  const result =
    data.action === 'update'
      ? await updateArticle(database, user.id, id, {
          cantidad: data.cantidad,
          condicion: data.condicion,
          ownValueCb: data.ownValueCb,
          confirmado: data.confirmado,
          caducaEl: data.caducaEl,
          nota: data.nota,
        })
      : data.action === 'undo'
        ? await undoDelete(database, user.id, id)
        : await changeArticleState(database, user.id, id, data.action);
  if (!result.ok) return domainError(result.code, result.maxCb);
  return json({ ok: true });
};
