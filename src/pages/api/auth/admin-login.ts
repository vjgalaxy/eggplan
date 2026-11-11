import type { APIRoute } from 'astro';
import { z } from 'zod';
import { config, db, getAdminPassword, getAppSecret, isProduction } from '../../../lib/server.ts';
import { loginResponse } from '../../../lib/auth/login-response.ts';
import { jsonError, parseBody } from '../../../lib/http.ts';
import { login } from '../../../lib/auth/service.ts';

const schema = z.object({ password: z.string().min(1).max(200) });

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;
  const result = await login(await db(), {
    nick: config.acceso.nickAdmin,
    password: body.data.password,
    role: 'admin',
    ip: clientAddress || undefined,
    secret: getAppSecret(),
    adminPassword: getAdminPassword(),
  });
  return loginResponse(result, cookies, isProduction(), jsonError);
};
