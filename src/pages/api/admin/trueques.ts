import type { APIRoute } from 'astro';
import { db } from '../../../lib/server.ts';
import { json, jsonError } from '../../../lib/http.ts';
import { listTradesMetadata } from '../../../lib/trades/metadata.ts';

/** Metadatos de los trueques (partes, estado, fechas, líneas y valores). El hilo de mensajes es privado y no está aquí. */
export const GET: APIRoute = async ({ locals }) => {
  if (locals.user?.role !== 'admin') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  return json({ ok: true, trades: await listTradesMetadata(await db()) });
};
