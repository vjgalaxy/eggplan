import type { APIRoute } from 'astro';
import { db } from '../../../../../lib/server.ts';
import { json, jsonError } from '../../../../../lib/http.ts';
import { itemHistory } from '../../../../../lib/catalog/catalog.ts';
import { domainError } from '../../../../../lib/stock/messages.ts';
import { routeId } from '../../../../../lib/stock/schemas.ts';

export const GET: APIRoute = async ({ locals, params }) => {
  if (locals.user?.role !== 'admin') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  const id = routeId(params['id']);
  if (id === null) return domainError('not_found');
  return json({ ok: true, history: await itemHistory(await db(), id) });
};
