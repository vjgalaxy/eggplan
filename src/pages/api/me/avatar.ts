import type { APIRoute } from 'astro';
import { z } from 'zod';
import { availableAvatars, db } from '../../../lib/server.ts';
import { json, jsonError, parseBody } from '../../../lib/http.ts';
import { setAvatar } from '../../../lib/auth/service.ts';

const schema = z.object({ avatar: z.string().min(1).max(100) });

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return jsonError(401, 'unauthenticated', 'Tu sesión ha caducado. Vuelve a entrar.');
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;
  // Solo se acepta un identificador de la lista de avatares disponibles: nunca rutas libres.
  const result = await setAvatar(await db(), user.id, body.data.avatar, availableAvatars);
  if (!result.ok) return jsonError(400, 'invalid_avatar', 'Ese avatar no está disponible.');
  return json({ ok: true, avatar: body.data.avatar });
};
