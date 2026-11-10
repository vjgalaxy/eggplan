import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../../lib/server.ts';
import { json, jsonError, parseBody } from '../../../lib/http.ts';
import { createCatalogItem, listAllCatalog, listCategories } from '../../../lib/catalog/catalog.ts';
import { domainError } from '../../../lib/stock/messages.ts';
import { cb, optionalText, singleLine, tipo } from '../../../lib/stock/schemas.ts';

const schema = z.object({
  nombre: singleLine(2, 120),
  categoria: z.string().min(1).max(60),
  tipo,
  unidad: singleLine(1, 40),
  refCb: cb,
  perecedero: z.boolean().default(false),
  activo: z.boolean().default(true),
  nota: optionalText(300).transform((v) => v ?? null),
});

export const GET: APIRoute = async ({ locals }) => {
  if (locals.user?.role !== 'admin') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  const database = await db();
  const [categories, items] = await Promise.all([listCategories(database), listAllCatalog(database)]);
  return json({ ok: true, categories, items });
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (locals.user?.role !== 'admin') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;
  const result = await createCatalogItem(await db(), locals.user.id, body.data);
  if (!result.ok) return domainError(result.code);
  return json({ ok: true, id: result.id });
};
