/**
 * Trueques (propuestas). Todas las operaciones que tocan el stock van en transacciones con
 * bloqueo de filas (`FOR UPDATE`), siempre en el mismo orden (primero la propuesta, luego los
 * artículos por id), para que dos aceptaciones simultáneas no puedan vender dos veces lo mismo.
 * Además la base de datos tiene `CHECK (reservado <= cantidad)` como última barrera.
 *
 * Ciclo de vida:
 *   pendiente → aceptada | rechazada | cancelada | caducada | contraofertada
 *   aceptada  → completada (las dos partes marcan «entregado») | cancelada (se libera la reserva)
 * El stock se reserva AL ACEPTAR (no al crear) y se descuenta al completar. Los préstamos no
 * descuentan: la cantidad queda reservada («prestado») hasta que quien presta marca «devuelto».
 *
 * Privacidad: el hilo (`trade_messages`) solo lo leen las dos partes; la administración solo ve
 * metadatos (ver `metadata.ts`). Cada operación comprueba que quien llama es una de las partes.
 */
import type { Db, Queryable } from '../db/index.ts';
import { config } from '../../data/config.ts';
import { summarize, type TradeState, type TradeSummary } from '../domain/trades.ts';
import { notify } from '../notifications.ts';
import { fetchItems } from '../stock/stock.ts';
import type { Condicion, Tipo } from '../domain/values.ts';

export type TradeError =
  | 'not_found'
  | 'invalid'
  | 'receiver_unavailable'
  | 'item_not_found'
  | 'item_unavailable'
  | 'insufficient_stock'
  | 'limit_pending'
  | 'too_many_lines'
  | 'not_pending'
  | 'not_open'
  | 'not_accepted'
  | 'expired'
  | 'forbidden_action'
  | 'thread_closed'
  | 'message_limit'
  | 'not_loan'
  | 'already_returned';

export type Outcome<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; value: T })
  | { ok: false; code: TradeError; detail?: string };

const fail = (code: TradeError, detail?: string) => ({ ok: false as const, code, ...(detail === undefined ? {} : { detail }) });

// --- Vistas ----------------------------------------------------------------------------------

export interface TradeLineView {
  id: number;
  lado: 'proposer' | 'receiver';
  stockItemId: number | null;
  tipo: Tipo;
  nombre: string;
  unidad: string;
  valueCb: number;
  condicion: Condicion | null;
  cantidad: number;
  unverified: boolean;
  returnedAt: string | null;
  /** Préstamo que sigue en manos de quien lo recibió. */
  onLoan: boolean;
}

export interface TradeParty {
  id: number;
  nick: string;
  avatar: string | null;
}

export interface TradeView {
  id: number;
  proposer: TradeParty;
  receiver: TradeParty;
  /** Desde el punto de vista de quien mira. */
  me: 'proposer' | 'receiver';
  estado: TradeState;
  parentTradeId: number | null;
  /** Contraoferta que sustituye a esta propuesta, si la hay. */
  counterTradeId: number | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  proposerDelivered: boolean;
  receiverDelivered: boolean;
  completedAt: string | null;
  lines: TradeLineView[];
  summary: TradeSummary;
  /** Completada, pero con algún préstamo todavía sin devolver. */
  onLoan: boolean;
}

export interface TradeMessageView {
  id: number;
  userId: number;
  nick: string;
  cuerpo: string;
  createdAt: string;
}

export interface TradeDetail extends TradeView {
  messages: TradeMessageView[];
}

interface RawTrade {
  id: number;
  proposer_id: number;
  receiver_id: number;
  p_nick: string;
  p_avatar: string | null;
  r_nick: string;
  r_avatar: string | null;
  estado: TradeState;
  parent_trade_id: number | null;
  counter_id: number | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  proposer_delivered_at: Date | null;
  receiver_delivered_at: Date | null;
  completed_at: Date | null;
  expired: boolean;
}

interface RawLine {
  id: number;
  trade_id: number;
  lado: 'proposer' | 'receiver';
  stock_item_id: number | null;
  tipo: Tipo;
  nombre: string;
  unidad: string;
  valor_unit_cb: number;
  condicion: Condicion | null;
  cantidad: number;
  valor_sin_verificar: boolean;
  reservado_activo: boolean;
  returned_at: Date | null;
}

const TRADE_SELECT = `
  SELECT t.id, t.proposer_id, t.receiver_id, p.nick AS p_nick, p.avatar AS p_avatar, r.nick AS r_nick, r.avatar AS r_avatar,
         t.estado, t.parent_trade_id,
         (SELECT c.id FROM trades c WHERE c.parent_trade_id = t.id ORDER BY c.id LIMIT 1) AS counter_id,
         t.created_at, t.updated_at, t.expires_at, t.proposer_delivered_at, t.receiver_delivered_at, t.completed_at,
         (t.expires_at < now()) AS expired
    FROM trades t
    JOIN users p ON p.id = t.proposer_id
    JOIN users r ON r.id = t.receiver_id`;

const LINE_SELECT = `
  SELECT id, trade_id, lado, stock_item_id, tipo, nombre, unidad, valor_unit_cb, condicion,
         cantidad::float8 AS cantidad, valor_sin_verificar, reservado_activo, returned_at
    FROM trade_lines`;

const iso = (d: Date) => new Date(d).toISOString();

function toView(t: RawTrade, lines: RawLine[], userId: number): TradeView {
  const me = t.proposer_id === userId ? 'proposer' : 'receiver';
  const lineViews: TradeLineView[] = lines.map((l) => ({
    id: l.id,
    lado: l.lado,
    stockItemId: l.stock_item_id,
    tipo: l.tipo,
    nombre: l.nombre,
    unidad: l.unidad,
    valueCb: l.valor_unit_cb,
    condicion: l.condicion,
    cantidad: l.cantidad,
    unverified: l.valor_sin_verificar,
    returnedAt: l.returned_at ? iso(l.returned_at) : null,
    onLoan: t.estado === 'completada' && l.tipo === 'prestamo' && l.returned_at === null,
  }));
  return {
    id: t.id,
    proposer: { id: t.proposer_id, nick: t.p_nick, avatar: t.p_avatar },
    receiver: { id: t.receiver_id, nick: t.r_nick, avatar: t.r_avatar },
    me,
    estado: t.estado,
    parentTradeId: t.parent_trade_id,
    counterTradeId: t.counter_id,
    createdAt: iso(t.created_at),
    updatedAt: iso(t.updated_at),
    expiresAt: iso(t.expires_at),
    proposerDelivered: t.proposer_delivered_at !== null,
    receiverDelivered: t.receiver_delivered_at !== null,
    completedAt: t.completed_at ? iso(t.completed_at) : null,
    lines: lineViews,
    summary: summarize(
      lineViews.map((l) => ({ lado: l.lado, valueCb: l.valueCb, cantidad: l.cantidad, unverified: l.unverified })),
      me,
    ),
    onLoan: lineViews.some((l) => l.onLoan),
  };
}

// --- Caducidad -------------------------------------------------------------------------------

/** Pasa a «caducada» las propuestas pendientes vencidas y avisa a las dos partes. Idempotente. */
export async function expireDue(q: Queryable): Promise<number> {
  const { rows } = await q.query<{ id: number; proposer_id: number; receiver_id: number; p_nick: string; r_nick: string }>(
    `UPDATE trades t SET estado = 'caducada', updated_at = now()
       FROM users p, users r
      WHERE t.estado = 'pendiente' AND t.expires_at < now() AND p.id = t.proposer_id AND r.id = t.receiver_id
      RETURNING t.id, t.proposer_id, t.receiver_id, p.nick AS p_nick, r.nick AS r_nick`,
  );
  for (const row of rows) {
    await notify(q, row.proposer_id, 'propuesta_caducada', { tradeId: row.id, nick: row.r_nick });
    await notify(q, row.receiver_id, 'propuesta_caducada', { tradeId: row.id, nick: row.p_nick });
  }
  return rows.length;
}

// --- Lectura ---------------------------------------------------------------------------------

/** Mis propuestas (las más recientes primero). Caduca de paso las vencidas. */
export async function listTrades(db: Db, userId: number): Promise<TradeView[]> {
  await db.tx((q) => expireDue(q));
  const { rows } = await db.query<RawTrade>(
    `${TRADE_SELECT} WHERE t.proposer_id = $1 OR t.receiver_id = $1 ORDER BY t.updated_at DESC, t.id DESC LIMIT 100`,
    [userId],
  );
  if (rows.length === 0) return [];
  const { rows: lines } = await db.query<RawLine>(`${LINE_SELECT} WHERE trade_id = ANY($1::int[]) ORDER BY id`, [rows.map((r) => r.id)]);
  return rows.map((t) => toView(t, lines.filter((l) => l.trade_id === t.id), userId));
}

/** Una propuesta con su hilo. Solo para sus dos partes: para cualquier otra persona, `null` (como si no existiera). */
export async function getTrade(db: Db, userId: number, tradeId: number): Promise<TradeDetail | null> {
  await db.tx((q) => expireDue(q));
  const { rows } = await db.query<RawTrade>(`${TRADE_SELECT} WHERE t.id = $1 AND (t.proposer_id = $2 OR t.receiver_id = $2)`, [tradeId, userId]);
  const trade = rows[0];
  if (!trade) return null;
  const { rows: lines } = await db.query<RawLine>(`${LINE_SELECT} WHERE trade_id = $1 ORDER BY id`, [tradeId]);
  const { rows: messages } = await db.query<{ id: number; user_id: number; nick: string; cuerpo: string; created_at: Date }>(
    `SELECT m.id, m.user_id, u.nick, m.cuerpo, m.created_at
       FROM trade_messages m JOIN users u ON u.id = m.user_id WHERE m.trade_id = $1 ORDER BY m.id`,
    [tradeId],
  );
  return {
    ...toView(trade, lines, userId),
    messages: messages.map((m) => ({ id: m.id, userId: m.user_id, nick: m.nick, cuerpo: m.cuerpo, createdAt: iso(m.created_at) })),
  };
}

// --- Crear -----------------------------------------------------------------------------------

export interface LineRequest {
  stockItemId: number;
  cantidad: number;
}

export interface NewTradeInput {
  receiverId: number;
  /** Líneas de MI stock que doy. */
  doy: LineRequest[];
  /** Líneas del stock de la otra familia que recibo. */
  recibo: LineRequest[];
  mensaje?: string | null | undefined;
}

interface BuiltLine {
  lado: 'proposer' | 'receiver';
  stockItemId: number;
  tipo: Tipo;
  nombre: string;
  unidad: string;
  valueCb: number;
  condicion: Condicion | null;
  cantidad: number;
  unverified: boolean;
}

const hundredths = (n: number) => Math.round(n * 100);

/** Comprueba que cada artículo es de quien debe, está activo y tiene cantidad libre, y crea las copias congeladas. */
async function buildLines(
  q: Queryable,
  proposerId: number,
  receiverId: number,
  doy: readonly LineRequest[],
  recibo: readonly LineRequest[],
): Promise<Outcome<BuiltLine[]>> {
  if (doy.length + recibo.length === 0) return fail('invalid');
  if (doy.length > config.propuestas.maxLineasPorLado || recibo.length > config.propuestas.maxLineasPorLado) return fail('too_many_lines');
  const requests = [
    ...doy.map((l) => ({ ...l, lado: 'proposer' as const, owner: proposerId })),
    ...recibo.map((l) => ({ ...l, lado: 'receiver' as const, owner: receiverId })),
  ];
  const ids = requests.map((r) => r.stockItemId);
  if (new Set(ids).size !== ids.length) return fail('invalid'); // un artículo, una sola línea
  // Cantidades positivas con, como mucho, dos decimales.
  if (requests.some((r) => !(r.cantidad > 0) || Math.abs(r.cantidad * 100 - hundredths(r.cantidad)) > 1e-6)) return fail('invalid');

  const found = new Map((await fetchItems(q, ids)).map((f) => [f.item.id, f]));
  const built: BuiltLine[] = [];
  for (const request of requests) {
    const entry = found.get(request.stockItemId);
    // Si el artículo no es de quien toca, se responde igual que si no existiera.
    if (!entry || entry.item.userId !== request.owner) return fail('item_not_found');
    const { item } = entry;
    if (entry.estado !== 'activo' || entry.ownerStatus === 'bloqueado') return fail('item_unavailable', item.nombre);
    if (hundredths(item.disponible) < hundredths(request.cantidad)) return fail('insufficient_stock', item.nombre);
    built.push({
      lado: request.lado,
      stockItemId: item.id,
      tipo: item.tipo,
      nombre: item.nombre,
      unidad: item.unidad,
      valueCb: item.valueCb,
      condicion: item.tipo === 'bien' ? item.condicion : null,
      cantidad: request.cantidad,
      unverified: item.unverified,
    });
  }
  return { ok: true, value: built };
}

async function createInternal(
  q: Queryable,
  proposerId: number,
  input: NewTradeInput,
  options: { parentTradeId?: number; noticeType: 'propuesta_recibida' | 'contraoferta_recibida' },
): Promise<Outcome<{ id: number }>> {
  if (input.receiverId === proposerId) return fail('invalid');
  const { rows: people } = await q.query<{ id: number; nick: string; status: string; role: string }>(
    'SELECT id, nick, status, role FROM users WHERE id IN ($1, $2)',
    [proposerId, input.receiverId],
  );
  const proposer = people.find((p) => p.id === proposerId);
  const receiver = people.find((p) => p.id === input.receiverId);
  if (!proposer || proposer.role !== 'member' || proposer.status === 'bloqueado') return fail('forbidden_action');
  // Solo se puede proponer a una familia con la plaza activada y no bloqueada.
  if (!receiver || receiver.role !== 'member' || receiver.status !== 'activo') return fail('receiver_unavailable');

  const { rows: pending } = await q.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM trades WHERE proposer_id = $1 AND estado = 'pendiente'`,
    [proposerId],
  );
  if (Number(pending[0]?.n ?? 0) >= config.propuestas.maxPendientesPorFamilia) return fail('limit_pending');

  const built = await buildLines(q, proposerId, input.receiverId, input.doy, input.recibo);
  if (!built.ok) return built;

  const { rows } = await q.query<{ id: number }>(
    `INSERT INTO trades (proposer_id, receiver_id, parent_trade_id, expires_at)
     VALUES ($1, $2, $3, now() + ($4::int * interval '1 day')) RETURNING id`,
    [proposerId, input.receiverId, options.parentTradeId ?? null, config.propuestas.caducidadDias],
  );
  const id = rows[0]?.id as number;
  for (const line of built.value) {
    await q.query(
      `INSERT INTO trade_lines (trade_id, lado, stock_item_id, tipo, nombre, unidad, valor_unit_cb, condicion, cantidad, valor_sin_verificar)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, line.lado, line.stockItemId, line.tipo, line.nombre, line.unidad, line.valueCb, line.condicion, line.cantidad, line.unverified],
    );
  }
  const text = input.mensaje?.trim();
  if (text) await q.query('INSERT INTO trade_messages (trade_id, user_id, cuerpo) VALUES ($1, $2, $3)', [id, proposerId, text]);
  await notify(q, input.receiverId, options.noticeType, { tradeId: id, nick: proposer.nick });
  return { ok: true, value: { id } };
}

export async function createTrade(db: Db, userId: number, input: NewTradeInput): Promise<Outcome<{ id: number }>> {
  return db.tx((q) => createInternal(q, userId, input, { noticeType: 'propuesta_recibida' }));
}

// --- Acciones sobre una propuesta -----------------------------------------------------------

async function lockTrade(q: Queryable, tradeId: number, userId: number): Promise<RawTrade | undefined> {
  const { rows } = await q.query<RawTrade>(
    `${TRADE_SELECT} WHERE t.id = $1 AND (t.proposer_id = $2 OR t.receiver_id = $2) FOR UPDATE OF t`,
    [tradeId, userId],
  );
  return rows[0];
}

const otherParty = (t: RawTrade, userId: number) =>
  userId === t.proposer_id ? { id: t.receiver_id, nick: t.r_nick } : { id: t.proposer_id, nick: t.p_nick };
const myNick = (t: RawTrade, userId: number) => (userId === t.proposer_id ? t.p_nick : t.r_nick);

/** Marca como caducada una propuesta vencida que se intenta usar. */
async function expireOne(q: Queryable, t: RawTrade): Promise<void> {
  await q.query(`UPDATE trades SET estado = 'caducada', updated_at = now() WHERE id = $1`, [t.id]);
  await notify(q, t.proposer_id, 'propuesta_caducada', { tradeId: t.id, nick: t.r_nick });
  await notify(q, t.receiver_id, 'propuesta_caducada', { tradeId: t.id, nick: t.p_nick });
}

/** Libera (o descuenta) la cantidad reservada de las líneas. Bloquea los artículos en orden de id. */
async function settleReservations(q: Queryable, tradeId: number, mode: 'release' | 'complete'): Promise<void> {
  const { rows: lines } = await q.query<RawLine>(`${LINE_SELECT} WHERE trade_id = $1 AND reservado_activo ORDER BY stock_item_id, id`, [tradeId]);
  const ids = lines.flatMap((l) => (l.stock_item_id === null ? [] : [l.stock_item_id]));
  await fetchItems(q, ids, { lock: true });
  for (const line of lines) {
    // Al completar, los préstamos siguen reservados («prestado») hasta que se devuelvan.
    if (mode === 'complete' && line.tipo === 'prestamo') continue;
    if (line.stock_item_id !== null) {
      if (mode === 'complete') {
        await q.query(
          `UPDATE stock_items SET cantidad = cantidad - $2, reservado = GREATEST(reservado - $2, 0), updated_at = now() WHERE id = $1`,
          [line.stock_item_id, line.cantidad],
        );
      } else {
        await q.query(`UPDATE stock_items SET reservado = GREATEST(reservado - $2, 0), updated_at = now() WHERE id = $1`, [
          line.stock_item_id,
          line.cantidad,
        ]);
      }
    }
    await q.query('UPDATE trade_lines SET reservado_activo = false WHERE id = $1', [line.id]);
  }
}

export async function acceptTrade(db: Db, userId: number, tradeId: number): Promise<Outcome> {
  return db.tx(async (q): Promise<Outcome> => {
    const t = await lockTrade(q, tradeId, userId);
    if (!t) return fail('not_found');
    if (t.receiver_id !== userId) return fail('forbidden_action');
    if (t.estado !== 'pendiente') return fail('not_pending');
    if (t.expired) {
      await expireOne(q, t);
      return fail('expired');
    }

    const { rows: lines } = await q.query<RawLine>(`${LINE_SELECT} WHERE trade_id = $1 ORDER BY id`, [tradeId]);
    // Se vuelve a comprobar el stock con las filas bloqueadas: aquí es donde no se puede vender dos veces.
    const items = new Map(
      (await fetchItems(q, lines.flatMap((l) => (l.stock_item_id === null ? [] : [l.stock_item_id])), { lock: true })).map((f) => [f.item.id, f]),
    );
    for (const line of lines) {
      const entry = line.stock_item_id === null ? undefined : items.get(line.stock_item_id);
      const owner = line.lado === 'proposer' ? t.proposer_id : t.receiver_id;
      if (!entry || entry.item.userId !== owner || entry.estado !== 'activo' || entry.ownerStatus === 'bloqueado') {
        return fail('item_unavailable', line.nombre);
      }
      if (hundredths(entry.item.disponible) < hundredths(line.cantidad)) return fail('insufficient_stock', line.nombre);
    }
    for (const line of lines) {
      await q.query('UPDATE stock_items SET reservado = reservado + $2, updated_at = now() WHERE id = $1', [line.stock_item_id, line.cantidad]);
      await q.query('UPDATE trade_lines SET reservado_activo = true WHERE id = $1', [line.id]);
    }
    await q.query(`UPDATE trades SET estado = 'aceptada', responded_at = now(), updated_at = now() WHERE id = $1`, [tradeId]);
    await notify(q, t.proposer_id, 'propuesta_aceptada', { tradeId, nick: t.r_nick });
    return { ok: true };
  });
}

export async function rejectTrade(db: Db, userId: number, tradeId: number): Promise<Outcome> {
  return db.tx(async (q): Promise<Outcome> => {
    const t = await lockTrade(q, tradeId, userId);
    if (!t) return fail('not_found');
    if (t.receiver_id !== userId) return fail('forbidden_action');
    if (t.estado !== 'pendiente') return fail('not_pending');
    await q.query(`UPDATE trades SET estado = 'rechazada', responded_at = now(), updated_at = now() WHERE id = $1`, [tradeId]);
    await notify(q, t.proposer_id, 'propuesta_rechazada', { tradeId, nick: t.r_nick });
    return { ok: true };
  });
}

/**
 * Cancelar. Mientras está pendiente solo puede quien la propuso (quien la recibe la rechaza o
 * contraoferta). Una vez aceptada, cualquiera de las dos partes: se libera la reserva.
 */
export async function cancelTrade(db: Db, userId: number, tradeId: number): Promise<Outcome> {
  return db.tx(async (q): Promise<Outcome> => {
    const t = await lockTrade(q, tradeId, userId);
    if (!t) return fail('not_found');
    if (t.estado === 'pendiente') {
      if (t.proposer_id !== userId) return fail('forbidden_action');
    } else if (t.estado === 'aceptada') {
      await settleReservations(q, tradeId, 'release');
    } else {
      return fail('not_open');
    }
    await q.query(`UPDATE trades SET estado = 'cancelada', updated_at = now() WHERE id = $1`, [tradeId]);
    const other = otherParty(t, userId);
    await notify(q, other.id, 'propuesta_cancelada', { tradeId, nick: myNick(t, userId) });
    return { ok: true };
  });
}

/** Contraoferta: quien recibió la propuesta crea otra nueva, enlazada, y la original queda «contraofertada». */
export async function counterTrade(
  db: Db,
  userId: number,
  tradeId: number,
  input: { doy: LineRequest[]; recibo: LineRequest[]; mensaje?: string | null | undefined },
): Promise<Outcome<{ id: number }>> {
  return db.tx(async (q): Promise<Outcome<{ id: number }>> => {
    const t = await lockTrade(q, tradeId, userId);
    if (!t) return fail('not_found');
    if (t.receiver_id !== userId) return fail('forbidden_action');
    if (t.estado !== 'pendiente') return fail('not_pending');
    if (t.expired) {
      await expireOne(q, t);
      return fail('expired');
    }
    // Quien contraoferta pasa a ser quien propone: «doy» son artículos suyos y «recibo», de la otra parte.
    const created = await createInternal(
      q,
      userId,
      { receiverId: t.proposer_id, doy: input.doy, recibo: input.recibo, mensaje: input.mensaje },
      { parentTradeId: tradeId, noticeType: 'contraoferta_recibida' },
    );
    if (!created.ok) return created;
    await q.query(`UPDATE trades SET estado = 'contraofertada', responded_at = now(), updated_at = now() WHERE id = $1`, [tradeId]);
    return created;
  });
}

/** Cada parte marca «entregado». Cuando las dos lo han hecho, se completa: se descuenta el stock y se libera la reserva. */
export async function markDelivered(db: Db, userId: number, tradeId: number): Promise<Outcome<{ completed: boolean }>> {
  return db.tx(async (q): Promise<Outcome<{ completed: boolean }>> => {
    const t = await lockTrade(q, tradeId, userId);
    if (!t) return fail('not_found');
    if (t.estado !== 'aceptada') return fail('not_accepted');

    const mineIsProposer = t.proposer_id === userId;
    const alreadyMine = mineIsProposer ? t.proposer_delivered_at !== null : t.receiver_delivered_at !== null;
    const otherDone = mineIsProposer ? t.receiver_delivered_at !== null : t.proposer_delivered_at !== null;
    if (alreadyMine) return { ok: true, value: { completed: false } }; // idempotente

    await q.query(
      `UPDATE trades SET ${mineIsProposer ? 'proposer_delivered_at' : 'receiver_delivered_at'} = now(), updated_at = now() WHERE id = $1`,
      [tradeId],
    );
    const other = otherParty(t, userId);
    if (!otherDone) {
      await notify(q, other.id, 'entregado', { tradeId, nick: myNick(t, userId) });
      return { ok: true, value: { completed: false } };
    }
    await settleReservations(q, tradeId, 'complete');
    await q.query(`UPDATE trades SET estado = 'completada', completed_at = now(), updated_at = now() WHERE id = $1`, [tradeId]);
    await notify(q, t.proposer_id, 'trueque_completado', { tradeId, nick: t.r_nick });
    await notify(q, t.receiver_id, 'trueque_completado', { tradeId, nick: t.p_nick });
    return { ok: true, value: { completed: true } };
  });
}

/** Quien prestó marca el préstamo como devuelto: se libera la cantidad reservada. */
export async function markReturned(db: Db, userId: number, tradeId: number, lineId: number): Promise<Outcome> {
  return db.tx(async (q): Promise<Outcome> => {
    const t = await lockTrade(q, tradeId, userId);
    if (!t) return fail('not_found');
    if (t.estado !== 'completada') return fail('not_open');
    const { rows } = await q.query<RawLine>(`${LINE_SELECT} WHERE id = $1 AND trade_id = $2 FOR UPDATE`, [lineId, tradeId]);
    const line = rows[0];
    if (!line) return fail('not_found');
    if (line.tipo !== 'prestamo') return fail('not_loan');
    // Solo quien presta (quien da esa línea) puede marcarla como devuelta.
    if ((line.lado === 'proposer' ? t.proposer_id : t.receiver_id) !== userId) return fail('forbidden_action');
    if (line.returned_at !== null) return fail('already_returned');

    if (line.stock_item_id !== null && line.reservado_activo) {
      await fetchItems(q, [line.stock_item_id], { lock: true });
      await q.query(`UPDATE stock_items SET reservado = GREATEST(reservado - $2, 0), updated_at = now() WHERE id = $1`, [
        line.stock_item_id,
        line.cantidad,
      ]);
    }
    await q.query('UPDATE trade_lines SET returned_at = now(), reservado_activo = false WHERE id = $1', [lineId]);
    await q.query('UPDATE trades SET updated_at = now() WHERE id = $1', [tradeId]);
    await notify(q, otherParty(t, userId).id, 'prestamo_devuelto', { tradeId, nick: myNick(t, userId), articulo: line.nombre });
    return { ok: true };
  });
}

/** Mensaje corto en el hilo (solo lo ven las dos partes). Avisa a la otra parte, agrupando los avisos sin leer. */
export async function postMessage(db: Db, userId: number, tradeId: number, cuerpo: string): Promise<Outcome> {
  const text = cuerpo.trim();
  if (text.length === 0 || [...text].length > config.propuestas.maxCaracteresMensaje) return fail('invalid');
  return db.tx(async (q): Promise<Outcome> => {
    const t = await lockTrade(q, tradeId, userId);
    if (!t) return fail('not_found');
    if (t.estado !== 'pendiente' && t.estado !== 'aceptada' && t.estado !== 'completada') return fail('thread_closed');
    const { rows } = await q.query<{ n: string }>('SELECT count(*)::text AS n FROM trade_messages WHERE trade_id = $1', [tradeId]);
    if (Number(rows[0]?.n ?? 0) >= config.propuestas.maxMensajesPorPropuesta) return fail('message_limit');

    await q.query('INSERT INTO trade_messages (trade_id, user_id, cuerpo) VALUES ($1, $2, $3)', [tradeId, userId, text]);
    await q.query('UPDATE trades SET updated_at = now() WHERE id = $1', [tradeId]);

    const other = otherParty(t, userId);
    const { rows: existing } = await q.query(
      `UPDATE notifications SET created_at = now()
        WHERE user_id = $1 AND tipo = 'mensaje_propuesta' AND read_at IS NULL AND (payload->>'tradeId')::int = $2
        RETURNING id`,
      [other.id, tradeId],
    );
    if (existing.length === 0) await notify(q, other.id, 'mensaje_propuesta', { tradeId, nick: myNick(t, userId) });
    return { ok: true };
  });
}
