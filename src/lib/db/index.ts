/**
 * Acceso a la base de datos (Netlify Database, Postgres).
 *
 * Toda la lógica recibe un `Db` (interfaz mínima) en vez de importar el cliente: así los tests
 * la ejecutan contra PGlite (Postgres real en memoria) y producción usa el pool de
 * `@netlify/database`. Las transacciones usan una única conexión del pool (BEGIN…COMMIT).
 */
import { getDatabase } from '@netlify/database';

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  /** Ejecuta `fn` dentro de una transacción; hace ROLLBACK si lanza. */
  tx<R>(fn: (q: Queryable) => Promise<R>): Promise<R>;
}

/** Lo mínimo que usamos del pool de `pg` (evita acoplar los tipos a la versión de @types/pg). */
interface PoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  connect(): Promise<{
    query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
    release(): void;
  }>;
}

let cached: Db | undefined;

/** Db de producción / `netlify dev`, respaldada por el pool de @netlify/database. */
export function getDb(): Db {
  if (cached) return cached;
  const pool = getDatabase().pool as unknown as PoolLike;
  cached = {
    query: (text, params) => pool.query(text, params ? [...params] : undefined) as never,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: (text, params) => client.query(text, params ? [...params] : undefined) as never,
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Si falla el ROLLBACK, la conexión se descarta al liberarla.
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
  return cached;
}
