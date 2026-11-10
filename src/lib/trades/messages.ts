import { config } from '../../data/config.ts';
import { t } from '../../i18n/es.ts';
import { jsonError } from '../http.ts';
import type { TradeError } from './trades.ts';

const STATUS: Record<TradeError, number> = {
  not_found: 404,
  invalid: 400,
  receiver_unavailable: 409,
  item_not_found: 409,
  item_unavailable: 409,
  insufficient_stock: 409,
  limit_pending: 409,
  too_many_lines: 400,
  not_pending: 409,
  not_open: 409,
  not_accepted: 409,
  expired: 409,
  forbidden_action: 403,
  thread_closed: 409,
  message_limit: 409,
  not_loan: 400,
  already_returned: 409,
};

/** Respuesta JSON de error para un código de los trueques. */
export function tradeError(code: TradeError, detail?: string): Response {
  const entry = t.erroresTrueque[code];
  let message: string;
  if (typeof entry === 'string') message = entry;
  else if (code === 'limit_pending') message = t.erroresTrueque.limit_pending(config.propuestas.maxPendientesPorFamilia);
  else if (code === 'too_many_lines') message = t.erroresTrueque.too_many_lines(config.propuestas.maxLineasPorLado);
  else if (code === 'item_unavailable') message = t.erroresTrueque.item_unavailable(detail ?? '');
  else message = t.erroresTrueque.insufficient_stock(detail ?? '');
  return jsonError(STATUS[code], code, message);
}
