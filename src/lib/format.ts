/**
 * Formato y lectura de importes y cantidades. Sin dependencias del servidor: lo usan también las
 * islas de Vue. Los importes viajan siempre como enteros en céntimos de Berenjena (cB).
 */
import { config } from '../data/config.ts';

const { simbolo, centesimas } = config.moneda;

/** 425 → «4,25 B»; 400 → «4 B»; 25 → «0,25 B». Hasta dos decimales, sin ceros sobrantes. */
export function formatB(cb: number): string {
  const negative = cb < 0;
  const abs = Math.abs(cb);
  const whole = Math.trunc(abs / centesimas);
  const frac = abs % centesimas;
  const decimals = frac === 0 ? '' : `,${String(frac).padStart(2, '0').replace(/0$/, '')}`;
  return `${negative ? '−' : ''}${whole}${decimals} ${simbolo}`;
}

/** «4», «4,5» o «4.25» → cB entero. Devuelve null si no es un importe válido (más de 2 decimales, texto…). */
export function parseB(input: string): number | null {
  const match = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const frac = Number((match[2] ?? '').padEnd(2, '0') || '0');
  return whole * centesimas + frac;
}

/** Cantidad con hasta dos decimales: 2.5 → «2,5»; 12 → «12». */
export function formatQty(value: number): string {
  return String(Math.round(value * 100) / 100).replace('.', ',');
}

/** 425 → «4,25»; 400 → «4». Para rellenar campos de importe (sin el símbolo). */
export function formatCbInput(cb: number): string {
  return formatB(cb).replace(/\s*B$/, '');
}

/** «2026-03-05» o una marca de tiempo ISO → «5 mar 2026». */
export function formatDate(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(date);
}

/** «2», «2,5» o «2.25» → número con hasta dos decimales, o null. */
export function parseQty(input: string): number | null {
  const match = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  return Number(`${match[1]}.${match[2] ?? '0'}`);
}
