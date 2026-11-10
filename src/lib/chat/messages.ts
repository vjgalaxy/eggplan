import { t } from '../../i18n/es.ts';
import { jsonError } from '../http.ts';
import type { ChatError } from './chat.ts';

const STATUS: Record<ChatError, number> = {
  empty: 400,
  too_long: 400,
  too_fast: 429,
  too_many: 429,
  not_found: 404,
  forbidden: 403,
  blocked: 403,
  reply_not_found: 409,
};

export function chatError(code: ChatError, retryAfterSec?: number): Response {
  const message = code === 'too_fast' ? t.plaza.errores.too_fast(retryAfterSec ?? 2) : t.plaza.errores[code];
  return jsonError(STATUS[code], code, message, retryAfterSec === undefined ? {} : { retryAfterSec });
}
