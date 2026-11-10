/**
 * Stock de las familias: artículos del catálogo y productos propios.
 *
 * Todas las reglas de valor se validan AQUÍ, en el servidor (no solo en el formulario):
 *  - valor propio de un artículo del catálogo ≤ referencia × factor de estado;
 *  - productos propios: tope duro, confirmación por encima del umbral y, una vez verificados,
 *    nunca por encima del valor verificado.
 * El valor efectivo se calcula al leer (no se guarda), así que si la referencia cambia, los
 * artículos se ajustan solos.
 */
import type { Db, Queryable } from '../db/index.ts';
import { config } from '../../data/config.ts';
import {
  checkCatalogOwnValue,
  checkCustomValue,
  effectiveCb,
  maxAllowedCb,
  type Condicion,
  type Tipo,
  type ValueStatus,
} from '../domain/values.ts';

export type StockError =
  | 'not_found'
  | 'catalog_item_not_found'
  | 'catalog_item_inactive'
  | 'invalid_category'
  | 'invalid_date'
  | 'duplicate'
  | 'limit'
  | 'value_too_high'
  | 'value_above_hard_cap'
  | 'value_above_verified'
  | 'needs_confirmation'
  | 'invalid'
  | 'quantity_below_reserved'
  | 'reserved'
  | 'undo_expired'
  | 'hidden_by_admin';

export type StockResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; value: T })
  | { ok: false; code: StockError; maxCb?: number };

const fail = (code: StockError, maxCb?: number) => ({ ok: false as const, code, ...(maxCb === undefined ? {} : { maxCb }) });

export interface StockItemView {
  id: number;
  userId: number;
  nick: string;
  avatar: string | null;
  catalogItemId: number | null;
  catalogSlug: string | null;
  nombre: string;
  categoria: string;
  tipo: Tipo;
  unidad: string;
  cantidad: number;
  reservado: number;
  /** Cantidad disponible = cantidad − reservado en trueques aceptados. */
  disponible: number;
  condicion: Condicion | null;
  /** Valor efectivo por unidad (cB): el que ven todas las familias. */
  valueCb: number;
  /** Producto propio todavía sin verificar: se muestra con la etiqueta «valor sin verificar». */
  unverified: boolean;
  /** Producto propio (no está en el catálogo). */
  custom: boolean;
  perecedero: boolean;
  caducaEl: string | null;
  nota: string | null;
  // Solo para su dueña y la administración:
  estado?: 'activo' | 'pausado' | 'borrado';
  ownValueCb?: number | null;
  /** Valor máximo que puede poner la familia (cB). */
  maxCb?: number;
  hiddenReason?: string | null;
  createdAt?: string;
}

interface RawStock {
  id: number;
  user_id: number;
  nick: string;
  avatar: string | null;
  catalog_item_id: number | null;
  catalog_slug: string | null;
  nombre: string;
  categoria: string;
  tipo: Tipo;
  unidad: string;
  cantidad: number;
  reservado: number;
  condicion: Condicion | null;
  own_value_cb: number | null;
  value_status: ValueStatus;
  verified_value_cb: number | null;
  ref_value_cb: number | null;
  perecedero: boolean | null;
  caduca_el: string | null;
  nota: string | null;
  estado: 'activo' | 'pausado' | 'borrado';
  hidden_reason: string | null;
  created_at: Date;
}

const STOCK_SELECT = `
  SELECT s.id, s.user_id, u.nick, u.avatar, s.catalog_item_id, c.slug AS catalog_slug,
         COALESCE(c.nombre, s.custom_name) AS nombre,
         COALESCE(c.category_slug, s.custom_category) AS categoria,
         COALESCE(c.tipo, s.tipo) AS tipo, COALESCE(c.unidad, s.unidad) AS unidad,
         s.cantidad::float8 AS cantidad, s.reservado::float8 AS reservado, s.condicion,
         s.own_value_cb, s.value_status, s.verified_value_cb, c.ref_value_cb, c.perecedero,
         s.caduca_el::text AS caduca_el, s.nota, s.estado, s.hidden_reason, s.created_at
    FROM stock_items s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN catalog_items c ON c.id = s.catalog_item_id`;

function toView(r: RawStock, full: boolean): StockItemView {
  const valueInput = {
    refCb: r.ref_value_cb,
    tipo: r.tipo,
    condicion: r.condicion,
    ownCb: r.own_value_cb,
    valueStatus: r.value_status,
    verifiedCb: r.verified_value_cb,
  };
  const view: StockItemView = {
    id: r.id,
    userId: r.user_id,
    nick: r.nick,
    avatar: r.avatar,
    catalogItemId: r.catalog_item_id,
    catalogSlug: r.catalog_slug,
    nombre: r.nombre,
    categoria: r.categoria,
    tipo: r.tipo,
    unidad: r.unidad,
    cantidad: r.cantidad,
    reservado: r.reservado,
    disponible: Math.max(0, Math.round((r.cantidad - r.reservado) * 100) / 100),
    condicion: r.condicion,
    valueCb: effectiveCb(valueInput),
    unverified: r.value_status === 'sin_verificar',
    custom: r.catalog_item_id === null,
    perecedero: r.perecedero ?? false,
    caducaEl: r.caduca_el,
    nota: r.nota,
  };
  if (full) {
    view.estado = r.estado;
    view.ownValueCb = r.own_value_cb;
    view.maxCb = maxAllowedCb(valueInput);
    view.hiddenReason = r.hidden_reason;
    view.createdAt = new Date(r.created_at).toISOString();
  }
  return view;
}

// --- Lectura ---------------------------------------------------------------------------------

/** Mi stock: todo lo mío salvo lo borrado (el borrado se puede deshacer unos segundos). */
export async function listMine(db: Queryable, userId: number): Promise<StockItemView[]> {
  const { rows } = await db.query<RawStock>(
    `${STOCK_SELECT} WHERE s.user_id = $1 AND s.estado <> 'borrado' ORDER BY lower(COALESCE(c.nombre, s.custom_name))`,
    [userId],
  );
  return rows.map((r) => toView(r, true));
}

export interface FamilySummary {
  id: number;
  nick: string;
  avatar: string | null;
}

/**
 * Stocks de todas las familias, tal y como los ve cualquier familia con sesión: nunca los
 * artículos pausados ni borrados, ni los de plazas bloqueadas. La administración (`includeAll`)
 * lo ve todo salvo lo borrado.
 */
export async function listVisible(
  db: Queryable,
  options: { includeAll?: boolean } = {},
): Promise<{ families: FamilySummary[]; items: StockItemView[] }> {
  const { rows: families } = await db.query<FamilySummary>(
    `SELECT id, nick, avatar FROM users WHERE role = 'member' AND status <> 'bloqueado' ORDER BY seat`,
  );
  const filter = options.includeAll ? `s.estado <> 'borrado'` : `s.estado = 'activo'`;
  const { rows } = await db.query<RawStock>(
    `${STOCK_SELECT} WHERE ${filter} AND u.status <> 'bloqueado' ORDER BY lower(COALESCE(c.nombre, s.custom_name))`,
  );
  return { families, items: rows.map((r) => toView(r, options.includeAll === true)) };
}

// --- Alta ------------------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha de caducidad válida y no pasada (AAAA-MM-DD). */
function checkDate(value: string | null | undefined): string | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  if (!DATE_RE.test(value)) return 'invalid';
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return 'invalid';
  const today = new Date().toISOString().slice(0, 10);
  return value < today ? 'invalid' : value;
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
}

async function activeCount(q: Queryable, userId: number): Promise<number> {
  const { rows } = await q.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM stock_items WHERE user_id = $1 AND estado <> 'borrado'`,
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}

export interface AddCatalogInput {
  catalogItemId: number;
  cantidad: number;
  condicion?: Condicion | null | undefined;
  ownValueCb?: number | null | undefined;
  caducaEl?: string | null | undefined;
  nota?: string | null | undefined;
}

export async function addCatalogArticle(db: Db, userId: number, input: AddCatalogInput): Promise<StockResult<{ id: number }>> {
  const { rows } = await db.query<{ id: number; tipo: Tipo; unidad: string; ref_value_cb: number; perecedero: boolean; activo: boolean }>(
    'SELECT id, tipo, unidad, ref_value_cb, perecedero, activo FROM catalog_items WHERE id = $1',
    [input.catalogItemId],
  );
  const item = rows[0];
  if (!item) return fail('catalog_item_not_found');
  if (!item.activo) return fail('catalog_item_inactive');
  if ((await activeCount(db, userId)) >= config.stock.maxArticulos) return fail('limit');

  const condicion: Condicion | null = item.tipo === 'bien' ? (input.condicion ?? 'nuevo') : null;
  let own: number | null = null;
  if (input.ownValueCb !== undefined && input.ownValueCb !== null) {
    const check = checkCatalogOwnValue(input.ownValueCb, item.ref_value_cb, item.tipo, condicion);
    if (!check.ok) return fail(check.code, check.maxCb);
    own = input.ownValueCb;
  }
  const date = checkDate(input.caducaEl);
  if (date === 'invalid') return fail('invalid_date');

  try {
    const { rows: created } = await db.query<{ id: number }>(
      `INSERT INTO stock_items (user_id, catalog_item_id, tipo, cantidad, unidad, condicion, own_value_cb, caduca_el, nota, value_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'catalogo') RETURNING id`,
      [userId, item.id, item.tipo, input.cantidad, item.unidad, condicion, own, item.perecedero ? date : null, input.nota ?? null],
    );
    return { ok: true, value: { id: created[0]?.id as number } };
  } catch (error) {
    if (isUniqueViolation(error)) return fail('duplicate');
    throw error;
  }
}

export interface AddCustomInput {
  nombre: string;
  tipo: Tipo;
  categoria: string;
  unidad: string;
  cantidad: number;
  condicion?: Condicion | null | undefined;
  valueCb: number;
  confirmado?: boolean | undefined;
  caducaEl?: string | null | undefined;
  nota?: string | null | undefined;
}

/** Producto propio: se publica al instante, con la etiqueta «valor sin verificar». */
export async function addCustomArticle(db: Db, userId: number, input: AddCustomInput): Promise<StockResult<{ id: number }>> {
  const { rows: cat } = await db.query('SELECT 1 FROM categories WHERE slug = $1', [input.categoria]);
  if (cat.length === 0) return fail('invalid_category');
  if ((await activeCount(db, userId)) >= config.stock.maxArticulos) return fail('limit');

  const check = checkCustomValue(input.valueCb, {
    valueStatus: 'sin_verificar',
    verifiedCb: null,
    confirmed: input.confirmado === true,
  });
  if (!check.ok) return fail(check.code, check.maxCb);
  const date = checkDate(input.caducaEl);
  if (date === 'invalid') return fail('invalid_date');

  const { rows: created } = await db.query<{ id: number }>(
    `INSERT INTO stock_items (user_id, catalog_item_id, tipo, cantidad, unidad, condicion, own_value_cb, caduca_el, nota,
                              custom_name, custom_category, value_status)
     VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'sin_verificar') RETURNING id`,
    [
      userId,
      input.tipo,
      input.cantidad,
      input.unidad,
      input.tipo === 'bien' ? (input.condicion ?? null) : null,
      input.valueCb,
      date,
      input.nota ?? null,
      input.nombre,
      input.categoria,
    ],
  );
  return { ok: true, value: { id: created[0]?.id as number } };
}

// --- Edición ---------------------------------------------------------------------------------

export interface UpdateArticleInput {
  cantidad?: number | undefined;
  condicion?: Condicion | undefined;
  /** Artículos del catálogo: null quita el valor propio. Productos propios: obligatorio, nunca null. */
  ownValueCb?: number | null | undefined;
  confirmado?: boolean | undefined;
  caducaEl?: string | null | undefined;
  nota?: string | null | undefined;
}

/** Mi artículo, bloqueando la fila hasta el final de la transacción. */
async function lockOwn(q: Queryable, id: number, userId: number): Promise<RawStock | undefined> {
  const { rows } = await q.query<RawStock>(
    `${STOCK_SELECT} WHERE s.id = $1 AND s.user_id = $2 AND s.estado <> 'borrado' FOR UPDATE OF s`,
    [id, userId],
  );
  return rows[0];
}

export async function updateArticle(db: Db, userId: number, id: number, patch: UpdateArticleInput): Promise<StockResult> {
  try {
    return await db.tx(async (q): Promise<StockResult> => {
      const row = await lockOwn(q, id, userId);
      if (!row) return fail('not_found');

      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };

      if (patch.cantidad !== undefined) {
        if (patch.cantidad < row.reservado) return fail('quantity_below_reserved');
        set('cantidad', patch.cantidad);
      }
      let condicion = row.condicion;
      if (patch.condicion !== undefined && row.tipo === 'bien') {
        condicion = patch.condicion;
        set('condicion', condicion);
      }
      if (patch.ownValueCb !== undefined) {
        if (row.ref_value_cb !== null) {
          if (patch.ownValueCb === null) {
            set('own_value_cb', null);
          } else {
            const check = checkCatalogOwnValue(patch.ownValueCb, row.ref_value_cb, row.tipo, condicion);
            if (!check.ok) return fail(check.code, check.maxCb);
            set('own_value_cb', patch.ownValueCb);
          }
        } else {
          if (patch.ownValueCb === null) return fail('invalid');
          const check = checkCustomValue(patch.ownValueCb, {
            valueStatus: row.value_status,
            verifiedCb: row.verified_value_cb,
            confirmed: patch.confirmado === true,
          });
          if (!check.ok) return fail(check.code, check.maxCb);
          set('own_value_cb', patch.ownValueCb);
        }
      }
      if (patch.caducaEl !== undefined) {
        const date = checkDate(patch.caducaEl);
        if (date === 'invalid') return fail('invalid_date');
        set('caduca_el', row.ref_value_cb !== null && !row.perecedero ? null : date);
      }
      if (patch.nota !== undefined) set('nota', patch.nota);

      if (sets.length > 0) await q.query(`UPDATE stock_items SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
      return { ok: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail('duplicate');
    throw error;
  }
}

export type StateAction = 'pause' | 'resume' | 'delete';

/** Pausar, reanudar o borrar (borrado lógico: se puede deshacer unos segundos). */
export async function changeArticleState(db: Db, userId: number, id: number, action: StateAction): Promise<StockResult> {
  try {
    return await db.tx(async (q): Promise<StockResult> => {
      const row = await lockOwn(q, id, userId);
      if (!row) return fail('not_found');
      if (action === 'resume') {
        if (row.hidden_reason !== null) return fail('hidden_by_admin');
        await q.query(`UPDATE stock_items SET estado = 'activo', updated_at = now() WHERE id = $1`, [id]);
        return { ok: true };
      }
      if (row.reservado > 0) return fail('reserved');
      if (action === 'pause') {
        await q.query(`UPDATE stock_items SET estado = 'pausado', updated_at = now() WHERE id = $1`, [id]);
      } else {
        await q.query(
          `UPDATE stock_items SET estado_previo = estado, estado = 'borrado', deleted_at = now(), updated_at = now() WHERE id = $1`,
          [id],
        );
      }
      return { ok: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail('duplicate');
    throw error;
  }
}

/** Deshace un borrado hecho hace menos de `deshacerSegundos`. */
export async function undoDelete(db: Db, userId: number, id: number): Promise<StockResult> {
  try {
    const { rows } = await db.query<{ id: number }>(
      `UPDATE stock_items
          SET estado = COALESCE(estado_previo, 'activo'), estado_previo = NULL, deleted_at = NULL, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND estado = 'borrado'
          AND deleted_at > now() - ($3::int * interval '1 second')
        RETURNING id`,
      [id, userId, config.stock.deshacerSegundos],
    );
    return rows.length > 0 ? { ok: true } : fail('undo_expired');
  } catch (error) {
    if (isUniqueViolation(error)) return fail('duplicate');
    throw error;
  }
}
