/**
 * Catálogo en la base de datos: lectura para las familias y gestión (CRUD con historial de
 * valores) para la administración. Los valores de referencia son cB enteros.
 */
import type { Db, Queryable } from '../db/index.ts';
import { audit } from '../auth/admin.ts';
import { slugify } from '../domain/search.ts';
import type { Tipo } from '../domain/values.ts';

export interface CategoryRow {
  slug: string;
  nombre: string;
  orden: number;
}

export interface CatalogItemRow {
  id: number;
  slug: string;
  nombre: string;
  categoria: string;
  tipo: Tipo;
  unidad: string;
  refCb: number;
  refSource: 'seed' | 'admin';
  perecedero: boolean;
  activo: boolean;
  nota: string | null;
}

interface RawItem {
  id: number;
  slug: string;
  nombre: string;
  category_slug: string;
  tipo: Tipo;
  unidad: string;
  ref_value_cb: number;
  ref_value_source: 'seed' | 'admin';
  perecedero: boolean;
  activo: boolean;
  nota: string | null;
}

const ITEM_COLUMNS =
  'id, slug, nombre, category_slug, tipo, unidad, ref_value_cb, ref_value_source, perecedero, activo, nota';

const toItem = (r: RawItem): CatalogItemRow => ({
  id: r.id,
  slug: r.slug,
  nombre: r.nombre,
  categoria: r.category_slug,
  tipo: r.tipo,
  unidad: r.unidad,
  refCb: r.ref_value_cb,
  refSource: r.ref_value_source,
  perecedero: r.perecedero,
  activo: r.activo,
  nota: r.nota,
});

/**
 * Categorías. Para las familias (`onlyInUse`) solo las que tienen algún producto activo, más
 * «Otros», que siempre está; la administración las ve todas.
 */
export async function listCategories(db: Queryable, options: { onlyInUse?: boolean } = {}): Promise<CategoryRow[]> {
  const where = options.onlyInUse
    ? `WHERE slug = 'otros' OR EXISTS (SELECT 1 FROM catalog_items i WHERE i.category_slug = categories.slug AND i.activo)`
    : '';
  const { rows } = await db.query<CategoryRow>(`SELECT slug, nombre, orden FROM categories ${where} ORDER BY orden, nombre`);
  return rows;
}

/** Catálogo que ven las familias: solo los productos activos. */
export async function listActiveCatalog(db: Queryable): Promise<CatalogItemRow[]> {
  const { rows } = await db.query<RawItem>(`SELECT ${ITEM_COLUMNS} FROM catalog_items WHERE activo ORDER BY nombre`);
  return rows.map(toItem);
}

/** Catálogo completo para la administración (incluye desactivados). */
export async function listAllCatalog(db: Queryable): Promise<CatalogItemRow[]> {
  const { rows } = await db.query<RawItem>(`SELECT ${ITEM_COLUMNS} FROM catalog_items ORDER BY nombre`);
  return rows.map(toItem);
}

export type CatalogError = 'not_found' | 'invalid_category' | 'in_use';

export interface NewCatalogItem {
  nombre: string;
  categoria: string;
  tipo: Tipo;
  unidad: string;
  refCb: number;
  perecedero: boolean;
  activo: boolean;
  nota: string | null;
}

/** Slug único a partir del nombre (añade -2, -3… si ya existe). */
export async function uniqueSlug(q: Queryable, nombre: string): Promise<string> {
  const base = slugify(nombre) || 'producto';
  const { rows } = await q.query<{ slug: string }>('SELECT slug FROM catalog_items WHERE slug = $1 OR slug LIKE $2', [
    base,
    `${base}-%`,
  ]);
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Crea un producto del catálogo (siempre marcado como editado por la administración). */
export async function insertCatalogItem(
  q: Queryable,
  adminId: number,
  input: NewCatalogItem,
): Promise<{ ok: true; id: number; slug: string } | { ok: false; code: 'invalid_category' }> {
  const { rows: cat } = await q.query('SELECT 1 FROM categories WHERE slug = $1', [input.categoria]);
  if (cat.length === 0) return { ok: false, code: 'invalid_category' };
  const slug = await uniqueSlug(q, input.nombre);
  const { rows } = await q.query<{ id: number }>(
    `INSERT INTO catalog_items (slug, nombre, category_slug, tipo, unidad, ref_value_cb, ref_value_source,
                                perecedero, activo, nota, edited_by_admin)
     VALUES ($1, $2, $3, $4, $5, $6, 'admin', $7, $8, $9, true) RETURNING id`,
    [slug, input.nombre, input.categoria, input.tipo, input.unidad, input.refCb, input.perecedero, input.activo, input.nota],
  );
  const id = rows[0]?.id as number;
  await q.query('INSERT INTO catalog_value_history (item_id, old_cb, new_cb, by_user) VALUES ($1, NULL, $2, $3)', [
    id,
    input.refCb,
    adminId,
  ]);
  return { ok: true, id, slug };
}

export async function createCatalogItem(db: Db, adminId: number, input: NewCatalogItem) {
  return db.tx(async (q) => {
    const result = await insertCatalogItem(q, adminId, input);
    if (result.ok) await audit(q, adminId, 'catalogo_producto_creado', result.slug, { refCb: input.refCb });
    return result;
  });
}

export interface CatalogPatch {
  nombre?: string;
  categoria?: string;
  tipo?: Tipo;
  unidad?: string;
  refCb?: number;
  perecedero?: boolean;
  activo?: boolean;
  nota?: string | null;
}

/**
 * Edita un producto. Cada cambio del valor de referencia queda en el historial (anterior, nuevo,
 * quién, cuándo). Los artículos de stock no se tocan: su valor efectivo se calcula al leerlos, así
 * que bajar la referencia los ajusta solos (por el mínimo) y subirla sube solo los que no tienen
 * valor propio. No se permite cambiar el tipo si ya hay artículos de familias con ese producto.
 */
export async function updateCatalogItem(
  db: Db,
  adminId: number,
  id: number,
  patch: CatalogPatch,
): Promise<{ ok: true } | { ok: false; code: CatalogError }> {
  return db.tx(async (q) => {
    const { rows } = await q.query<RawItem>(`SELECT ${ITEM_COLUMNS} FROM catalog_items WHERE id = $1 FOR UPDATE`, [id]);
    const current = rows[0];
    if (!current) return { ok: false, code: 'not_found' } as const;

    if (patch.categoria !== undefined) {
      const { rows: cat } = await q.query('SELECT 1 FROM categories WHERE slug = $1', [patch.categoria]);
      if (cat.length === 0) return { ok: false, code: 'invalid_category' } as const;
    }
    if (patch.tipo !== undefined && patch.tipo !== current.tipo) {
      const { rows: used } = await q.query('SELECT 1 FROM stock_items WHERE catalog_item_id = $1 LIMIT 1', [id]);
      if (used.length > 0) return { ok: false, code: 'in_use' } as const;
    }

    const next = {
      nombre: patch.nombre ?? current.nombre,
      category_slug: patch.categoria ?? current.category_slug,
      tipo: patch.tipo ?? current.tipo,
      unidad: patch.unidad ?? current.unidad,
      ref_value_cb: patch.refCb ?? current.ref_value_cb,
      perecedero: patch.perecedero ?? current.perecedero,
      activo: patch.activo ?? current.activo,
      nota: patch.nota === undefined ? current.nota : patch.nota,
    };
    const valueChanged = next.ref_value_cb !== current.ref_value_cb;

    await q.query(
      `UPDATE catalog_items
          SET nombre = $2, category_slug = $3, tipo = $4, unidad = $5, ref_value_cb = $6, perecedero = $7,
              activo = $8, nota = $9, edited_by_admin = true, updated_at = now(),
              ref_value_source = CASE WHEN $10::boolean THEN 'admin' ELSE ref_value_source END
        WHERE id = $1`,
      [id, next.nombre, next.category_slug, next.tipo, next.unidad, next.ref_value_cb, next.perecedero, next.activo, next.nota, valueChanged],
    );
    if (valueChanged) {
      await q.query('INSERT INTO catalog_value_history (item_id, old_cb, new_cb, by_user) VALUES ($1, $2, $3, $4)', [
        id,
        current.ref_value_cb,
        next.ref_value_cb,
        adminId,
      ]);
    }
    await audit(q, adminId, valueChanged ? 'catalogo_valor_cambiado' : 'catalogo_producto_editado', current.slug, {
      ...(valueChanged ? { anteriorCb: current.ref_value_cb, nuevoCb: next.ref_value_cb } : {}),
      ...(patch.activo !== undefined && patch.activo !== current.activo ? { activo: patch.activo } : {}),
    });
    return { ok: true } as const;
  });
}

export interface ValueHistoryRow {
  oldCb: number | null;
  newCb: number;
  at: string;
}

export async function itemHistory(db: Queryable, id: number): Promise<ValueHistoryRow[]> {
  const { rows } = await db.query<{ old_cb: number | null; new_cb: number; at: Date }>(
    'SELECT old_cb, new_cb, at FROM catalog_value_history WHERE item_id = $1 ORDER BY at DESC, id DESC',
    [id],
  );
  return rows.map((r) => ({ oldCb: r.old_cb, newCb: r.new_cb, at: new Date(r.at).toISOString() }));
}
