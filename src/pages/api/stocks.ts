import type { APIRoute } from 'astro';
import { db } from '../../lib/server.ts';
import { json } from '../../lib/http.ts';
import { listVisible } from '../../lib/stock/stock.ts';

/**
 * Stocks de todas las familias, tal y como los ve cualquier familia con sesión: sin artículos
 * pausados ni borrados (la consulta del servidor los filtra). La administración también ve los pausados.
 */
export const GET: APIRoute = async ({ locals }) => {
  const result = await listVisible(await db(), { includeAll: locals.user?.role === 'admin' });
  return json({ ok: true, ...result });
};
