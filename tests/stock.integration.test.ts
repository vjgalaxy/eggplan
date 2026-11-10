import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db/index.ts';
import { makeTestDb } from './helpers/test-db.ts';
import { categorias, catalogo, type ItemCatalogo } from '../src/data/catalogo.ts';
import { loadCatalog } from '../src/lib/catalog/loader.ts';
import {
  createCatalogItem,
  itemHistory,
  listActiveCatalog,
  listAllCatalog,
  listCategories,
  updateCatalogItem,
} from '../src/lib/catalog/catalog.ts';
import {
  addCatalogArticle,
  addCustomArticle,
  changeArticleState,
  listMine,
  listVisible,
  undoDelete,
  updateArticle,
} from '../src/lib/stock/stock.ts';
import { applyReview, listReviewQueue } from '../src/lib/stock/review.ts';
import { closeWant, createWant, listOpenWants } from '../src/lib/stock/wants.ts';
import { config } from '../src/data/config.ts';

let db: Db;
let admin: number;
let ana: number;
let beto: number;

async function user(seat: number | null, nick: string, role: 'member' | 'admin'): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO users (seat, nick, role, status) VALUES ($1, $2, $3, 'activo') RETURNING id`,
    [seat, nick, role],
  );
  return rows[0]?.id as number;
}

async function catalogId(slug: string): Promise<number> {
  const { rows } = await db.query<{ id: number }>('SELECT id FROM catalog_items WHERE slug = $1', [slug]);
  if (!rows[0]) throw new Error(`no existe ${slug}`);
  return rows[0].id;
}

/** Primer producto del catálogo de un tipo (con valor > 0). */
async function firstOfType(tipo: string): Promise<{ id: number; slug: string; ref_value_cb: number }> {
  const { rows } = await db.query<{ id: number; slug: string; ref_value_cb: number }>(
    `SELECT id, slug, ref_value_cb FROM catalog_items WHERE tipo = $1 AND activo AND ref_value_cb > 0 ORDER BY id LIMIT 1`,
    [tipo],
  );
  return rows[0] as { id: number; slug: string; ref_value_cb: number };
}

const customInput = {
  nombre: 'Mermelada de higos de mi abuela',
  tipo: 'bien' as const,
  categoria: 'pan-despensa',
  unidad: 'tarro',
  cantidad: 6,
  valueCb: 500,
};

beforeEach(async () => {
  db = await makeTestDb();
  admin = await user(null, 'admin', 'admin');
  ana = await user(1, 'Peliqueiro', 'member');
  beto = await user(2, 'Cigarrón', 'member');
  await loadCatalog(db, categorias, catalogo);
});

describe('carga del catálogo', () => {
  it('carga todo el catálogo; «otros» lo crea la migración y los activo:false quedan desactivados', async () => {
    const all = await listAllCatalog(db);
    expect(all).toHaveLength(catalogo.length);
    const { rows } = await db.query('SELECT 1 FROM categories WHERE slug = $1', ['otros']);
    expect(rows).toHaveLength(1);
    const inactive = catalogo.filter((i) => i.activo === false);
    expect(inactive.length).toBeGreaterThan(0);
    const active = await listActiveCatalog(db);
    expect(active).toHaveLength(catalogo.length - inactive.length);
    for (const item of inactive) expect(all.find((a) => a.slug === item.slug)?.activo).toBe(false);
  });

  it('convierte los valores a céntimos enteros', async () => {
    const all = await listAllCatalog(db);
    for (const item of catalogo.slice(0, 40)) {
      expect(all.find((a) => a.slug === item.slug)?.refCb).toBe(Math.round(item.valor * 100));
    }
  });

  it('es idempotente: cargarlo otra vez no cambia nada', async () => {
    const before = await db.query('SELECT * FROM catalog_items ORDER BY id');
    await loadCatalog(db, categorias, catalogo);
    await loadCatalog(db, categorias, catalogo);
    const after = await db.query('SELECT * FROM catalog_items ORDER BY id');
    expect(after.rows).toEqual(before.rows);
  });

  it('no pisa los valores (ni nada) editados por el administrador', async () => {
    const id = await catalogId('patata');
    await updateCatalogItem(db, admin, id, { refCb: 999, activo: false });
    await loadCatalog(db, categorias, catalogo);
    const item = (await listAllCatalog(db)).find((i) => i.slug === 'patata');
    expect(item).toMatchObject({ refCb: 999, refSource: 'admin', activo: false });
  });

  it('un producto retirado del archivo se desactiva, sin borrarlo ni tocar lo editado por el admin ni el stock', async () => {
    const patata = await catalogId('patata');
    const cebolla = await catalogId('cebolla');
    await addCatalogArticle(db, ana, { catalogItemId: patata, cantidad: 3 });
    await updateCatalogItem(db, admin, cebolla, { nota: 'Editado por el admin' });
    const creado = await createCatalogItem(db, admin, {
      nombre: 'Producto del admin', categoria: 'otros', tipo: 'bien', unidad: 'unidad', refCb: 100, perecedero: false, activo: true, nota: null,
    });

    await loadCatalog(db, categorias, catalogo.filter((i) => i.slug !== 'patata' && i.slug !== 'cebolla'));

    const all = await listAllCatalog(db);
    expect(all.find((i) => i.slug === 'patata')).toMatchObject({ activo: false }); // retirado y sin editar
    expect(all.find((i) => i.slug === 'cebolla')).toMatchObject({ activo: true }); // editado por el admin
    expect(all.find((i) => creado.ok && i.id === creado.id)).toMatchObject({ activo: true }); // creado por el admin
    expect(all.find((i) => i.slug === 'ajo-kg')).toMatchObject({ activo: true });
    expect(await listMine(db, ana)).toHaveLength(1); // el stock sigue ahí
  });

  it('una categoría retirada del archivo: las familias dejan de verla y se borra cuando nada la usa', async () => {
    const extraCategory = { slug: 'retirada', nombre: 'Categoría retirada', orden: 99 };
    const extraItem: ItemCatalogo = { slug: 'cosa-retirada', nombre: 'Cosa retirada', categoria: 'retirada', tipo: 'bien', unidad: 'unidad', valor: 1 };
    const visibles = async () => (await listCategories(db, { onlyInUse: true })).map((c) => c.slug);

    await loadCatalog(db, [...categorias, extraCategory], [...catalogo, extraItem]);
    expect(await visibles()).toContain('retirada');

    // Se retiran del archivo: el producto queda desactivado (sigue referenciando la categoría),
    // pero las familias ya no la ven; la administración sí.
    await loadCatalog(db, categorias, catalogo);
    expect(await visibles()).not.toContain('retirada');
    expect(await visibles()).toContain('otros');
    expect((await listCategories(db)).map((c) => c.slug)).toContain('retirada');
    expect((await listActiveCatalog(db)).some((i) => i.categoria === 'retirada')).toBe(false);

    // Una categoría que ya nadie usa sí desaparece del todo; «otros» nunca.
    await db.query(`DELETE FROM catalog_items WHERE category_slug = 'retirada'`);
    await loadCatalog(db, categorias, catalogo);
    expect((await listCategories(db)).map((c) => c.slug)).not.toContain('retirada');
    expect((await listCategories(db)).map((c) => c.slug)).toContain('otros');
  });

  it('sí actualiza los productos que nadie ha editado y no toca el stock ya creado', async () => {
    const patata = await catalogId('patata');
    const made = await addCatalogArticle(db, ana, { catalogItemId: patata, cantidad: 10 });
    expect(made.ok).toBe(true);

    const corrected: ItemCatalogo[] = catalogo.map((i) => (i.slug === 'patata' ? { ...i, valor: 0.8 } : i));
    await loadCatalog(db, categorias, corrected);

    expect((await listAllCatalog(db)).find((i) => i.slug === 'patata')?.refCb).toBe(80);
    const mine = await listMine(db, ana);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ cantidad: 10, valueCb: 80 });
  });
});

describe('administración del catálogo', () => {
  it('cada cambio de valor queda en el historial (anterior, nuevo, quién, cuándo)', async () => {
    const id = await catalogId('patata');
    const antes = (await listAllCatalog(db)).find((i) => i.id === id)?.refCb as number;
    expect(await updateCatalogItem(db, admin, id, { refCb: 75 })).toEqual({ ok: true });
    expect(await updateCatalogItem(db, admin, id, { refCb: 90 })).toEqual({ ok: true });
    // Un cambio que no toca el valor no añade historial.
    expect(await updateCatalogItem(db, admin, id, { nota: 'ojo' })).toEqual({ ok: true });
    const history = await itemHistory(db, id);
    expect(history.map((h) => [h.oldCb, h.newCb])).toEqual([
      [75, 90],
      [antes, 75],
    ]);
    const { rows } = await db.query<{ by_user: number }>('SELECT by_user FROM catalog_value_history WHERE item_id = $1', [id]);
    expect(rows.every((r) => r.by_user === admin)).toBe(true);
  });

  it('crear un producto lo marca como del administrador y registra su primer valor', async () => {
    const result = await createCatalogItem(db, admin, {
      nombre: 'Queso de oveja curado',
      categoria: 'huevos-lacteos',
      tipo: 'bien',
      unidad: 'kg',
      refCb: 2200,
      perecedero: true,
      activo: true,
      nota: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slug).toBe('queso-de-oveja-curado');
    const item = (await listAllCatalog(db)).find((i) => i.id === result.id);
    expect(item).toMatchObject({ refCb: 2200, refSource: 'admin', activo: true });
    expect((await itemHistory(db, result.id))[0]).toMatchObject({ oldCb: null, newCb: 2200 });
    // El mismo nombre no choca: añade un sufijo al slug.
    const again = await createCatalogItem(db, admin, {
      nombre: 'Queso de oveja curado', categoria: 'huevos-lacteos', tipo: 'bien', unidad: 'kg', refCb: 2000, perecedero: true, activo: true, nota: null,
    });
    expect(again).toMatchObject({ ok: true, slug: 'queso-de-oveja-curado-2' });
  });

  it('rechaza categorías inexistentes y no deja cambiar el tipo si hay artículos con ese producto', async () => {
    const id = await catalogId('patata');
    expect(await updateCatalogItem(db, admin, id, { categoria: 'no-existe' })).toEqual({ ok: false, code: 'invalid_category' });
    expect(await updateCatalogItem(db, admin, 99_999, { refCb: 1 })).toEqual({ ok: false, code: 'not_found' });
    await addCatalogArticle(db, ana, { catalogItemId: id, cantidad: 3 });
    expect(await updateCatalogItem(db, admin, id, { tipo: 'servicio' })).toEqual({ ok: false, code: 'in_use' });
  });

  it('desactivar un producto lo quita de la lista de las familias y no deja añadirlo', async () => {
    const id = await catalogId('patata');
    await updateCatalogItem(db, admin, id, { activo: false });
    expect((await listActiveCatalog(db)).some((i) => i.id === id)).toBe(false);
    expect(await addCatalogArticle(db, ana, { catalogItemId: id, cantidad: 1 })).toEqual({ ok: false, code: 'catalog_item_inactive' });
  });
});

describe('regla del valor en el stock', () => {
  it('el valor propio se puede subir o bajar respecto al recomendado, dentro del tope duro (en el servidor)', async () => {
    const bien = await firstOfType('bien');
    const added = await addCatalogArticle(db, ana, { catalogItemId: bien.id, cantidad: 2, condicion: 'usado' });
    if (!added.ok) throw new Error('no se pudo añadir');
    const id = added.value.id;
    const recomendado = Math.round(bien.ref_value_cb * 0.5);

    const valor = async () => (await listMine(db, ana))[0]?.valueCb;
    expect(await updateArticle(db, ana, id, { ownValueCb: recomendado + 50 })).toEqual({ ok: true });
    expect(await valor()).toBe(recomendado + 50); // por encima del recomendado
    expect(await updateArticle(db, ana, id, { ownValueCb: Math.max(0, recomendado - 1) })).toEqual({ ok: true });
    expect(await valor()).toBe(Math.max(0, recomendado - 1)); // por debajo
    expect((await listMine(db, ana))[0]).toMatchObject({ recommendedCb: recomendado });

    // Tope duro y valor no entero, también al crear el artículo.
    const cap = config.productosPropios.valorMaximoPropio * 100;
    expect(await updateArticle(db, ana, id, { ownValueCb: cap + 1, confirmado: true })).toMatchObject({ ok: false, code: 'value_above_hard_cap' });
    expect(await updateArticle(db, ana, id, { ownValueCb: 1.5 })).toMatchObject({ ok: false, code: 'invalid' });
    const other = await firstOfType('servicio');
    expect(await addCatalogArticle(db, ana, { catalogItemId: other.id, cantidad: 1, ownValueCb: cap + 1, confirmado: true })).toMatchObject({
      ok: false,
      code: 'value_above_hard_cap',
    });
  });

  it('un valor muy alto y por encima del recomendado pide confirmación', async () => {
    const bien = await firstOfType('bien');
    const umbral = config.productosPropios.confirmarValorMayorQue * 100;
    const added = await addCatalogArticle(db, ana, { catalogItemId: bien.id, cantidad: 1 });
    if (!added.ok) throw new Error('alta');
    const id = added.value.id;
    expect(await updateArticle(db, ana, id, { ownValueCb: umbral + 1 })).toMatchObject({ ok: false, code: 'needs_confirmation' });
    expect(await updateArticle(db, ana, id, { ownValueCb: umbral + 1, confirmado: true })).toEqual({ ok: true });
    const other = await firstOfType('servicio');
    expect(await addCatalogArticle(db, ana, { catalogItemId: other.id, cantidad: 1, ownValueCb: umbral + 1 })).toMatchObject({
      ok: false,
      code: 'needs_confirmation',
    });
  });

  it('el estado del bien multiplica la referencia; servicios y préstamos no tienen factor', async () => {
    const bien = await firstOfType('bien');
    const servicio = await firstOfType('servicio');
    const prestamo = await firstOfType('prestamo');
    await addCatalogArticle(db, ana, { catalogItemId: bien.id, cantidad: 1, condicion: 'bueno' });
    await addCatalogArticle(db, ana, { catalogItemId: servicio.id, cantidad: 1, condicion: 'usado' });
    await addCatalogArticle(db, ana, { catalogItemId: prestamo.id, cantidad: 1 });
    const mine = await listMine(db, ana);
    expect(mine.find((i) => i.catalogItemId === bien.id)?.valueCb).toBe(Math.round(bien.ref_value_cb * 0.75));
    const s = mine.find((i) => i.catalogItemId === servicio.id);
    expect(s?.valueCb).toBe(servicio.ref_value_cb);
    expect(s?.condicion).toBeNull();
    expect(mine.find((i) => i.catalogItemId === prestamo.id)?.valueCb).toBe(prestamo.ref_value_cb);
  });

  it('si el admin baja la referencia, bajan los artículos sin valor propio; los que lo tienen mantienen el suyo', async () => {
    const bien = await firstOfType('bien');
    const propio = bien.ref_value_cb;
    const sinPropio = await addCatalogArticle(db, ana, { catalogItemId: bien.id, cantidad: 1 });
    const conPropio = await addCatalogArticle(db, beto, { catalogItemId: bien.id, cantidad: 1, ownValueCb: propio });
    if (!sinPropio.ok || !conPropio.ok) throw new Error('alta');

    const nueva = Math.floor(bien.ref_value_cb / 2);
    await updateCatalogItem(db, admin, bien.id, { refCb: nueva });

    const { items } = await listVisible(db);
    expect(items.find((i) => i.id === sinPropio.value.id)?.valueCb).toBe(nueva);
    expect(items.find((i) => i.id === conPropio.value.id)?.valueCb).toBe(propio);
  });

  it('si el admin sube la referencia, suben los artículos sin valor propio y no los que lo tienen', async () => {
    const bien = await firstOfType('bien');
    const propio = Math.floor(bien.ref_value_cb / 2);
    const sinPropio = await addCatalogArticle(db, ana, { catalogItemId: bien.id, cantidad: 1 });
    const conPropio = await addCatalogArticle(db, beto, { catalogItemId: bien.id, cantidad: 1, ownValueCb: propio });
    if (!sinPropio.ok || !conPropio.ok) throw new Error('alta');

    const nueva = bien.ref_value_cb * 3;
    await updateCatalogItem(db, admin, bien.id, { refCb: nueva });

    const { items } = await listVisible(db);
    expect(items.find((i) => i.id === sinPropio.value.id)?.valueCb).toBe(nueva);
    expect(items.find((i) => i.id === conPropio.value.id)?.valueCb).toBe(propio);
  });

  it('quitar el valor propio (null) devuelve el artículo al recomendado', async () => {
    const bien = await firstOfType('bien');
    const added = await addCatalogArticle(db, ana, { catalogItemId: bien.id, cantidad: 1, ownValueCb: 1 });
    if (!added.ok) throw new Error('alta');
    expect((await listMine(db, ana))[0]?.valueCb).toBe(1);
    await updateArticle(db, ana, added.value.id, { ownValueCb: null });
    expect((await listMine(db, ana))[0]?.valueCb).toBe(bien.ref_value_cb);
  });

  it('no repite el mismo producto con el mismo estado del bien', async () => {
    const bien = await firstOfType('bien');
    expect((await addCatalogArticle(db, ana, { catalogItemId: bien.id, cantidad: 1 })).ok).toBe(true);
    expect(await addCatalogArticle(db, ana, { catalogItemId: bien.id, cantidad: 1 })).toEqual({ ok: false, code: 'duplicate' });
    // Con otro estado del bien sí es otra línea.
    expect((await addCatalogArticle(db, ana, { catalogItemId: bien.id, cantidad: 1, condicion: 'usado' })).ok).toBe(true);
  });
});

describe('visibilidad del stock', () => {
  it('una familia ve el stock de otra, pero no sus artículos pausados ni borrados', async () => {
    const bien = await firstOfType('bien');
    const servicio = await firstOfType('servicio');
    const prestamo = await firstOfType('prestamo');
    const a = await addCatalogArticle(db, ana, { catalogItemId: bien.id, cantidad: 1 });
    const b = await addCatalogArticle(db, ana, { catalogItemId: servicio.id, cantidad: 1 });
    const c = await addCatalogArticle(db, ana, { catalogItemId: prestamo.id, cantidad: 1 });
    if (!a.ok || !b.ok || !c.ok) throw new Error('alta');

    expect((await listVisible(db)).items.map((i) => i.id).sort()).toEqual([a.value.id, b.value.id, c.value.id].sort());

    expect(await changeArticleState(db, ana, b.value.id, 'pause')).toEqual({ ok: true });
    expect(await changeArticleState(db, ana, c.value.id, 'delete')).toEqual({ ok: true });

    const visibles = (await listVisible(db)).items;
    expect(visibles.map((i) => i.id)).toEqual([a.value.id]);
    // La dueña sigue viendo el pausado (y no el borrado); la administración ve también el pausado.
    expect((await listMine(db, ana)).map((i) => i.id).sort()).toEqual([a.value.id, b.value.id].sort());
    expect((await listVisible(db, { includeAll: true })).items.map((i) => i.id).sort()).toEqual([a.value.id, b.value.id].sort());
    // Los datos de gestión solo llegan a la dueña / administración, no al listado de las demás familias.
    expect(visibles[0]).not.toHaveProperty('ownValueCb');
    expect(visibles[0]).not.toHaveProperty('estado');
  });

  it('el stock de una plaza bloqueada no aparece', async () => {
    const bien = await firstOfType('bien');
    await addCatalogArticle(db, ana, { catalogItemId: bien.id, cantidad: 1 });
    await db.query(`UPDATE users SET status = 'bloqueado' WHERE id = $1`, [ana]);
    const { items, families } = await listVisible(db);
    expect(items).toHaveLength(0);
    expect(families.map((f) => f.nick)).toEqual(['Cigarrón']);
  });

  it('una familia no puede tocar los artículos de otra', async () => {
    const bien = await firstOfType('bien');
    const added = await addCatalogArticle(db, ana, { catalogItemId: bien.id, cantidad: 1 });
    if (!added.ok) throw new Error('alta');
    expect(await updateArticle(db, beto, added.value.id, { cantidad: 99 })).toEqual({ ok: false, code: 'not_found' });
    expect(await changeArticleState(db, beto, added.value.id, 'delete')).toEqual({ ok: false, code: 'not_found' });
    expect((await listMine(db, ana))[0]?.cantidad).toBe(1);
  });
});

describe('borrar con deshacer, pausar y reservas', () => {
  it('se puede deshacer un borrado dentro del plazo y no después', async () => {
    const bien = await firstOfType('bien');
    const added = await addCatalogArticle(db, ana, { catalogItemId: bien.id, cantidad: 4 });
    if (!added.ok) throw new Error('alta');
    const id = added.value.id;

    await changeArticleState(db, ana, id, 'pause');
    await changeArticleState(db, ana, id, 'delete');
    expect(await listMine(db, ana)).toHaveLength(0);
    expect(await undoDelete(db, ana, id)).toEqual({ ok: true });
    // Vuelve al estado que tenía (pausado), no a activo.
    expect((await listMine(db, ana))[0]).toMatchObject({ id, estado: 'pausado', cantidad: 4 });

    await changeArticleState(db, ana, id, 'delete');
    await db.query(`UPDATE stock_items SET deleted_at = now() - interval '${config.stock.deshacerSegundos + 5} seconds' WHERE id = $1`, [id]);
    expect(await undoDelete(db, ana, id)).toEqual({ ok: false, code: 'undo_expired' });
    expect(await undoDelete(db, beto, id)).toEqual({ ok: false, code: 'undo_expired' });
  });

  it('no se puede bajar la cantidad por debajo de lo reservado ni pausar/borrar con reservas', async () => {
    const bien = await firstOfType('bien');
    const added = await addCatalogArticle(db, ana, { catalogItemId: bien.id, cantidad: 5 });
    if (!added.ok) throw new Error('alta');
    await db.query('UPDATE stock_items SET reservado = 3 WHERE id = $1', [added.value.id]);

    expect(await updateArticle(db, ana, added.value.id, { cantidad: 2 })).toEqual({ ok: false, code: 'quantity_below_reserved' });
    expect(await updateArticle(db, ana, added.value.id, { cantidad: 3 })).toEqual({ ok: true });
    expect(await changeArticleState(db, ana, added.value.id, 'pause')).toEqual({ ok: false, code: 'reserved' });
    expect(await changeArticleState(db, ana, added.value.id, 'delete')).toEqual({ ok: false, code: 'reserved' });
    const item = (await listVisible(db)).items[0];
    expect(item).toMatchObject({ cantidad: 3, reservado: 3, disponible: 0 });
  });

  it('la base de datos rechaza artículos incoherentes aunque falle el servidor', async () => {
    const bien = await firstOfType('bien');
    const insert = (cols: string, vals: unknown[]) =>
      db.query(`INSERT INTO stock_items (user_id, tipo, unidad, ${cols}) VALUES ($1, 'bien', 'kg', ${vals.map((_, i) => `$${i + 2}`).join(', ')})`, [ana, ...vals]);
    // Sin producto del catálogo ni nombre/valor propios.
    await expect(insert('cantidad', [1])).rejects.toThrow();
    // Cantidad negativa.
    await expect(insert('cantidad, catalog_item_id', [-1, bien.id])).rejects.toThrow();
    // Reservado mayor que la cantidad.
    await expect(insert('cantidad, reservado, catalog_item_id', [1, 2, bien.id])).rejects.toThrow();
    // Valor propio negativo.
    await expect(insert('cantidad, catalog_item_id, own_value_cb', [1, bien.id, -5])).rejects.toThrow();
  });
});

describe('productos propios', () => {
  it('se publican al instante con la etiqueta «valor sin verificar»', async () => {
    const result = await addCustomArticle(db, ana, customInput);
    expect(result.ok).toBe(true);
    const visible = (await listVisible(db)).items;
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      nombre: customInput.nombre,
      custom: true,
      unverified: true,
      valueCb: 500,
      categoria: 'pan-despensa',
      nick: 'Peliqueiro',
    });
  });

  it('valida en el servidor: tope duro, confirmación por encima del umbral y categoría', async () => {
    const duro = config.productosPropios.valorMaximoPropio * 100;
    const umbral = config.productosPropios.confirmarValorMayorQue * 100;
    expect(await addCustomArticle(db, ana, { ...customInput, valueCb: duro + 1, confirmado: true })).toMatchObject({
      ok: false,
      code: 'value_above_hard_cap',
    });
    expect(await addCustomArticle(db, ana, { ...customInput, valueCb: umbral + 1 })).toMatchObject({ ok: false, code: 'needs_confirmation' });
    expect(await addCustomArticle(db, ana, { ...customInput, valueCb: umbral + 1, confirmado: true })).toMatchObject({ ok: true });
    expect(await addCustomArticle(db, ana, { ...customInput, categoria: 'inventada' })).toEqual({ ok: false, code: 'invalid_category' });
    expect(await addCustomArticle(db, ana, { ...customInput, valueCb: -1 })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('mientras está sin verificar, la familia cambia el valor libremente, dentro del tope duro', async () => {
    const created = await addCustomArticle(db, ana, customInput);
    if (!created.ok) throw new Error('alta');
    const id = created.value.id;
    expect(await updateArticle(db, ana, id, { ownValueCb: 900 })).toEqual({ ok: true });
    expect(await updateArticle(db, ana, id, { ownValueCb: 100 })).toEqual({ ok: true });
    expect(await updateArticle(db, ana, id, { ownValueCb: null })).toEqual({ ok: false, code: 'invalid' });
  });

  it('aparecen en la cola de revisión, los más antiguos primero', async () => {
    const first = await addCustomArticle(db, ana, customInput);
    const second = await addCustomArticle(db, beto, { ...customInput, nombre: 'Jabón de laurel' });
    if (!first.ok || !second.ok) throw new Error('alta');
    await db.query(`UPDATE stock_items SET created_at = now() - interval '2 days' WHERE id = $1`, [second.value.id]);
    const queue = await listReviewQueue(db);
    expect(queue.map((q) => q.id)).toEqual([second.value.id, first.value.id]);
    expect(queue[0]).toMatchObject({ nick: 'Cigarrón', nombre: 'Jabón de laurel' });
  });

  async function pending(valueCb = 800) {
    const created = await addCustomArticle(db, ana, { ...customInput, valueCb });
    if (!created.ok) throw new Error('alta');
    return created.value.id;
  }

  it('verificar: la familia ya solo puede bajar el valor, nunca superar el verificado', async () => {
    const id = await pending(800);
    expect(await applyReview(db, admin, id, { action: 'verify' })).toEqual({ ok: true });
    expect((await listVisible(db)).items[0]).toMatchObject({ unverified: false, valueCb: 800, custom: true });
    expect(await updateArticle(db, ana, id, { ownValueCb: 801 })).toEqual({ ok: false, code: 'value_above_verified', maxCb: 800 });
    expect(await updateArticle(db, ana, id, { ownValueCb: 800 })).toEqual({ ok: true });
    expect(await updateArticle(db, ana, id, { ownValueCb: 300 })).toEqual({ ok: true });
    // Ya no está en la cola.
    expect(await listReviewQueue(db)).toHaveLength(0);
    // Avisa a la familia (aviso privado) y queda auditado.
    const { rows } = await db.query<{ tipo: string; user_id: number }>('SELECT tipo, user_id FROM notifications');
    expect(rows).toEqual([{ tipo: 'producto_propio_verificado', user_id: ana }]);
    const audit = await db.query<{ accion: string }>(`SELECT accion FROM admin_audit WHERE accion LIKE 'producto_propio%'`);
    expect(audit.rows).toHaveLength(1);
  });

  it('ajustar el valor (sube o baja) lo deja verificado con ese valor', async () => {
    const id = await pending(800);
    expect(await applyReview(db, admin, id, { action: 'adjust', valueCb: 1200 })).toEqual({ ok: true });
    expect((await listVisible(db)).items[0]?.valueCb).toBe(1200);
    expect(await updateArticle(db, ana, id, { ownValueCb: 1300 })).toMatchObject({ ok: false, code: 'value_above_verified' });

    const otro = await pending(800);
    expect(await applyReview(db, admin, otro, { action: 'adjust', valueCb: 200 })).toEqual({ ok: true });
    expect((await listMine(db, ana)).find((i) => i.id === otro)?.valueCb).toBe(200);
    expect(await applyReview(db, admin, otro, { action: 'adjust', valueCb: 5 })).toEqual({ ok: false, code: 'not_found' });
    const nuevo = await pending(800);
    expect(await applyReview(db, admin, nuevo, { action: 'adjust', valueCb: 10_000_000 })).toEqual({ ok: false, code: 'value_above_hard_cap' });
  });

  it('vincular a un producto del catálogo lo convierte en un artículo normal, conservando el valor de la familia', async () => {
    const bien = await firstOfType('bien');
    const id = await pending(bien.ref_value_cb * 5); // la familia lo había valorado por encima
    expect(await updateArticle(db, ana, id, { condicion: 'usado' })).toEqual({ ok: true });

    expect(await applyReview(db, admin, id, { action: 'link', catalogItemId: bien.id })).toEqual({ ok: true });

    const item = (await listVisible(db)).items[0];
    const recomendado = Math.round(bien.ref_value_cb * 0.5);
    expect(item).toMatchObject({ custom: false, unverified: false, catalogItemId: bien.id, valueCb: bien.ref_value_cb * 5, condicion: 'usado' });
    // Si la familia quita su valor, rige referencia × factor de estado.
    expect(await updateArticle(db, ana, id, { ownValueCb: null })).toEqual({ ok: true });
    expect((await listVisible(db)).items[0]?.valueCb).toBe(recomendado);
    // Y si el admin baja la referencia, el artículo sin valor propio baja solo.
    await updateCatalogItem(db, admin, bien.id, { refCb: 10 });
    expect((await listVisible(db)).items[0]?.valueCb).toBe(5);
    // Un producto del catálogo inexistente no se puede vincular.
    const otro = await pending();
    expect(await applyReview(db, admin, otro, { action: 'link', catalogItemId: 999_999 })).toEqual({ ok: false, code: 'catalog_item_not_found' });
    expect(await listReviewQueue(db)).toHaveLength(1);
  });

  it('crear un producto en el catálogo a partir del artículo: queda vinculado y disponible para las demás', async () => {
    const id = await pending(600);
    const result = await applyReview(db, admin, id, { action: 'create', nombre: 'Mermelada de higos', unidad: 'tarro', refCb: 700 });
    expect(result).toEqual({ ok: true });

    const creado = (await listAllCatalog(db)).find((i) => i.slug === 'mermelada-de-higos');
    expect(creado).toMatchObject({ nombre: 'Mermelada de higos', refCb: 700, refSource: 'admin', activo: true, tipo: 'bien' });
    expect((await listActiveCatalog(db)).some((i) => i.slug === 'mermelada-de-higos')).toBe(true);

    const item = (await listVisible(db)).items[0];
    expect(item).toMatchObject({ custom: false, catalogItemId: creado?.id, nombre: 'Mermelada de higos' });
    // El valor propio (600) no supera el recomendado (700 × 1,00): se respeta.
    expect(item?.valueCb).toBe(600);
    // La carga posterior del catálogo no lo toca.
    await loadCatalog(db, categorias, catalogo);
    expect((await listAllCatalog(db)).some((i) => i.slug === 'mermelada-de-higos')).toBe(true);
    expect((await db.query('SELECT 1 FROM notifications WHERE tipo = $1', ['producto_propio_vinculado'])).rows).toHaveLength(1);
  });

  it('ocultar con motivo: pasa a pausado, avisa a la familia y ella no puede reanudarlo', async () => {
    const id = await pending();
    expect(await applyReview(db, admin, id, { action: 'hide', motivo: 'Parece un producto no permitido' })).toEqual({ ok: true });
    expect((await listVisible(db)).items).toHaveLength(0);
    const mine = (await listMine(db, ana))[0];
    expect(mine).toMatchObject({ estado: 'pausado', hiddenReason: 'Parece un producto no permitido' });
    expect(await changeArticleState(db, ana, id, 'resume')).toEqual({ ok: false, code: 'hidden_by_admin' });
    const { rows } = await db.query<{ payload: { motivo: string } }>('SELECT payload FROM notifications WHERE user_id = $1', [ana]);
    expect(rows[0]?.payload.motivo).toBe('Parece un producto no permitido');
  });

  it('solo se revisa lo que está pendiente', async () => {
    const id = await pending();
    await applyReview(db, admin, id, { action: 'verify' });
    expect(await applyReview(db, admin, id, { action: 'verify' })).toEqual({ ok: false, code: 'not_found' });
    expect(await applyReview(db, admin, 424_242, { action: 'verify' })).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('Se busca', () => {
  it('cualquier familia publica lo que necesita y todas lo ven; solo quien la publicó la cierra', async () => {
    const huevos = await catalogId('huevos-camperos').catch(() => 0);
    const catalogItemId = huevos || (await firstOfType('bien')).id;
    const a = await createWant(db, ana, { catalogItemId, cantidad: 2, nota: 'Para el domingo' });
    const b = await createWant(db, beto, { textoLibre: 'Un yugo antiguo', cantidad: 1 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const list = await listOpenWants(db);
    expect(list).toHaveLength(2);
    expect(list.find((w) => w.id === b.id)).toMatchObject({ nombre: 'Un yugo antiguo', nick: 'Cigarrón', catalogItemId: null });
    expect(list.find((w) => w.id === a.id)).toMatchObject({ nick: 'Peliqueiro', cantidad: 2, nota: 'Para el domingo' });

    expect(await closeWant(db, beto, a.id)).toEqual({ ok: false, code: 'not_found' });
    expect(await closeWant(db, ana, a.id)).toEqual({ ok: true });
    expect((await listOpenWants(db)).map((w) => w.id)).toEqual([b.id]);
  });

  it('valida: hace falta producto o texto, producto existente y un máximo de búsquedas abiertas', async () => {
    expect(await createWant(db, ana, {})).toEqual({ ok: false, code: 'invalid' });
    expect(await createWant(db, ana, { catalogItemId: 999_999 })).toEqual({ ok: false, code: 'catalog_item_not_found' });
    for (let i = 0; i < config.busquedas.maxAbiertasPorFamilia; i += 1) {
      expect((await createWant(db, ana, { textoLibre: `Cosa número ${i}` })).ok).toBe(true);
    }
    expect(await createWant(db, ana, { textoLibre: 'Una más' })).toEqual({ ok: false, code: 'limit' });
    // Cerrar una libera hueco.
    const first = (await listOpenWants(db))[0];
    await closeWant(db, ana, first?.id as number);
    expect((await createWant(db, ana, { textoLibre: 'Una más' })).ok).toBe(true);
  });
});
