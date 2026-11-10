import { t } from '../../i18n/es.ts';
import { formatB } from '../format.ts';
import { jsonError } from '../http.ts';

const STATUS: Record<string, number> = {
  not_found: 404,
  catalog_item_not_found: 404,
  catalog_item_inactive: 409,
  duplicate: 409,
  limit: 409,
  quantity_below_reserved: 409,
  reserved: 409,
  undo_expired: 409,
  hidden_by_admin: 409,
  needs_confirmation: 409,
  in_use: 409,
};

/** Respuesta JSON de error para un código del dominio (stock, búsquedas, catálogo, revisión). */
export function domainError(code: string, maxCb?: number): Response {
  const e = t.erroresStock as Record<string, unknown>;
  const key = code === 'in_use' ? 'productoEnUso' : code;
  const entry = e[key];
  const max = maxCb === undefined ? '' : formatB(maxCb);
  const message =
    typeof entry === 'function' ? (entry as (m: string) => string)(max) : typeof entry === 'string' ? entry : t.comun.errorGenerico;
  return jsonError(STATUS[code] ?? 400, code, message, maxCb === undefined ? {} : { maxCb });
}
