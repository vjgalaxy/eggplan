import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../lib/server.ts';
import { json, jsonError, parseBody } from '../../lib/http.ts';
import { listMessages, postChatMessage } from '../../lib/chat/chat.ts';
import { chatError } from '../../lib/chat/messages.ts';
import { config } from '../../data/config.ts';

const positiveInt = (value: string | null): number | undefined => {
  const n = Number(value);
  return value !== null && Number.isInteger(n) && n > 0 ? n : undefined;
};

/**
 * La Plaza (familias y administración, siempre con sesión).
 * `?since=<id>`: lo nuevo (sondeo) · `?before=<id>`: «cargar anteriores» · `&deletedSince=<iso>`: borrados desde entonces.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) return jsonError(401, 'unauthenticated', 'Tu sesión ha caducado. Vuelve a entrar.');
  const page = await listMessages(await db(), {
    since: positiveInt(url.searchParams.get('since')),
    before: positiveInt(url.searchParams.get('before')),
    deletedSince: url.searchParams.get('deletedSince') ?? undefined,
  });
  return json({ ok: true, ...page });
};

const schema = z.object({
  cuerpo: z.string().max(config.chat.maxCaracteres * 4),
  /** Id del mensaje al que se responde (opcional). */
  respuestaA: z.number().int().positive().nullable().optional(),
});

/** Publica un mensaje; si escribe la administración, es un anuncio. */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return jsonError(401, 'unauthenticated', 'Tu sesión ha caducado. Vuelve a entrar.');
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;
  const result = await postChatMessage(await db(), user, body.data.cuerpo, body.data.respuestaA);
  return result.ok ? json({ ok: true, message: result.value.message }) : chatError(result.code, result.retryAfterSec);
};
