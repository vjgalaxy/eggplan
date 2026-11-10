import type { Queryable } from './db/index.ts';

/**
 * Crea un aviso personal para una familia. Los avisos son PRIVADOS: ningún endpoint de
 * administración los lee (solo se escriben desde aquí). El buzón de avisos llega en la Fase 2.
 */
export async function notify(q: Queryable, userId: number, tipo: string, payload: Record<string, unknown> = {}): Promise<void> {
  await q.query('INSERT INTO notifications (user_id, tipo, payload) VALUES ($1, $2, $3::jsonb)', [
    userId,
    tipo,
    JSON.stringify(payload),
  ]);
}
