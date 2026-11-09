import type { ZodType } from 'zod';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

/** Error en lenguaje claro + código estable para la interfaz. */
export function jsonError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, code, message, ...extra }, status);
}

/** Lee y valida el cuerpo JSON. Devuelve la respuesta de error lista si no es válido. */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > 20_000) {
      return { ok: false, response: jsonError(413, 'too_large', 'La petición es demasiado grande.') };
    }
    raw = JSON.parse(text);
  } catch {
    return { ok: false, response: jsonError(400, 'bad_json', 'No hemos entendido los datos enviados.') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: jsonError(400, 'invalid', 'Revisa los datos: hay algo que no está bien.') };
  }
  return { ok: true, data: parsed.data };
}
