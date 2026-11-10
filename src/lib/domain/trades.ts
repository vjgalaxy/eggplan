/**
 * Reglas puras de los trueques: totales en Berenjenas (enteros en cB) y resumen
 * «Tú das · Recibes · Diferencia». Sin base de datos.
 */

/** Total de una línea = valor por unidad × cantidad, redondeado a cB con aritmética entera. */
export function lineTotalCb(unitCb: number, quantity: number): number {
  const hundredths = Math.round(quantity * 100); // cantidades con hasta dos decimales
  return Math.floor((unitCb * hundredths + 50) / 100);
}

export interface SummaryLine {
  /** Quién da esta línea. */
  lado: 'proposer' | 'receiver';
  valueCb: number;
  cantidad: number;
  unverified: boolean;
}

export interface TradeSummary {
  /** Lo que da la persona que mira. */
  giveCb: number;
  /** Lo que recibe la persona que mira. */
  receiveCb: number;
  /** receive − give: positivo = sale ganando; negativo = da más de lo que recibe. */
  diffCb: number;
  /** Alguna línea incluye un producto propio con valor sin verificar. */
  includesUnverified: boolean;
}

/** Resumen desde el punto de vista de `me`. Informativo: nunca bloquea una propuesta. */
export function summarize(lines: readonly SummaryLine[], me: 'proposer' | 'receiver'): TradeSummary {
  let give = 0;
  let receive = 0;
  let unverified = false;
  for (const line of lines) {
    const total = lineTotalCb(line.valueCb, line.cantidad);
    if (line.lado === me) give += total;
    else receive += total;
    if (line.unverified) unverified = true;
  }
  return { giveCb: give, receiveCb: receive, diffCb: receive - give, includesUnverified: unverified };
}

export const OPEN_STATES = ['pendiente', 'aceptada'] as const;
export const FINAL_STATES = ['rechazada', 'cancelada', 'caducada', 'contraofertada', 'completada'] as const;
export type TradeState = (typeof OPEN_STATES)[number] | (typeof FINAL_STATES)[number];
