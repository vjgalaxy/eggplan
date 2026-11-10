import type { APIRoute } from 'astro';
import { db } from '../../../lib/server.ts';
import { json, jsonError } from '../../../lib/http.ts';
import { listReviewQueue } from '../../../lib/stock/review.ts';

/** Cola «Artículos propios por revisar», los más antiguos primero. */
export const GET: APIRoute = async ({ locals }) => {
  if (locals.user?.role !== 'admin') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  return json({ ok: true, items: await listReviewQueue(await db()) });
};
