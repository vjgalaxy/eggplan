import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../../lib/server.ts';
import { jsonError, json, parseBody } from '../../../lib/http.ts';
import { changePassword } from '../../../lib/auth/service.ts';

const schema = z.object({
  current: z.string().max(200).optional(),
  next: z.string().min(1).max(200),
  repeat: z.string().min(1).max(200),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user || !locals.tokenHash) return jsonError(401, 'unauthenticated', 'Tu sesión ha caducado. Vuelve a entrar.');
  if (user.role === 'admin') {
    return jsonError(403, 'forbidden', 'La clave del admin se cambia en la variable de entorno ADMIN_PASSWORD.');
  }
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;

  const result = await changePassword(await db(), {
    userId: user.id,
    nick: user.nick,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    currentTokenHash: locals.tokenHash,
    currentPassword: body.data.current,
    newPassword: body.data.next,
    repeatPassword: body.data.repeat,
  });
  if (result.ok) return json({ ok: true, redirect: '/app' });
  if (result.code === 'wrong_current') {
    return jsonError(400, 'wrong_current', 'La clave actual no es correcta.');
  }
  return jsonError(400, 'problems', 'La clave nueva no es válida.', { problems: result.problems });
};
