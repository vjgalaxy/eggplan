/**
 * Trueques para la administración: SOLO metadatos (partes, estado, fechas, líneas y valores),
 * para métricas y para resolver conflictos. Aquí no se consulta el hilo de mensajes: es privado
 * de las dos partes y no existe ninguna vía de administración hacia él.
 */
import type { Queryable } from '../db/index.ts';
import { summarize, type TradeState, type TradeSummary } from '../domain/trades.ts';
import type { Tipo } from '../domain/values.ts';

export interface TradeMetadata {
  id: number;
  proposer: string;
  receiver: string;
  estado: TradeState;
  parentTradeId: number | null;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
  proposerDelivered: boolean;
  receiverDelivered: boolean;
  lines: { lado: 'proposer' | 'receiver'; nombre: string; unidad: string; cantidad: number; valueCb: number; tipo: Tipo; unverified: boolean; returned: boolean }[];
  /** Visto desde quien propone. */
  summary: TradeSummary;
}

export async function listTradesMetadata(db: Queryable, limit = 200): Promise<TradeMetadata[]> {
  const { rows: trades } = await db.query<{
    id: number;
    p_nick: string;
    r_nick: string;
    estado: TradeState;
    parent_trade_id: number | null;
    created_at: Date;
    expires_at: Date;
    completed_at: Date | null;
    proposer_delivered_at: Date | null;
    receiver_delivered_at: Date | null;
  }>(
    `SELECT t.id, p.nick AS p_nick, r.nick AS r_nick, t.estado, t.parent_trade_id, t.created_at, t.expires_at,
            t.completed_at, t.proposer_delivered_at, t.receiver_delivered_at
       FROM trades t JOIN users p ON p.id = t.proposer_id JOIN users r ON r.id = t.receiver_id
      ORDER BY t.id DESC LIMIT $1`,
    [limit],
  );
  if (trades.length === 0) return [];
  const { rows: lines } = await db.query<{
    trade_id: number;
    lado: 'proposer' | 'receiver';
    nombre: string;
    unidad: string;
    cantidad: number;
    valor_unit_cb: number;
    tipo: Tipo;
    valor_sin_verificar: boolean;
    returned_at: Date | null;
  }>(
    `SELECT trade_id, lado, nombre, unidad, cantidad::float8 AS cantidad, valor_unit_cb, tipo, valor_sin_verificar, returned_at
       FROM trade_lines WHERE trade_id = ANY($1::int[]) ORDER BY id`,
    [trades.map((t) => t.id)],
  );
  return trades.map((t) => {
    const own = lines.filter((l) => l.trade_id === t.id);
    const mapped = own.map((l) => ({
      lado: l.lado,
      nombre: l.nombre,
      unidad: l.unidad,
      cantidad: l.cantidad,
      valueCb: l.valor_unit_cb,
      tipo: l.tipo,
      unverified: l.valor_sin_verificar,
      returned: l.returned_at !== null,
    }));
    return {
      id: t.id,
      proposer: t.p_nick,
      receiver: t.r_nick,
      estado: t.estado,
      parentTradeId: t.parent_trade_id,
      createdAt: new Date(t.created_at).toISOString(),
      expiresAt: new Date(t.expires_at).toISOString(),
      completedAt: t.completed_at ? new Date(t.completed_at).toISOString() : null,
      proposerDelivered: t.proposer_delivered_at !== null,
      receiverDelivered: t.receiver_delivered_at !== null,
      lines: mapped,
      summary: summarize(mapped.map((l) => ({ lado: l.lado, valueCb: l.valueCb, cantidad: l.cantidad, unverified: l.unverified })), 'proposer'),
    };
  });
}
