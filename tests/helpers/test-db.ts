import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Db } from '../../src/lib/db/index.ts';

const MIGRATIONS_DIR = join(process.cwd(), 'netlify', 'database', 'migrations');

/** Postgres real (PGlite, en memoria) con todas las migraciones aplicadas, tras la interfaz `Db`. */
export async function makeTestDb(): Promise<Db> {
  const pg = new PGlite();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));

  return {
    query: (text, params) => pg.query(text, params ? [...params] : undefined) as never,
    tx: (fn) =>
      pg.transaction((tx) => fn({ query: (text, params) => tx.query(text, params ? [...params] : undefined) as never })),
  };
}
