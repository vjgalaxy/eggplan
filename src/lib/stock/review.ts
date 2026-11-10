/**
 * Cola de revisión de la administración: «Artículos propios por revisar». Es solo supervisión:
 * no bloquea nada (los productos propios se publican al instante). Cada acción avisa a la
 * familia (aviso privado) y queda en la auditoría.
 */
import type { Db, Queryable } from '../db/index.ts';
import { config } from '../../data/config.ts';
import { audit } from '../auth/admin.ts';
import { insertCatalogItem } from '../catalog/catalog.ts';
import { notify } from '../notifications.ts';
import { isUniqueViolation } from './stock.ts';
import type { Condicion, Tipo } from '../domain/values.ts';

export interface ReviewItem {
  id: number;
  userId: number;
  nick: string;
  avatar: string | null;
  nombre: string;
  categoria: string;
  tipo: Tipo;
  unidad: string;
  cantidad: number;
  condicion: Condicion | null;
  valueCb: number;
  nota: string | null;
  createdAt: string;
}

interface RawReview {
  id: number;
  user_id: number;
  nick: string;
  avatar: string | null;
  custom_name: string;
  custom_category: string;
  tipo: Tipo;
  unidad: string;
  cantidad: number;
  condicion: Condicion | null;
  own_value_cb: number;
  nota: string | null;
  created_at: Date;
}

const REVIEW_SELECT = `
  SELECT s.id, s.user_id, u.nick, u.avatar, s.custom_name, s.custom_category, s.tipo, s.unidad,
         s.cantidad::float8 AS cantidad, s.condicion, s.own_value_cb, s.nota, s.created_at
    FROM stock_items s JOIN users u ON u.id = s.user_id
   WHERE s.catalog_item_id IS NULL AND s.value_status = 'sin_verificar' AND s.estado = 'activo'`;

/** Los más antiguos primero. */
export async function listReviewQueue(db: Queryable): Promise<ReviewItem[]> {
  const { rows } = await db.query<RawReview>(`${REVIEW_SELECT} ORDER BY s.created_at, s.id`);
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    nick: r.nick,
    avatar: r.avatar,
    nombre: r.custom_name,
    categoria: r.custom_category,
    tipo: r.tipo,
    unidad: r.unidad,
    cantidad: r.cantidad,
    condicion: r.condicion,
    valueCb: r.own_value_cb,
    nota: r.nota,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export type ReviewAction =
  | { action: 'verify' }
  | { action: 'adjust'; valueCb: number }
  | { action: 'link'; catalogItemId: number }
  | { action: 'create'; nombre?: string | undefined; categoria?: string | undefined; unidad?: string | undefined; refCb?: number | undefined }
  | { action: 'hide'; motivo: string };

export type ReviewError =
  | 'not_found'
  | 'catalog_item_not_found'
  | 'invalid_category'
  | 'duplicate'
  | 'value_above_hard_cap'
  | 'invalid';

export type ReviewResult = { ok: true } | { ok: false; code: ReviewError };

/** Convierte un producto propio en un artículo normal de un producto del catálogo. */
async function linkToCatalog(q: Queryable, adminId: number, row: RawReview, catalogItemId: number): Promise<string> {
  const { rows } = await q.query<{ id: number; nombre: string; tipo: Tipo; unidad: string; ref_value_cb: number }>(
    'SELECT id, nombre, tipo, unidad, ref_value_cb FROM catalog_items WHERE id = $1',
    [catalogItemId],
  );
  const item = rows[0];
  if (!item) throw new ReviewFailure('catalog_item_not_found');
  const condicion: Condicion | null = item.tipo === 'bien' ? (row.condicion ?? 'nuevo') : null;
  // Pasa a ser un artículo normal de ese producto: conserva el valor que puso la familia (ya es un
  // valor propio libre) y, si lo quita, vuelve a regir referencia × factor de estado.
  const own = row.own_value_cb;
  await q.query(
    `UPDATE stock_items
        SET catalog_item_id = $2, tipo = $3, unidad = $4, condicion = $5, own_value_cb = $6,
            custom_name = NULL, custom_category = NULL, value_status = 'catalogo', verified_value_cb = NULL,
            reviewed_by = $7, reviewed_at = now(), updated_at = now()
      WHERE id = $1`,
    [row.id, item.id, item.tipo, item.unidad, condicion, own, adminId],
  );
  return item.nombre;
}

class ReviewFailure extends Error {
  constructor(readonly code: ReviewError) {
    super(code);
  }
}

export async function applyReview(db: Db, adminId: number, stockId: number, input: ReviewAction): Promise<ReviewResult> {
  try {
    return await db.tx(async (q): Promise<ReviewResult> => {
      const { rows } = await q.query<RawReview>(`${REVIEW_SELECT} AND s.id = $1 FOR UPDATE OF s`, [stockId]);
      const row = rows[0];
      if (!row) return { ok: false, code: 'not_found' };
      const articulo = row.custom_name;
      const log = (accion: string, extra: Record<string, unknown> = {}) =>
        audit(q, adminId, accion, row.nick, { articulo, ...extra });

      switch (input.action) {
        case 'verify': {
          await q.query(
            `UPDATE stock_items SET value_status = 'verificado', verified_value_cb = own_value_cb,
                    reviewed_by = $2, reviewed_at = now(), updated_at = now() WHERE id = $1`,
            [row.id, adminId],
          );
          await notify(q, row.user_id, 'producto_propio_verificado', { articulo, valorCb: row.own_value_cb });
          await log('producto_propio_verificado', { valorCb: row.own_value_cb });
          return { ok: true };
        }
        case 'adjust': {
          const cap = config.productosPropios.valorMaximoPropio * config.moneda.centesimas;
          if (!Number.isInteger(input.valueCb) || input.valueCb < 0) return { ok: false, code: 'invalid' };
          if (input.valueCb > cap) return { ok: false, code: 'value_above_hard_cap' };
          // El valor ajustado pasa a ser también el valor del artículo; desde ahí la familia solo puede bajarlo.
          await q.query(
            `UPDATE stock_items SET value_status = 'verificado', verified_value_cb = $2, own_value_cb = $2,
                    reviewed_by = $3, reviewed_at = now(), updated_at = now() WHERE id = $1`,
            [row.id, input.valueCb, adminId],
          );
          await notify(q, row.user_id, 'producto_propio_ajustado', { articulo, anteriorCb: row.own_value_cb, valorCb: input.valueCb });
          await log('producto_propio_ajustado', { anteriorCb: row.own_value_cb, valorCb: input.valueCb });
          return { ok: true };
        }
        case 'link': {
          const producto = await linkToCatalog(q, adminId, row, input.catalogItemId);
          await notify(q, row.user_id, 'producto_propio_vinculado', { articulo, producto });
          await log('producto_propio_vinculado', { producto });
          return { ok: true };
        }
        case 'create': {
          const created = await insertCatalogItem(q, adminId, {
            nombre: (input.nombre ?? row.custom_name).trim(),
            categoria: input.categoria ?? row.custom_category,
            tipo: row.tipo,
            unidad: (input.unidad ?? row.unidad).trim(),
            refCb: input.refCb ?? row.own_value_cb,
            perecedero: false,
            activo: true,
            nota: null,
          });
          if (!created.ok) return { ok: false, code: created.code };
          const producto = await linkToCatalog(q, adminId, row, created.id);
          await notify(q, row.user_id, 'producto_propio_vinculado', { articulo, producto });
          await log('producto_propio_a_catalogo', { producto, slug: created.slug });
          return { ok: true };
        }
        case 'hide': {
          await q.query(
            `UPDATE stock_items SET estado = 'pausado', hidden_reason = $2, reviewed_by = $3, reviewed_at = now(),
                    updated_at = now() WHERE id = $1`,
            [row.id, input.motivo, adminId],
          );
          await notify(q, row.user_id, 'producto_propio_oculto', { articulo, motivo: input.motivo });
          await log('producto_propio_oculto', { motivo: input.motivo });
          return { ok: true };
        }
      }
    });
  } catch (error) {
    if (error instanceof ReviewFailure) return { ok: false, code: error.code };
    if (isUniqueViolation(error)) return { ok: false, code: 'duplicate' };
    throw error;
  }
}
