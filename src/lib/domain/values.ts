/**
 * Reglas de valor del stock (lógica pura, sin base de datos; se prueba aparte).
 * Todo en céntimos enteros de Berenjena (cB). Nunca float.
 *
 *  - Artículo del catálogo sin valor propio:  referencia × factor de estado.
 *  - Artículo del catálogo con valor propio:  min(valor propio, referencia × factor de estado).
 *  - Producto propio sin verificar:           su valor propio.
 *  - Producto propio verificado:              min(valor propio, valor verificado).
 * Una familia puede bajar el valor de sus artículos, nunca subirlo por encima del recomendado.
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
  if (v.refCb !== null) {
    const recommended = recommendedCb(v.refCb, v.tipo, v.condicion);
    return v.ownCb === null ? recommended : Math.min(v.ownCb, recommended);
  }
  const own = v.ownCb ?? 0;
  if (v.valueStatus === 'verificado' && v.verifiedCb !== null) return Math.min(own, v.verifiedCb);
  return own;
}

/** Tope que la familia no puede superar al fijar el valor de este artículo. */
export function maxAllowedCb(v: Pick<ValueInput, 'refCb' | 'tipo' | 'condicion' | 'valueStatus' | 'verifiedCb'>): number {
  const hardCap = config.productosPropios.valorMaximoPropio * config.moneda.centesimas;
  if (v.refCb !== null) return recommendedCb(v.refCb, v.tipo, v.condicion);
  if (v.valueStatus === 'verificado' && v.verifiedCb !== null) return Math.min(v.verifiedCb, hardCap);
  return hardCap;
}

export type ValueProblem = 'invalid' | 'value_too_high' | 'value_above_hard_cap' | 'value_above_verified' | 'needs_confirmation';

export type ValueCheck = { ok: true } | { ok: false; code: ValueProblem; maxCb?: number };

/** Valor propio de un artículo del catálogo: entero ≥ 0 y nunca por encima de referencia × factor. */
export function checkCatalogOwnValue(cb: number, refCb: number, tipo: Tipo, condicion: Condicion | null): ValueCheck {
  if (!Number.isInteger(cb) || cb < 0) return { ok: false, code: 'invalid' };
  const max = recommendedCb(refCb, tipo, condicion);
  if (cb > max) return { ok: false, code: 'value_too_high', maxCb: max };
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
