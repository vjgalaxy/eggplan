/** Esquemas zod compartidos por los endpoints de stock, búsquedas, catálogo y revisión. */
import { z } from 'zod';
import { config } from '../../data/config.ts';
import { CONDICIONES } from '../domain/values.ts';

const twoDecimals = (n: number) => Math.abs(Math.round(n * 100) / 100 - n) < 1e-9;

export const quantity = z
  .number()
  .positive()
  .max(config.stock.cantidadMax)
  .refine(twoDecimals, 'Como máximo dos decimales');

/** Cantidad que puede quedar a cero (editar un artículo agotado). */
export const quantityOrZero = z
  .number()
  .min(0)
  .max(config.stock.cantidadMax)
  .refine(twoDecimals, 'Como máximo dos decimales');

/** Importe en céntimos de Berenjena (entero). */
export const cb = z.number().int().min(0).max(100_000_000);

export const condicion = z.enum(CONDICIONES as [string, ...string[]]) as unknown as z.ZodType<
  'nuevo' | 'bueno' | 'usado' | 'para_reparar'
>;

export const tipo = z.enum(['bien', 'servicio', 'prestamo']);

export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Texto opcional: la cadena vacía cuenta como «sin texto». */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));

export const singleLine = (min: number, max: number) =>
  z
    .string()
    .transform((v) => v.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(min).max(max));

export const notaStock = optionalText(config.stock.notaMax);

export const unidadLibre = singleLine(1, config.stock.unidadOtraMax);

/** id numérico de la ruta, o null si no es válido. */
export function routeId(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
