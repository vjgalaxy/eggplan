import { t } from '../i18n/es.ts';

export interface ApiResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T & { ok?: boolean; code?: string; message?: string; redirect?: string };
}

/** Llamada JSON al servidor. Nunca lanza: los fallos de red se devuelven como resultado con mensaje claro. */
export async function api<T = Record<string, unknown>>(
  url: string,
  options: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<ApiResult<T>> {
  try {
    const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
    const init: RequestInit = { method, credentials: 'same-origin' };
    if (method !== 'GET') {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(options.body ?? {});
    }
    const response = await fetch(url, init);
    let data: ApiResult<T>['data'];
    try {
      data = (await response.json()) as ApiResult<T>['data'];
    } catch {
      // Respuesta sin JSON (p. ej. una página de error del servidor o de un proxy): mensaje claro según el estado.
      const message =
        response.status === 404 ? t.comun.noEncontrado : response.status === 403 ? t.erroresStock.sin_permiso : t.comun.errorGenerico;
      data = { message } as ApiResult<T>['data'];
    }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { message: t.comun.errorRed } as ApiResult<T>['data'] };
  }
}

export function go(url: string): void {
  window.location.assign(url);
}
