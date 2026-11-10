import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../../lib/server.ts';
import { json, jsonError, parseBody } from '../../../lib/http.ts';
import { createWant } from '../../../lib/stock/wants.ts';
import { domainError } from '../../../lib/stock/messages.ts';
import { optionalText, quantity, singleLine, unidadLibre } from '../../../lib/stock/schemas.ts';
import { config } from '../../../data/config.ts';
import { t } from '../../../i18n/es.ts';

const schema = z.object({
  catalogItemId: z.number().int().positive().nullable().optional(),
  textoLibre: singleLine(config.busquedas.textoMin, config.busquedas.textoMax).nullable().optional(),
  cantidad: quantity.nullable().optional(),
  unidad: unidadLibre.nullable().optional(),
  nota: optionalText(config.stock.notaMax),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (user?.role !== 'member') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;
  const result = await createWant(await db(), user.id, body.data);
  if (!result.ok) {
    if (result.code === 'limit') return jsonError(409, 'limit', t.erroresStock.busquedaLimite);
    if (result.code === 'invalid') return jsonError(400, 'invalid', t.erroresStock.busquedaInvalida);
    return domainError(result.code);
  }
  return json({ ok: true, id: result.id });
};
