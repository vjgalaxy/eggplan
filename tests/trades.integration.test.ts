import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db/index.ts';
import { makeTestDb } from './helpers/test-db.ts';
import { categorias, catalogo } from '../src/data/catalogo.ts';
import { config } from '../src/data/config.ts';
import { loadCatalog } from '../src/lib/catalog/loader.ts';
import { updateCatalogItem } from '../src/lib/catalog/catalog.ts';
import { addCatalogArticle, addCustomArticle, changeArticleState, listMine, listVisible } from '../src/lib/stock/stock.ts';
import {
  acceptTrade,
  cancelTrade,
  counterTrade,
  createTrade,
  expireDue,
  getTrade,
  listTrades,
  markDelivered,
  markReturned,
  postMessage,
  rejectTrade,
} from '../src/lib/trades/trades.ts';
import { listTradesMetadata } from '../src/lib/trades/metadata.ts';
import { listAvisos, markRead, unreadCount } from '../src/lib/avisos.ts';
import { lineTotalCb, summarize } from '../src/lib/domain/trades.ts';

let db: Db;
let admin: number;
let ana: number; // propone
let beto: number; // recibe
let carla: number; // ajena a los trueques de ana y beto

async function user(seat: number | null, nick: string, role: 'member' | 'admin', status = 'activo'): Promise<number> {
  const { rows } = await db.query<{ id: number }>(`INSERT INTO users (seat, nick, role, status) VALUES ($1, $2, $3, $4) RETURNING id`, [seat, nick, role, status]);
  return rows[0]?.id as number;
}

async function item(owner: number, nombre: string, cantidad: number, valueCb: number, tipo: 'bien' | 'servicio' | 'prestamo' = 'bien', unidad = 'unidad'): Promise<number> {
  const result = await addCustomArticle(db, owner, { nombre, tipo, categoria: 'otros', unidad, cantidad, valueCb });
  if (!result.ok) throw new Error(`no se pudo crear ${nombre}: ${result.code}`);
  return result.value.id;
}

async function stockOf(id: number): Promise<{ cantidad: number; reservado: number }> {
  const { rows } = await db.query<{ cantidad: number; reservado: number }>('SELECT cantidad::float8 AS cantidad, reservado::float8 AS reservado FROM stock_items WHERE id = $1', [id]);
  return rows[0] as { cantidad: number; reservado: number };
}

async function propose(from: number, to: number, doy: [number, number][], recibo: [number, number][], mensaje?: string): Promise<number> {
  const result = await createTrade(db, from, {
    receiverId: to,
    doy: doy.map(([stockItemId, cantidad]) => ({ stockItemId, cantidad })),
    recibo: recibo.map(([stockItemId, cantidad]) => ({ stockItemId, cantidad })),
    mensaje,
  });
  if (!result.ok) throw new Error(`no se pudo proponer: ${result.code}`);
  return result.value.id;
}

let miel: number; // de ana: 10 × 8 B
let huevos: number; // de beto: 6 docenas × 4 B
let pan: number; // de beto: 5 × 2,5 B

beforeEach(async () => {
  db = await makeTestDb();
  admin = await user(null, 'admin', 'admin');
  ana = await user(1, 'Peliqueiro', 'member');
  beto = await user(2, 'Cigarrón', 'member');
  carla = await user(3, 'Pantalla', 'member');
  await loadCatalog(db, categorias, catalogo);
  miel = await item(ana, 'Miel de castaño', 10, 800, 'bien', 'tarro');
  huevos = await item(beto, 'Huevos camperos', 6, 400, 'bien', 'docena');
  pan = await item(beto, 'Pan de leña', 5, 250);
});

describe('importes y resumen (lógica pura)', () => {
  it('el total de una línea usa solo enteros y redondea a cB', () => {
    expect(lineTotalCb(400, 3)).toBe(1200);
    expect(lineTotalCb(250, 2.5)).toBe(625);
    expect(lineTotalCb(1850, 2.35)).toBe(4348); // 4347,5 → 4348 (sin errores de float)
    expect(lineTotalCb(1, 0.5)).toBe(1);
    expect(lineTotalCb(0, 10)).toBe(0);
  });

  it('«Tú das · Recibes · Diferencia» desde cada punto de vista', () => {
    const lines = [
      { lado: 'proposer' as const, valueCb: 800, cantidad: 2, unverified: false },
      { lado: 'receiver' as const, valueCb: 400, cantidad: 3, unverified: true },
    ];
    expect(summarize(lines, 'proposer')).toEqual({ giveCb: 1600, receiveCb: 1200, diffCb: -400, includesUnverified: true });
    expect(summarize(lines, 'receiver')).toEqual({ giveCb: 1200, receiveCb: 1600, diffCb: 400, includesUnverified: true });
    expect(summarize([], 'proposer')).toEqual({ giveCb: 0, receiveCb: 0, diffCb: 0, includesUnverified: false });
  });
});

describe('crear una propuesta', () => {
  it('guarda copias congeladas, calcula el resumen y avisa a quien la recibe; no reserva todavía', async () => {
    const id = await propose(ana, beto, [[miel, 2]], [[huevos, 3]], 'Hola, ¿te va bien el sábado?');
    const trade = await getTrade(db, ana, id);
    expect(trade).toMatchObject({ estado: 'pendiente', me: 'proposer', proposerDelivered: false });
    expect(trade?.lines).toHaveLength(2);
    expect(trade?.lines.find((l) => l.lado === 'proposer')).toMatchObject({ nombre: 'Miel de castaño', unidad: 'tarro', valueCb: 800, cantidad: 2, unverified: true });
    expect(trade?.summary).toEqual({ giveCb: 1600, receiveCb: 1200, diffCb: -400, includesUnverified: true });
    expect(trade?.messages.map((m) => m.cuerpo)).toEqual(['Hola, ¿te va bien el sábado?']);
    // Caduca a los 7 días.
    const days = (new Date(trade?.expiresAt ?? 0).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(config.propuestas.caducidadDias - 0.01);
    // La otra parte lo ve desde su lado y recibe un aviso.
    expect((await getTrade(db, beto, id))?.summary).toEqual({ giveCb: 1200, receiveCb: 1600, diffCb: 400, includesUnverified: true });
    expect((await listAvisos(db, beto)).map((a) => a.tipo)).toEqual(['propuesta_recibida']);
    // No hay reserva hasta que se acepta.
    expect(await stockOf(miel)).toEqual({ cantidad: 10, reservado: 0 });
    expect(await stockOf(huevos)).toEqual({ cantidad: 6, reservado: 0 });
  });

  it('puede ser un regalo (una de las partes sin líneas), pero no una propuesta vacía', async () => {
    const regalo = await propose(ana, beto, [[miel, 1]], []);
    expect((await getTrade(db, beto, regalo))?.summary).toMatchObject({ giveCb: 0, receiveCb: 800, diffCb: 800 });
    const pedido = await propose(ana, beto, [], [[huevos, 1]]);
    expect((await getTrade(db, ana, pedido))?.summary).toMatchObject({ giveCb: 0, receiveCb: 400 });
    expect(await createTrade(db, ana, { receiverId: beto, doy: [], recibo: [] })).toEqual({ ok: false, code: 'invalid' });
  });

  it('valida artículos, cantidades y destinatario en el servidor', async () => {
    const make = (over: Partial<Parameters<typeof createTrade>[2]>) => createTrade(db, ana, { receiverId: beto, doy: [{ stockItemId: miel, cantidad: 1 }], recibo: [], ...over });
    // Un artículo que no es de quien toca se trata como si no existiera.
    expect(await make({ doy: [{ stockItemId: huevos, cantidad: 1 }] })).toEqual({ ok: false, code: 'item_not_found' });
    expect(await make({ doy: [], recibo: [{ stockItemId: miel, cantidad: 1 }] })).toEqual({ ok: false, code: 'item_not_found' });
    expect(await make({ doy: [{ stockItemId: 999_999, cantidad: 1 }] })).toEqual({ ok: false, code: 'item_not_found' });
    // Cantidad insuficiente, cero, negativa, con demasiados decimales o repetida.
    expect(await make({ doy: [{ stockItemId: miel, cantidad: 10.5 }] })).toMatchObject({ ok: false, code: 'insufficient_stock', detail: 'Miel de castaño' });
    expect(await make({ doy: [{ stockItemId: miel, cantidad: 0 }] })).toEqual({ ok: false, code: 'invalid' });
    expect(await make({ doy: [{ stockItemId: miel, cantidad: -1 }] })).toEqual({ ok: false, code: 'invalid' });
    expect(await make({ doy: [{ stockItemId: miel, cantidad: 1.234 }] })).toEqual({ ok: false, code: 'invalid' });
    expect(await make({ doy: [{ stockItemId: miel, cantidad: 1 }, { stockItemId: miel, cantidad: 1 }] })).toEqual({ ok: false, code: 'invalid' });
    // No a uno mismo, ni a una plaza sin activar o bloqueada, ni al admin.
    expect(await make({ receiverId: ana })).toEqual({ ok: false, code: 'invalid' });
    const nueva = await user(4, 'Boteiro', 'member', 'sin_activar');
    expect(await make({ receiverId: nueva })).toEqual({ ok: false, code: 'receiver_unavailable' });
    await db.query(`UPDATE users SET status = 'bloqueado' WHERE id = $1`, [carla]);
    expect(await make({ receiverId: carla })).toEqual({ ok: false, code: 'receiver_unavailable' });
    expect(await make({ receiverId: admin })).toEqual({ ok: false, code: 'receiver_unavailable' });
    // Un artículo pausado de la otra parte no se puede pedir.
    await changeArticleState(db, beto, huevos, 'pause');
    expect(await make({ doy: [], recibo: [{ stockItemId: huevos, cantidad: 1 }] })).toMatchObject({ ok: false, code: 'item_unavailable' });
  });

  it('respeta el máximo de propuestas pendientes por familia', async () => {
    for (let i = 0; i < config.propuestas.maxPendientesPorFamilia; i += 1) await propose(ana, beto, [[miel, 1]], []);
    expect(await createTrade(db, ana, { receiverId: beto, doy: [{ stockItemId: miel, cantidad: 1 }], recibo: [] })).toEqual({ ok: false, code: 'limit_pending' });
    // El límite es de quien propone: beto sí puede proponer.
    expect((await createTrade(db, beto, { receiverId: ana, doy: [{ stockItemId: huevos, cantidad: 1 }], recibo: [] })).ok).toBe(true);
  });
});

describe('copia congelada', () => {
  it('la propuesta no cambia si después cambia la referencia del catálogo', async () => {
    const patata = (await db.query<{ id: number }>(`SELECT id FROM catalog_items WHERE slug = 'patata'`)).rows[0]?.id as number;
    const added = await addCatalogArticle(db, ana, { catalogItemId: patata, cantidad: 10 });
    if (!added.ok) throw new Error('alta');
    const id = await propose(ana, beto, [[added.value.id, 4]], [[huevos, 1]]);
    const before = (await getTrade(db, beto, id))?.lines.find((l) => l.stockItemId === added.value.id);
    expect(before?.valueCb).toBe(60);

    await updateCatalogItem(db, admin, patata, { refCb: 500 });
    // El stock sí refleja el cambio...
    expect((await listMine(db, ana)).find((i) => i.id === added.value.id)?.valueCb).toBe(500);
    // ...pero la línea de la propuesta conserva el valor del momento de crearla.
    const after = (await getTrade(db, beto, id))?.lines.find((l) => l.stockItemId === added.value.id);
    expect(after).toMatchObject({ valueCb: 60, nombre: 'Patata', cantidad: 4 });
    expect((await getTrade(db, beto, id))?.summary.receiveCb).toBe(240);
  });
});

describe('aceptar y reservar', () => {
  it('al aceptar se reserva el stock de las dos partes y se muestra «N reservadas»', async () => {
    const id = await propose(ana, beto, [[miel, 2]], [[huevos, 3]]);
    expect(await acceptTrade(db, beto, id)).toEqual({ ok: true });
    expect(await stockOf(miel)).toEqual({ cantidad: 10, reservado: 2 });
    expect(await stockOf(huevos)).toEqual({ cantidad: 6, reservado: 3 });
    const visto = (await listVisible(db)).items.find((i) => i.id === huevos);
    expect(visto).toMatchObject({ cantidad: 6, reservado: 3, disponible: 3 });
    expect((await getTrade(db, ana, id))?.estado).toBe('aceptada');
    expect((await listAvisos(db, ana)).map((a) => a.tipo)).toContain('propuesta_aceptada');
  });

  it('solo puede aceptar quien la recibe, y solo si está pendiente', async () => {
    const id = await propose(ana, beto, [[miel, 1]], []);
    expect(await acceptTrade(db, ana, id)).toEqual({ ok: false, code: 'forbidden_action' });
    expect(await acceptTrade(db, carla, id)).toEqual({ ok: false, code: 'not_found' });
    expect(await acceptTrade(db, beto, id)).toEqual({ ok: true });
    expect(await acceptTrade(db, beto, id)).toEqual({ ok: false, code: 'not_pending' });
  });

  it('vuelve a comprobar el stock al aceptar: si ya no hay, no se acepta y se explica por qué', async () => {
    const id = await propose(ana, beto, [[miel, 1]], [[huevos, 5]]);
    // Mientras tanto, beto reduce sus huevos a 2 docenas.
    await db.query('UPDATE stock_items SET cantidad = 2 WHERE id = $1', [huevos]);
    expect(await acceptTrade(db, beto, id)).toEqual({ ok: false, code: 'insufficient_stock', detail: 'Huevos camperos' });
    expect((await getTrade(db, beto, id))?.estado).toBe('pendiente');
    expect(await stockOf(miel)).toEqual({ cantidad: 10, reservado: 0 }); // nada se reservó a medias
    // O pausa el artículo.
    await db.query('UPDATE stock_items SET cantidad = 6 WHERE id = $1', [huevos]);
    await changeArticleState(db, beto, huevos, 'pause');
    expect(await acceptTrade(db, beto, id)).toMatchObject({ ok: false, code: 'item_unavailable' });
  });

  it('dos propuestas sobre el mismo stock: la segunda no se puede aceptar si ya no queda', async () => {
    const uno = await propose(ana, beto, [[miel, 7]], []);
    const dos = await propose(ana, beto, [[miel, 7]], []);
    expect(await acceptTrade(db, beto, uno)).toEqual({ ok: true });
    expect(await acceptTrade(db, beto, dos)).toMatchObject({ ok: false, code: 'insufficient_stock' });
    expect(await stockOf(miel)).toEqual({ cantidad: 10, reservado: 7 });
  });

  it('dos aceptaciones simultáneas sobre el mismo stock no pueden sobrevender', async () => {
    // Dos familias distintas piden lo mismo a ana: solo cabe una.
    const uno = await propose(beto, ana, [[huevos, 1]], [[miel, 6]]);
    const dos = await propose(carla, ana, [], [[miel, 6]]);
    const results = await Promise.all([acceptTrade(db, ana, uno), acceptTrade(db, ana, dos)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: 'insufficient_stock', detail: 'Miel de castaño' }]);
    const stock = await stockOf(miel);
    expect(stock.reservado).toBeLessThanOrEqual(stock.cantidad);
    expect(stock.reservado).toBe(6);
  });

  it('la base de datos impide reservar más de lo que hay, aunque falle el servidor', async () => {
    await expect(db.query('UPDATE stock_items SET reservado = cantidad + 1 WHERE id = $1', [miel])).rejects.toThrow();
  });

  it('una propuesta vencida no se puede aceptar y pasa a caducada', async () => {
    const id = await propose(ana, beto, [[miel, 1]], []);
    await db.query(`UPDATE trades SET expires_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    expect(await acceptTrade(db, beto, id)).toEqual({ ok: false, code: 'expired' });
    expect((await getTrade(db, beto, id))?.estado).toBe('caducada');
    expect(await stockOf(miel)).toEqual({ cantidad: 10, reservado: 0 });
  });
});

describe('rechazar, contraofertar y cancelar', () => {
  it('rechazar: solo quien la recibe, y se avisa a quien la propuso', async () => {
    const id = await propose(ana, beto, [[miel, 1]], []);
    expect(await rejectTrade(db, ana, id)).toEqual({ ok: false, code: 'forbidden_action' });
    expect(await rejectTrade(db, beto, id)).toEqual({ ok: true });
    expect((await getTrade(db, ana, id))?.estado).toBe('rechazada');
    expect((await listAvisos(db, ana)).map((a) => a.tipo)).toContain('propuesta_rechazada');
    expect(await rejectTrade(db, beto, id)).toEqual({ ok: false, code: 'not_pending' });
  });

  it('contraoferta: una propuesta nueva enlazada, con las partes invertidas; la original queda «contraofertada»', async () => {
    const id = await propose(ana, beto, [[miel, 4]], [[huevos, 1]]);
    // beto contraoferta: da 2 docenas de huevos y 1 pan, a cambio de 2 tarros de miel.
    const counter = await counterTrade(db, beto, id, { doy: [{ stockItemId: huevos, cantidad: 2 }, { stockItemId: pan, cantidad: 1 }], recibo: [{ stockItemId: miel, cantidad: 2 }], mensaje: '¿Y así?' });
    expect(counter.ok).toBe(true);
    if (!counter.ok) return;

    const original = await getTrade(db, ana, id);
    expect(original).toMatchObject({ estado: 'contraofertada', counterTradeId: counter.value.id });
    const nueva = await getTrade(db, ana, counter.value.id);
    expect(nueva).toMatchObject({ estado: 'pendiente', parentTradeId: id, me: 'receiver' });
    expect(nueva?.proposer.nick).toBe('Cigarrón');
    expect(nueva?.receiver.nick).toBe('Peliqueiro');
    expect(nueva?.lines.map((l) => [l.nombre, l.lado])).toEqual([
      ['Huevos camperos', 'proposer'],
      ['Pan de leña', 'proposer'],
      ['Miel de castaño', 'receiver'],
    ]);
    expect((await listAvisos(db, ana)).map((a) => a.tipo)).toContain('contraoferta_recibida');
    // La contraoferta se puede aceptar normalmente.
    expect(await acceptTrade(db, ana, counter.value.id)).toEqual({ ok: true });
    expect(await stockOf(miel)).toEqual({ cantidad: 10, reservado: 2 });
  });

  it('una contraoferta inválida no deja la original a medias', async () => {
    const id = await propose(ana, beto, [[miel, 1]], []);
    expect(await counterTrade(db, beto, id, { doy: [{ stockItemId: huevos, cantidad: 99 }], recibo: [] })).toMatchObject({ ok: false, code: 'insufficient_stock' });
    expect((await getTrade(db, beto, id))?.estado).toBe('pendiente');
    expect(await counterTrade(db, ana, id, { doy: [{ stockItemId: miel, cantidad: 1 }], recibo: [] })).toEqual({ ok: false, code: 'forbidden_action' });
  });

  it('cancelar una pendiente: solo quien la propuso; quien la recibe la rechaza', async () => {
    const id = await propose(ana, beto, [[miel, 1]], []);
    expect(await cancelTrade(db, beto, id)).toEqual({ ok: false, code: 'forbidden_action' });
    expect(await cancelTrade(db, ana, id)).toEqual({ ok: true });
    expect((await getTrade(db, beto, id))?.estado).toBe('cancelada');
    expect((await listAvisos(db, beto)).map((a) => a.tipo)).toContain('propuesta_cancelada');
    expect(await cancelTrade(db, ana, id)).toEqual({ ok: false, code: 'not_open' });
  });

  it('cancelar después de aceptar libera la reserva (cualquiera de las dos partes)', async () => {
    for (const canceller of [ana, beto]) {
      const id = await propose(ana, beto, [[miel, 3]], [[huevos, 2]]);
      await acceptTrade(db, beto, id);
      expect(await stockOf(miel)).toEqual({ cantidad: 10, reservado: 3 });
      expect(await cancelTrade(db, canceller, id)).toEqual({ ok: true });
      expect(await stockOf(miel)).toEqual({ cantidad: 10, reservado: 0 });
      expect(await stockOf(huevos)).toEqual({ cantidad: 6, reservado: 0 });
      expect((await getTrade(db, ana, id))?.estado).toBe('cancelada');
    }
  });
});

describe('entrega y finalización', () => {
  it('cuando las dos partes marcan «entregado» se completa: se descuenta el stock y se libera la reserva', async () => {
    const id = await propose(ana, beto, [[miel, 2]], [[huevos, 3]]);
    await acceptTrade(db, beto, id);

    expect(await markDelivered(db, ana, id)).toEqual({ ok: true, value: { completed: false } });
    expect((await getTrade(db, beto, id))).toMatchObject({ estado: 'aceptada', proposerDelivered: true, receiverDelivered: false });
    expect((await listAvisos(db, beto)).map((a) => a.tipo)).toContain('entregado');
    // Marcar otra vez es inocuo.
    expect(await markDelivered(db, ana, id)).toEqual({ ok: true, value: { completed: false } });
    expect(await stockOf(huevos)).toEqual({ cantidad: 6, reservado: 3 });

    expect(await markDelivered(db, beto, id)).toEqual({ ok: true, value: { completed: true } });
    expect((await getTrade(db, ana, id))?.estado).toBe('completada');
    expect(await stockOf(miel)).toEqual({ cantidad: 8, reservado: 0 });
    expect(await stockOf(huevos)).toEqual({ cantidad: 3, reservado: 0 });
    expect((await listAvisos(db, ana)).map((a) => a.tipo)).toContain('trueque_completado');
    expect((await listAvisos(db, beto)).map((a) => a.tipo)).toContain('trueque_completado');
    // El contador de trueques completados aparece en la ficha de cada familia.
    const { families } = await listVisible(db);
    expect(families.find((f) => f.id === ana)?.completados).toBe(1);
    expect(families.find((f) => f.id === carla)?.completados).toBe(0);
    // Ya no se puede cancelar ni volver a marcar.
    expect(await cancelTrade(db, ana, id)).toEqual({ ok: false, code: 'not_open' });
    expect(await markDelivered(db, ana, id)).toEqual({ ok: false, code: 'not_accepted' });
  });

  it('solo se entrega una propuesta aceptada', async () => {
    const id = await propose(ana, beto, [[miel, 1]], []);
    expect(await markDelivered(db, ana, id)).toEqual({ ok: false, code: 'not_accepted' });
    expect(await markDelivered(db, carla, id)).toEqual({ ok: false, code: 'not_found' });
  });

  it('un regalo también se completa cuando las dos partes lo confirman', async () => {
    const id = await propose(ana, beto, [[miel, 1]], []);
    await acceptTrade(db, beto, id);
    await markDelivered(db, ana, id);
    await markDelivered(db, beto, id);
    expect((await getTrade(db, ana, id))?.estado).toBe('completada');
    expect(await stockOf(miel)).toEqual({ cantidad: 9, reservado: 0 });
  });
});

describe('préstamos', () => {
  it('tras completarse queda «prestado» (reservado, sin descontar) hasta que quien presta marca «devuelto»', async () => {
    const taladro = await item(beto, 'Taladro percutor', 1, 300, 'prestamo', 'día');
    const id = await propose(ana, beto, [[miel, 1]], [[taladro, 1]]);
    await acceptTrade(db, beto, id);
    await markDelivered(db, ana, id);
    await markDelivered(db, beto, id);

    const done = await getTrade(db, ana, id);
    expect(done).toMatchObject({ estado: 'completada', onLoan: true });
    // La miel se descontó; el taladro NO: sigue reservado.
    expect(await stockOf(miel)).toEqual({ cantidad: 9, reservado: 0 });
    expect(await stockOf(taladro)).toEqual({ cantidad: 1, reservado: 1 });
    expect((await listVisible(db)).items.find((i) => i.id === taladro)).toMatchObject({ disponible: 0 });

    const line = done?.lines.find((l) => l.tipo === 'prestamo');
    expect(line).toMatchObject({ onLoan: true, returnedAt: null });
    // Solo quien presta (beto) puede marcarlo como devuelto.
    expect(await markReturned(db, ana, id, line?.id as number)).toEqual({ ok: false, code: 'forbidden_action' });
    expect(await markReturned(db, carla, id, line?.id as number)).toEqual({ ok: false, code: 'not_found' });
    expect(await markReturned(db, beto, id, line?.id as number)).toEqual({ ok: true });
    expect(await stockOf(taladro)).toEqual({ cantidad: 1, reservado: 0 });
    expect(await getTrade(db, ana, id)).toMatchObject({ onLoan: false });
    expect((await listAvisos(db, ana)).map((a) => a.tipo)).toContain('prestamo_devuelto');
    expect(await markReturned(db, beto, id, line?.id as number)).toEqual({ ok: false, code: 'already_returned' });
  });

  it('solo los préstamos se marcan como devueltos', async () => {
    const id = await propose(ana, beto, [[miel, 1]], []);
    await acceptTrade(db, beto, id);
    await markDelivered(db, ana, id);
    await markDelivered(db, beto, id);
    const line = (await getTrade(db, ana, id))?.lines[0];
    expect(await markReturned(db, ana, id, line?.id as number)).toEqual({ ok: false, code: 'not_loan' });
  });

  it('cancelar una propuesta aceptada con un préstamo también lo libera', async () => {
    const taladro = await item(beto, 'Taladro', 1, 300, 'prestamo', 'día');
    const id = await propose(ana, beto, [], [[taladro, 1]]);
    await acceptTrade(db, beto, id);
    expect(await stockOf(taladro)).toEqual({ cantidad: 1, reservado: 1 });
    await cancelTrade(db, ana, id);
    expect(await stockOf(taladro)).toEqual({ cantidad: 1, reservado: 0 });
  });
});

describe('hilo privado', () => {
  it('lo leen y escriben solo las dos partes; una tercera persona no sabe ni que existe', async () => {
    const id = await propose(ana, beto, [[miel, 1]], []);
    expect(await postMessage(db, beto, id, 'Me interesa, ¿puedo pasar mañana?')).toEqual({ ok: true });
    expect(await postMessage(db, carla, id, 'Intruso')).toEqual({ ok: false, code: 'not_found' });
    expect(await getTrade(db, carla, id)).toBeNull();
    expect((await listTrades(db, carla))).toHaveLength(0);
    expect((await getTrade(db, ana, id))?.messages.map((m) => [m.nick, m.cuerpo])).toEqual([['Cigarrón', 'Me interesa, ¿puedo pasar mañana?']]);
    expect(await acceptTrade(db, carla, id)).toEqual({ ok: false, code: 'not_found' });
    expect(await cancelTrade(db, carla, id)).toEqual({ ok: false, code: 'not_found' });
  });

  it('máximo 300 caracteres, no vacío, y se cierra cuando la propuesta termina sin acuerdo', async () => {
    const id = await propose(ana, beto, [[miel, 1]], []);
    expect(await postMessage(db, ana, id, 'x'.repeat(301))).toEqual({ ok: false, code: 'invalid' });
    expect(await postMessage(db, ana, id, '   ')).toEqual({ ok: false, code: 'invalid' });
    expect(await postMessage(db, ana, id, 'x'.repeat(300))).toEqual({ ok: true });
    await rejectTrade(db, beto, id);
    expect(await postMessage(db, ana, id, 'Una pena')).toEqual({ ok: false, code: 'thread_closed' });
    // Los textos de usuario se guardan tal cual (se muestran siempre como texto, nunca como HTML).
    const otra = await propose(ana, beto, [[miel, 1]], []);
    await postMessage(db, ana, otra, '<script>alert(1)</script>');
    expect((await getTrade(db, beto, otra))?.messages[0]?.cuerpo).toBe('<script>alert(1)</script>');
  });

  it('agrupa los avisos de mensaje sin leer en uno solo', async () => {
    const id = await propose(ana, beto, [[miel, 1]], []);
    await postMessage(db, ana, id, 'Uno');
    await postMessage(db, ana, id, 'Dos');
    await postMessage(db, ana, id, 'Tres');
    const mensajes = (await listAvisos(db, beto)).filter((a) => a.tipo === 'mensaje_propuesta');
    expect(mensajes).toHaveLength(1);
    // Tras leerlo, el siguiente mensaje genera un aviso nuevo.
    await markRead(db, beto, 'all');
    await postMessage(db, ana, id, 'Cuatro');
    expect((await listAvisos(db, beto)).filter((a) => a.tipo === 'mensaje_propuesta')).toHaveLength(2);
  });

  it('limita los mensajes por propuesta', async () => {
    const id = await propose(ana, beto, [[miel, 1]], []);
    for (let i = 0; i < config.propuestas.maxMensajesPorPropuesta; i += 1) await db.query('INSERT INTO trade_messages (trade_id, user_id, cuerpo) VALUES ($1, $2, $3)', [id, ana, `m${i}`]);
    expect(await postMessage(db, ana, id, 'uno más')).toEqual({ ok: false, code: 'message_limit' });
  });
});

describe('caducidad', () => {
  it('las pendientes vencidas pasan a «caducada» y se avisa a las dos partes', async () => {
    const vencida = await propose(ana, beto, [[miel, 1]], []);
    const vigente = await propose(ana, beto, [[miel, 1]], []);
    await db.query(`UPDATE trades SET expires_at = now() - interval '1 hour' WHERE id = $1`, [vencida]);

    const mine = await listTrades(db, ana); // la lectura caduca de paso
    expect(mine.find((t) => t.id === vencida)?.estado).toBe('caducada');
    expect(mine.find((t) => t.id === vigente)?.estado).toBe('pendiente');
    expect((await listAvisos(db, ana)).map((a) => a.tipo)).toContain('propuesta_caducada');
    expect((await listAvisos(db, beto)).map((a) => a.tipo)).toContain('propuesta_caducada');
    // Es idempotente: no vuelve a avisar.
    await db.tx((q) => expireDue(q));
    expect((await listAvisos(db, ana)).filter((a) => a.tipo === 'propuesta_caducada')).toHaveLength(1);
  });

  it('una propuesta aceptada no caduca', async () => {
    const id = await propose(ana, beto, [[miel, 1]], []);
    await acceptTrade(db, beto, id);
    await db.query(`UPDATE trades SET expires_at = now() - interval '30 days' WHERE id = $1`, [id]);
    await db.tx((q) => expireDue(q));
    expect((await getTrade(db, ana, id))?.estado).toBe('aceptada');
  });
});

describe('avisos', () => {
  it('contador de no leídos, y cada persona solo marca como leídos los suyos', async () => {
    await propose(ana, beto, [[miel, 1]], []);
    await propose(ana, beto, [[miel, 1]], []);
    expect(await unreadCount(db, beto)).toBe(2);
    expect(await unreadCount(db, ana)).toBe(0);

    const [first] = await listAvisos(db, beto);
    await markRead(db, ana, [first?.id as number]); // ajeno: no tiene efecto
    expect(await unreadCount(db, beto)).toBe(2);
    await markRead(db, beto, [first?.id as number]);
    expect(await unreadCount(db, beto)).toBe(1);
    await markRead(db, beto, 'all');
    expect(await unreadCount(db, beto)).toBe(0);
  });
});

describe('la administración ve metadatos, nunca el hilo', () => {
  it('lista partes, estado, fechas, líneas y valores, sin mensajes', async () => {
    const id = await propose(ana, beto, [[miel, 2]], [[huevos, 3]], 'Mensaje privado que el admin no debe ver');
    await postMessage(db, beto, id, 'Otro mensaje privado');
    await acceptTrade(db, beto, id);

    const metadata = await listTradesMetadata(db);
    expect(metadata).toHaveLength(1);
    expect(metadata[0]).toMatchObject({ id, proposer: 'Peliqueiro', receiver: 'Cigarrón', estado: 'aceptada', proposerDelivered: false });
    expect(metadata[0]?.lines.map((l) => [l.lado, l.nombre, l.cantidad, l.valueCb])).toEqual([
      ['proposer', 'Miel de castaño', 2, 800],
      ['receiver', 'Huevos camperos', 3, 400],
    ]);
    expect(metadata[0]?.summary).toMatchObject({ giveCb: 1600, receiveCb: 1200 });
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain('privado');
    expect(serialized).not.toContain('cuerpo');
    expect(serialized).not.toContain('messages');
  });
});
