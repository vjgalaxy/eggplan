import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db, getAppSecret, isProduction } from '../../../lib/server.ts';
import { loginResponse } from '../../../lib/auth/login-response.ts';
import { jsonError, parseBody } from '../../../lib/http.ts';
import { login } from '../../../lib/auth/service.ts';

const schema = z.object({ nick: z.string().min(1).max(40), password: z.string().min(1).max(200) });

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;
  const result = await login(await db(), {
    nick: body.data.nick,
    password: body.data.password,
    role: 'member',
    ip: clientAddress || undefined,
    secret: getAppSecret(),
  });
  return loginResponse(result, cookies, isProduction(), jsonError);
};
