import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../../../lib/server.ts';
import { json, jsonError, parseBody } from '../../../../lib/http.ts';
import { applyReview, type ReviewAction } from '../../../../lib/stock/review.ts';
import { domainError } from '../../../../lib/stock/messages.ts';
import { cb, routeId, singleLine } from '../../../../lib/stock/schemas.ts';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('verify') }),
  z.object({ action: z.literal('adjust'), valueCb: cb }),
  z.object({ action: z.literal('link'), catalogItemId: z.number().int().positive() }),
  z.object({
    action: z.literal('create'),
    nombre: singleLine(2, 120).optional(),
    categoria: z.string().min(1).max(60).optional(),
    unidad: singleLine(1, 40).optional(),
    refCb: cb.optional(),
  }),
  z.object({ action: z.literal('hide'), motivo: singleLine(3, 200) }),
]);

export const POST: APIRoute = async ({ request, locals, params }) => {
  if (locals.user?.role !== 'admin') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  const id = routeId(params['id']);
  if (id === null) return domainError('not_found');
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;
  const result = await applyReview(await db(), locals.user.id, id, body.data as ReviewAction);
  return result.ok ? json({ ok: true }) : domainError(result.code);
};
