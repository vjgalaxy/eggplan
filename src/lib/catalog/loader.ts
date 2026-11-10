/**
 * Carga del catálogo inicial (src/data/catalogo.ts) en la base de datos.
 *
 *  - Idempotente: upsert por `slug`; ejecutarla dos veces no cambia nada.
 *  - Respeta al administrador: un producto que el administrador ha editado (`edited_by_admin`) no
 *    se vuelve a tocar (ni su valor, ni su nombre, ni si está activo).
 *  - Los productos sin editar sí se actualizan con lo que diga el archivo (así se corrigen erratas
 *    del catálogo inicial).
 *  - No toca los artículos de stock ya creados.
 *  - Los productos con `activo: false` se cargan desactivados.
 *  - Convierte los valores a céntimos enteros con Math.round(valor * 100).
 * Una sola sentencia por tabla (unnest), para que el arranque en frío sea rápido.
 */
import type { Db } from '../db/index.ts';
import type { CategoriaCatalogo, ItemCatalogo } from '../../data/catalogo.ts';

export async function loadCatalog(
  db: Db,
  categorias: readonly CategoriaCatalogo[],
  items: readonly ItemCatalogo[],
): Promise<void> {
  await db.tx(async (q) => {
    await q.query(
      `INSERT INTO categories (slug, nombre, orden)
       SELECT * FROM unnest($1::text[], $2::text[], $3::int[])
       ON CONFLICT (slug) DO UPDATE SET nombre = EXCLUDED.nombre, orden = EXCLUDED.orden
         WHERE (categories.nombre, categories.orden) IS DISTINCT FROM (EXCLUDED.nombre, EXCLUDED.orden)`,
      [categorias.map((c) => c.slug), categorias.map((c) => c.nombre), categorias.map((c) => c.orden)],
    );

    await q.query(
      `INSERT INTO catalog_items (slug, nombre, category_slug, tipo, unidad, ref_value_cb, perecedero, activo, nota)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::bool[], $8::bool[], $9::text[])
       ON CONFLICT (slug) DO UPDATE SET
         nombre = EXCLUDED.nombre, category_slug = EXCLUDED.category_slug, tipo = EXCLUDED.tipo,
         unidad = EXCLUDED.unidad, ref_value_cb = EXCLUDED.ref_value_cb, perecedero = EXCLUDED.perecedero,
         activo = EXCLUDED.activo, nota = EXCLUDED.nota, updated_at = now()
       WHERE NOT catalog_items.edited_by_admin
         AND (catalog_items.nombre, catalog_items.category_slug, catalog_items.tipo, catalog_items.unidad,
              catalog_items.ref_value_cb, catalog_items.perecedero, catalog_items.activo, catalog_items.nota)
             IS DISTINCT FROM
             (EXCLUDED.nombre, EXCLUDED.category_slug, EXCLUDED.tipo, EXCLUDED.unidad,
              EXCLUDED.ref_value_cb, EXCLUDED.perecedero, EXCLUDED.activo, EXCLUDED.nota)`,
      [
        items.map((i) => i.slug),
        items.map((i) => i.nombre),
        items.map((i) => i.categoria),
        items.map((i) => i.tipo),
        items.map((i) => i.unidad),
        items.map((i) => Math.round(i.valor * 100)),
        items.map((i) => i.perecedero ?? false),
        items.map((i) => i.activo ?? true),
        items.map((i) => i.nota ?? null),
      ],
    );
  });
}

let loaded = false;

/** Con memo por instancia: tras la primera carga no vuelve a consultar. */
export async function loadCatalogOnce(
  db: Db,
  categorias: readonly CategoriaCatalogo[],
  items: readonly ItemCatalogo[],
): Promise<void> {
  if (loaded) return;
  await loadCatalog(db, categorias, items);
  loaded = true;
}
