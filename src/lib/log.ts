/**
 * Registro de errores del servidor para los logs de las funciones de Netlify.
 * Solo se escribe el contexto, el tipo y el mensaje del error: nunca el objeto completo
 * (podría arrastrar cadenas de conexión, parámetros de consultas o secretos).
 */
export function logServerError(context: string, error: unknown): void {
  const err = error as { name?: unknown; message?: unknown; code?: unknown } | null;
  const name = typeof err?.name === 'string' ? err.name : typeof error;
  const code = typeof err?.code === 'string' ? ` [${err.code}]` : '';
  const message = typeof err?.message === 'string' ? err.message : String(error);
  console.error(`[eggplan] ${context}: ${name}${code}: ${message.slice(0, 500)}`);
}
