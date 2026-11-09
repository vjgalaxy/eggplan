import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db/index.ts';
import { json } from '../../../lib/http.ts';
import { revokeSession, sessionCookieName } from '../../../lib/auth/sessions.ts';
import { isProduction } from '../../../lib/server.ts';

export const POST: APIRoute = async ({ cookies }) => {
  const name = sessionCookieName(isProduction());
  const token = cookies.get(name)?.value;
  if (token) await revokeSession(getDb(), token);
  cookies.delete(name, { path: '/' });
  return json({ ok: true, redirect: '/' });
};
