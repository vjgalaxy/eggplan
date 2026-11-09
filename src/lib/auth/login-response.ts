import type { AstroCookies } from 'astro';
import { json } from '../http.ts';
import type { LoginResult } from './service.ts';
import { sessionCookieName, sessionCookieOptions } from './sessions.ts';

type ErrorFn = (status: number, code: string, message: string, extra?: Record<string, unknown>) => Response;

/** Traduce el resultado del login a respuesta HTTP (cookie de sesión incluida) con mensajes claros. */
export function loginResponse(result: LoginResult, cookies: AstroCookies, production: boolean, error: ErrorFn): Response {
  if (result.ok) {
    cookies.set(sessionCookieName(production), result.token, sessionCookieOptions(production, result.expiresAt));
    const home = result.user.mustChangePassword ? '/cambiar-clave' : result.user.role === 'admin' ? '/admin' : '/app';
    return json({ ok: true, redirect: home });
  }
  switch (result.code) {
    case 'locked': {
      const minutes = Math.max(1, Math.ceil(result.retryAfterSec / 60));
      const response = error(
        429,
        'locked',
        `Demasiados intentos. Por seguridad, espera ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} antes de probar otra vez.`,
        { retryAfterSec: result.retryAfterSec },
      );
      response.headers.set('Retry-After', String(result.retryAfterSec));
      return response;
    }
    case 'blocked':
      return error(403, 'blocked', 'Esta plaza está bloqueada. Habla con la administración.');
    case 'not_activated':
      return error(403, 'not_activated', 'Esta plaza aún no está activada. Pide tu código a la administración.');
    case 'invalid':
      return error(
        401,
        'invalid',
        result.remaining > 0 && result.remaining < 3
          ? `La clave no es correcta. Te quedan ${result.remaining} ${result.remaining === 1 ? 'intento' : 'intentos'}.`
          : 'La clave no es correcta. Revísala e inténtalo de nuevo.',
        { remaining: result.remaining },
      );
  }
}
