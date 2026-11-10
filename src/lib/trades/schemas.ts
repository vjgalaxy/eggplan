import { z } from 'zod';
import { config } from '../../data/config.ts';
import { optionalText, quantity } from '../stock/schemas.ts';

/** Líneas de una propuesta: artículo + cantidad. Todo se vuelve a validar en el servidor. */
export const lines = z
  .array(z.object({ stockItemId: z.number().int().positive(), cantidad: quantity }))
  .max(config.propuestas.maxLineasPorLado);

export const mensaje = optionalText(config.propuestas.maxCaracteresMensaje);
