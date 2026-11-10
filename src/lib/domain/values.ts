/**
 * Reglas de valor del stock (lógica pura, sin base de datos; se prueba aparte).
 * Todo en céntimos enteros de Berenjena (cB). Nunca float.
 *
 *  - Artículo del catálogo sin valor propio:  referencia × factor de estado (el recomendado).
 *  - Artículo del catálogo con valor propio:  su valor propio (la familia puede subirlo o bajarlo).
 *  - Producto propio sin verificar:           su valor propio.
 *  - Producto propio verificado:              min(valor propio, valor verificado).
 * Todo valor propio tiene un tope duro y pide confirmación si es muy alto (ver `checkCustomValue`).
 * Decisión de la persona responsable del proyecto: el valor propio de un artículo del catálogo ya
 * no está limitado por el recomendado (la especificación original solo permitía bajarlo).
 */
import { config } from '../../data/config.ts';

export type Tipo = 'bien' | 'servicio' | 'prestamo';
export type Condicion = keyof typeof config.factoresEstado;
export type ValueStatus = 'catalogo' | 'sin_verificar' | 'verificado';

export const CONDICIONES = Object.keys(config.factoresEstado) as Condicion[];

/** Factor de estado en porcentaje entero (1,00 → 100) para operar siempre con enteros. */
const factorPct = (condicion: Condicion): number => Math.round(config.factoresEstado[condicion] * 100);

/** Valor recomendado de un artículo del catálogo: referencia × factor (solo los bienes tienen estado). */
export function recommendedCb(refCb: number, tipo: Tipo, condicion: Condicion | null): number {
  if (tipo !== 'bien') return refCb;
  return Math.round((refCb * factorPct(condicion ?? 'nuevo')) / 100);
}

export interface ValueInput {
  /** Valor de referencia del producto del catálogo; null en un producto propio. */
  refCb: number | null;
  tipo: Tipo;
  condicion: Condicion | null;
  ownCb: number | null;
  valueStatus: ValueStatus;
  verifiedCb: number | null;
}

/** Valor efectivo por unidad, el que ven todas las familias. */
export function effectiveCb(v: ValueInput): number {
  if (v.refCb !== null) return v.ownCb ?? recommendedCb(v.refCb, v.tipo, v.condicion);
  const own = v.ownCb ?? 0;
  if (v.valueStatus === 'verificado' && v.verifiedCb !== null) return Math.min(own, v.verifiedCb);
  return own;
}

/** Valor máximo que puede poner la familia a este artículo (tope duro; el verificado, si lo hay). */
export function maxAllowedCb(v: Pick<ValueInput, 'refCb' | 'valueStatus' | 'verifiedCb'>): number {
  const hardCap = config.productosPropios.valorMaximoPropio * config.moneda.centesimas;
  if (v.refCb === null && v.valueStatus === 'verificado' && v.verifiedCb !== null) return Math.min(v.verifiedCb, hardCap);
  return hardCap;
}

export type ValueProblem = 'invalid' | 'value_above_hard_cap' | 'value_above_verified' | 'needs_confirmation';

export type ValueCheck = { ok: true } | { ok: false; code: ValueProblem; maxCb?: number };

/**
 * Valor propio de un artículo del catálogo: entero ≥ 0, con tope duro. Puede estar por encima o
 * por debajo del recomendado; solo pide confirmación si supera el umbral Y el recomendado
 * (así no se pregunta por un artículo caro cuyo recomendado ya es alto).
 */
export function checkCatalogOwnValue(cb: number, recommended: number, confirmed: boolean): ValueCheck {
  if (!Number.isInteger(cb) || cb < 0) return { ok: false, code: 'invalid' };
  const hardCap = config.productosPropios.valorMaximoPropio * config.moneda.centesimas;
  if (cb > hardCap) return { ok: false, code: 'value_above_hard_cap', maxCb: hardCap };
  const confirmAbove = config.productosPropios.confirmarValorMayorQue * config.moneda.centesimas;
  if (cb > confirmAbove && cb > recommended && !confirmed) return { ok: false, code: 'needs_confirmation', maxCb: confirmAbove };
  return { ok: true };
}

/**
 * Valor de un producto propio: entero ≥ 0, con tope duro, pidiendo confirmación por encima del
 * umbral y, una vez verificado, sin poder superar el valor verificado.
 */
export function checkCustomValue(
  cb: number,
  options: { valueStatus: ValueStatus; verifiedCb: number | null; confirmed: boolean },
): ValueCheck {
  if (!Number.isInteger(cb) || cb < 0) return { ok: false, code: 'invalid' };
  const hardCap = config.productosPropios.valorMaximoPropio * config.moneda.centesimas;
  if (cb > hardCap) return { ok: false, code: 'value_above_hard_cap', maxCb: hardCap };
  if (options.valueStatus === 'verificado' && options.verifiedCb !== null && cb > options.verifiedCb) {
    return { ok: false, code: 'value_above_verified', maxCb: options.verifiedCb };
  }
  const confirmAbove = config.productosPropios.confirmarValorMayorQue * config.moneda.centesimas;
  if (cb > confirmAbove && !options.confirmed) return { ok: false, code: 'needs_confirmation', maxCb: confirmAbove };
  return { ok: true };
}
