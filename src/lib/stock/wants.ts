/** «Se busca»: lo que las familias necesitan. Sin emparejamiento automático en el piloto. */
import type { Queryable } from '../db/index.ts';
import { config } from '../../data/config.ts';

export interface WantView {
  id: number;
  userId: number;
  nick: string;
  avatar: string | null;
  catalogItemId: number | null;
  catalogSlug: string | null;
  /** Nombre del producto del catálogo, o el texto libre. */
  nombre: string;
  cantidad: number | null;
  unidad: string | null;
  nota: string | null;
  createdAt: string;
}

interface RawWant {
  id: number;
  user_id: number;
  nick: string;
  avatar: string | null;
  catalog_item_id: number | null;
  catalog_slug: string | null;
  nombre: string;
  cantidad: number | null;
  unidad: string | null;
  nota: string | null;
  created_at: Date;
}

export async function listOpenWants(db: Queryable): Promise<WantView[]> {
  const { rows } = await db.query<RawWant>(
    `SELECT w.id, w.user_id, u.nick, u.avatar, w.catalog_item_id, c.slug AS catalog_slug,
            COALESCE(c.nombre, w.texto_libre) AS nombre, w.cantidad::float8 AS cantidad,
            COALESCE(w.unidad, c.unidad) AS unidad, w.nota, w.created_at
       FROM wants w JOIN users u ON u.id = w.user_id
       LEFT JOIN catalog_items c ON c.id = w.catalog_item_id
      WHERE w.estado = 'abierta' AND u.status <> 'bloqueado'
      ORDER BY w.created_at DESC, w.id DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    nick: r.nick,
    avatar: r.avatar,
    catalogItemId: r.catalog_item_id,
    catalogSlug: r.catalog_slug,
    nombre: r.nombre,
    cantidad: r.cantidad,
    unidad: r.unidad,
    nota: r.nota,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export type WantError = 'catalog_item_not_found' | 'limit' | 'not_found' | 'invalid';

export interface NewWant {
  catalogItemId?: number | null | undefined;
  textoLibre?: string | null | undefined;
  cantidad?: number | null | undefined;
  unidad?: string | null | undefined;
  nota?: string | null | undefined;
}

export async function createWant(
  db: Queryable,
  userId: number,
  input: NewWant,
): Promise<{ ok: true; id: number } | { ok: false; code: WantError }> {
  const catalogItemId = input.catalogItemId ?? null;
  const texto = input.textoLibre?.trim() || null;
  if (catalogItemId === null && texto === null) return { ok: false, code: 'invalid' };

  if (catalogItemId !== null) {
    const { rows } = await db.query('SELECT 1 FROM catalog_items WHERE id = $1 AND activo', [catalogItemId]);
    if (rows.length === 0) return { ok: false, code: 'catalog_item_not_found' };
  }
  const { rows: count } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM wants WHERE user_id = $1 AND estado = 'abierta'`,
    [userId],
  );
  if (Number(count[0]?.n ?? 0) >= config.busquedas.maxAbiertasPorFamilia) return { ok: false, code: 'limit' };

  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO wants (user_id, catalog_item_id, texto_libre, cantidad, unidad, nota)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, catalogItemId, catalogItemId === null ? texto : null, input.cantidad ?? null, input.unidad?.trim() || null, input.nota?.trim() || null],
  );
  return { ok: true, id: rows[0]?.id as number };
}

/** Cierra («ya lo he conseguido» o «ya no lo busco»). Solo quien la publicó. */
export async function closeWant(db: Queryable, userId: number, id: number): Promise<{ ok: true } | { ok: false; code: 'not_found' }> {
  const { rows } = await db.query(
    `UPDATE wants SET estado = 'cerrada', closed_at = now() WHERE id = $1 AND user_id = $2 AND estado = 'abierta' RETURNING id`,
    [id, userId],
  );
  return rows.length > 0 ? { ok: true } : { ok: false, code: 'not_found' };
}
