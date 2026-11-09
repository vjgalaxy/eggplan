/**
 * Comprobaciones CSRF para peticiones que modifican datos: además de SameSite=Lax en la cookie,
 * toda petición que no sea GET/HEAD/OPTIONS debe venir del mismo origen y ser application/json.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type OriginCheck = { ok: true } | { ok: false; reason: 'origin' | 'content-type' };

export function checkUnsafeRequest(
  method: string,
  headers: { get(name: string): string | null },
  requestUrl: string,
): OriginCheck {
  if (SAFE_METHODS.has(method.toUpperCase())) return { ok: true };

  const origin = headers.get('origin');
  const expected = new URL(requestUrl).origin;
  if (!origin || origin !== expected) return { ok: false, reason: 'origin' };

  const contentType = (headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') return { ok: false, reason: 'content-type' };

  return { ok: true };
}
