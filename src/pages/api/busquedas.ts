import type { APIRoute } from 'astro';
import { db } from '../../lib/server.ts';
import { json } from '../../lib/http.ts';
import { listOpenWants } from '../../lib/stock/wants.ts';

/** «Se busca»: las búsquedas abiertas de todas las familias. */
export const GET: APIRoute = async () => {
  return json({ ok: true, wants: await listOpenWants(await db()) });
};
