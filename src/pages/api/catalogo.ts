import type { APIRoute } from 'astro';
import { db } from '../../lib/server.ts';
import { json } from '../../lib/http.ts';
import { listActiveCatalog, listCategories } from '../../lib/catalog/catalog.ts';

/** Catálogo activo y categorías: lo necesitan el buscador al añadir artículos y «Se busca». */
export const GET: APIRoute = async () => {
  const database = await db();
  const [categories, items] = await Promise.all([listCategories(database, { onlyInUse: true }), listActiveCatalog(database)]);
  return json({ ok: true, categories, items });
};
