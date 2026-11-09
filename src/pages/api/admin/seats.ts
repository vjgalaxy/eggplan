import type { APIRoute } from 'astro';
import { db } from '../../../lib/server.ts';
import { json, jsonError } from '../../../lib/http.ts';
import { listSeats } from '../../../lib/auth/admin.ts';

export const GET: APIRoute = async ({ locals }) => {
  if (locals.user?.role !== 'admin') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  return json({ ok: true, seats: await listSeats(await db()) });
};
