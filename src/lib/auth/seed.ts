import type { Db } from '../db/index.ts';
import { config } from '../../data/config.ts';
import { assignAvatars } from '../domain/avatars.ts';

/**
 * Crea las plazas (a partir de src/data/nicks.ts) y la cuenta de administración, de forma
 * idempotente. Las plazas no pueden vivir solo en SQL porque los nicks son datos de la comunidad
 * (no del código); por eso la "migración de datos" es esta función, que se ejecuta de forma
 * perezosa la primera vez que alguien visita el login y no hace nada si ya está todo creado.
 *
 * La cuenta `admin` existe en la base de datos (sesiones, anuncios y auditoría apuntan a ella),
 * pero NO guarda clave: el login del admin se compara con la variable de entorno ADMIN_PASSWORD.
 */
export interface SeedOptions {
  nicks: readonly string[];
  avatars: readonly string[];
}

export async function ensureSeeded(db: Db, options: SeedOptions): Promise<void> {
  const { nicks, avatars } = options;

  const { rows: countRows } = await db.query<{ members: string; admins: string }>(
    `SELECT count(*) FILTER (WHERE role = 'member')::text AS members,
            count(*) FILTER (WHERE role = 'admin')::text AS admins
       FROM users`,
  );
  const members = Number(countRows[0]?.members ?? 0);
  const admins = Number(countRows[0]?.admins ?? 0);

  if (members < nicks.length) {
    const assigned = assignAvatars(nicks, avatars);
    for (const [index, nick] of nicks.entries()) {
      // ON CONFLICT: si dos peticiones siembran a la vez, la segunda no hace nada.
      await db.query(
        `INSERT INTO users (seat, nick, role, avatar) VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
        [index + 1, nick, assigned[index] ?? null],
      );
    }
  }

  if (admins === 0) {
    await db.query(
      `INSERT INTO users (seat, nick, role, must_change_password, status)
       VALUES (NULL, $1, 'admin', false, 'activo') ON CONFLICT DO NOTHING`,
      [config.acceso.nickAdmin],
    );
  }

  // Bases creadas antes de este cambio guardaban un hash y obligaban a cambiarlo: se limpia.
  await db.query(
    `UPDATE users SET password_hash = NULL, must_change_password = false
      WHERE role = 'admin' AND (password_hash IS NOT NULL OR must_change_password)`,
  );
}

let seeded = false;

/** Versión con memo por instancia: tras la primera comprobación no vuelve a consultar. */
export async function ensureSeededOnce(db: Db, options: SeedOptions): Promise<void> {
  if (seeded) return;
  await ensureSeeded(db, options);
  seeded = true;
}
