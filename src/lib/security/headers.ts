/**
 * Cabeceras de seguridad de las respuestas dinámicas (SSR y API). Las respuestas estáticas
 * (avatares, robots.txt…) las cubre netlify.toml con las mismas cabeceras comunes.
 *
 * CSP: Astro añade por <meta> `default-src/script-src/style-src` con hashes de sus scripts y
 * estilos en línea (islas de Vue). Aquí se envían por cabecera las directivas que NO funcionan
 * en <meta> (`frame-ancestors`) y las que restringen el resto de recursos. Las dos políticas se
 * aplican a la vez (gana la más restrictiva). Sin `default-src` aquí para no bloquear los
 * scripts en línea con hash que gestiona el <meta>.
 */
export const COMMON_HEADERS: Record<string, string> = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy':
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export const CSP_HEADER =
  "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; " +
  "img-src 'self' data:; connect-src 'self'; font-src 'self'; manifest-src 'self'";

/** Añade las cabeceras a una respuesta (modificable) sin pisar las que ya existan. */
export function applySecurityHeaders(response: Response, opts: { noStore: boolean }): Response {
  const headers = response.headers;
  for (const [name, value] of Object.entries(COMMON_HEADERS)) headers.set(name, value);
  headers.set('Content-Security-Policy', mergeCsp(headers.get('Content-Security-Policy')));
  if (opts.noStore) headers.set('Cache-Control', 'no-store');
  return response;
}

function mergeCsp(existing: string | null): string {
  return existing ? `${existing}; ${CSP_HEADER}` : CSP_HEADER;
}
