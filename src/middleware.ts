/**
 * Middleware global: sesión, autorización por rol, cambio de clave obligatorio, CSRF y cabeceras.
 * Nada del resto de la app se alcanza sin pasar por aquí (las rutas dinámicas siempre lo hacen).
 * Además, cada endpoint comprueba por su cuenta la propiedad del recurso (defensa en profundidad).
 */
import { defineMiddleware } from 'astro:middleware';
import { getDb } from './lib/db/index.ts';
import { resolveSession, sessionCookieName, sessionCookieOptions } from './lib/auth/sessions.ts';
import { toPublicUser } from './lib/auth/users.ts';
import { applySecurityHeaders } from './lib/security/headers.ts';
import { checkUnsafeRequest } from './lib/security/request.ts';
import { jsonError } from './lib/http.ts';
import { logServerError } from './lib/log.ts';

/** En desarrollo, sin `netlify dev` no hay base de datos: se dice claramente en vez de un 503 genérico. */
const DEV_NO_DB =
  'No hay base de datos: has arrancado Astro solo. Para desarrollar usa `npm run dev` (que lanza `netlify dev`) y entra por http://localhost:8888.';


const PUBLIC_PAGES = new Set(['/', '/admin/login']);
const PUBLIC_API = new Set(['/api/auth/login', '/api/auth/admin-login']);
/** Lo único permitido mientras queda pendiente elegir clave. */
const ALLOWED_WHILE_MUST_CHANGE = new Set(['/cambiar-clave', '/api/me/password', '/api/auth/logout']);

const homeFor = (role: 'member' | 'admin') => (role === 'admin' ? '/admin' : '/app');

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, cookies, locals } = context;
  const path = context.url.pathname.replace(/\/+$/, '') || '/';
  const isApi = path.startsWith('/api/');
  const production = import.meta.env.PROD;

  const finish = (response: Response): Response => {
    try {
      return applySecurityHeaders(response, { noStore: true });
    } catch {
      // Respuestas con cabeceras inmutables (p. ej. redirecciones estáticas): se copian.
      return applySecurityHeaders(new Response(response.body, response), { noStore: true });
    }
  };
  const deny = (status: number, code: string, message: string) =>
    isApi ? finish(jsonError(status, code, message)) : finish(new Response(message, { status }));
  const goto = (to: string) => finish(context.redirect(to, 303));

  locals.user = null;
  locals.tokenHash = null;

  // CSRF: mismo origen y application/json en todo lo que no sea GET.
  const csrf = checkUnsafeRequest(request.method, request.headers, request.url);
  if (!csrf.ok) {
    return deny(403, 'csrf', 'Petición no permitida. Recarga la página e inténtalo de nuevo.');
  }

  // Sesión
  const cookieName = sessionCookieName(production);
  const token = cookies.get(cookieName)?.value;
  if (token) {
    let resolved;
    try {
      resolved = await resolveSession(getDb(), token);
    } catch (error) {
      logServerError('sesión', error);
      const missingDb = (error as { name?: unknown } | null)?.name === 'MissingDatabaseConnectionError';
      return deny(503, 'db_unavailable', !production && missingDb ? DEV_NO_DB : 'El servicio no está disponible un momento. Inténtalo de nuevo en unos minutos.');
    }
    if (resolved) {
      locals.user = toPublicUser(resolved.user);
      locals.tokenHash = resolved.tokenHash;
      if (resolved.renewedUntil) cookies.set(cookieName, token, sessionCookieOptions(production, resolved.renewedUntil));
    } else {
      cookies.delete(cookieName, { path: '/' });
    }
  }

  const user = locals.user;
  const isPublic = PUBLIC_PAGES.has(path) || PUBLIC_API.has(path);

  if (!user) {
    if (isPublic) return finish(await next());
    if (isApi) return deny(401, 'unauthenticated', 'Tu sesión ha caducado. Vuelve a entrar.');
    return goto(path.startsWith('/admin') ? '/admin/login' : '/');
  }

  // Con sesión: primero, la clave pendiente de elegir bloquea todo lo demás.
  if (user.mustChangePassword && !ALLOWED_WHILE_MUST_CHANGE.has(path)) {
    return isApi ? deny(403, 'must_change_password', 'Antes de seguir tienes que elegir tu clave.') : goto('/cambiar-clave');
  }

  // Autorización por rol.
  const adminArea = path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/');
  const memberArea = path === '/app' || path.startsWith('/app/') || path.startsWith('/api/me/');
  if (adminArea && user.role !== 'admin') {
    return isApi ? deny(403, 'forbidden', 'No tienes permiso para esto.') : goto('/app');
  }
  if (memberArea && user.role !== 'member') {
    return isApi ? deny(403, 'forbidden', 'No tienes permiso para esto.') : goto('/admin');
  }

  // Quien ya ha entrado no necesita las pantallas de acceso.
  if (!isApi && isPublic) return goto(homeFor(user.role));

  return finish(await next());
});
