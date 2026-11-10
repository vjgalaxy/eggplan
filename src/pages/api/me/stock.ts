import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../../lib/server.ts';
import { json, jsonError, parseBody } from '../../../lib/http.ts';
import { addCatalogArticle, addCustomArticle, listMine } from '../../../lib/stock/stock.ts';
import { domainError } from '../../../lib/stock/messages.ts';
import { cb, condicion, date, notaStock, quantity, singleLine, tipo, unidadLibre } from '../../../lib/stock/schemas.ts';

const schema = z.discriminatedUnion('modo', [
  z.object({
    modo: z.literal('catalogo'),
    catalogItemId: z.number().int().positive(),
    cantidad: quantity,
    condicion: condicion.nullable().optional(),
    ownValueCb: cb.nullable().optional(),
    confirmado: z.boolean().optional(),
    caducaEl: date.nullable().optional(),
    nota: notaStock,
  }),
  z.object({
    modo: z.literal('propio'),
    nombre: singleLine(3, 60),
    tipo,
    categoria: z.string().min(1).max(60),
    unidad: unidadLibre,
    cantidad: quantity,
    condicion: condicion.nullable().optional(),
    valueCb: cb,
    confirmado: z.boolean().optional(),
    caducaEl: date.nullable().optional(),
    nota: notaStock,
  }),
]);

export const GET: APIRoute = async ({ locals }) => {
  if (locals.user?.role !== 'member') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  return json({ ok: true, items: await listMine(await db(), locals.user.id) });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (user?.role !== 'member') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;

  const database = await db();
  const { data } = body;
  const result =
    data.modo === 'catalogo'
      ? await addCatalogArticle(database, user.id, {
          catalogItemId: data.catalogItemId,
          cantidad: data.cantidad,
          condicion: data.condicion,
          ownValueCb: data.ownValueCb,
          confirmado: data.confirmado,
          caducaEl: data.caducaEl,
          nota: data.nota,
        })
      : await addCustomArticle(database, user.id, {
          nombre: data.nombre,
          tipo: data.tipo,
          categoria: data.categoria,
          unidad: data.unidad,
          cantidad: data.cantidad,
          condicion: data.condicion,
          valueCb: data.valueCb,
          confirmado: data.confirmado,
          caducaEl: data.caducaEl,
          nota: data.nota,
        });
  if (!result.ok) return domainError(result.code, result.maxCb);
  return json({ ok: true, id: result.value.id });
};
