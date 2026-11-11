/** Cableado del servidor: base de datos real, secretos y siembra perezosa. Solo para páginas y endpoints. */
import { config } from '../data/config.ts';
import { nicks } from '../data/nicks.ts';
import { categorias, catalogo } from '../data/catalogo.ts';
import { ensureSeededOnce } from './auth/seed.ts';
import { loadCatalogOnce } from './catalog/loader.ts';
import { availableAvatars } from './auth/avatar-list.ts';
import { getDb } from './db/index.ts';
import { getAppSecret, readEnv } from './security/env.ts';

export const isProduction = (): boolean => import.meta.env.PROD;

export async function db() {
  const database = getDb();
  await ensureSeededOnce(database, { nicks, avatars: availableAvatars });
  // Catálogo inicial: idempotente y sin pisar lo que haya editado la administración.
  await loadCatalogOnce(database, categorias, catalogo);
  return database;
}

/**
 * Clave del admin, leída de la variable de entorno en cada login (no se guarda en la base).
 * Acepta el nombre antiguo ADMIN_BOOTSTRAP_PASSWORD para no romper entornos ya configurados.
 */
export function getAdminPassword(): string | undefined {
  return readEnv('ADMIN_PASSWORD') ?? readEnv('ADMIN_BOOTSTRAP_PASSWORD');
}

export { availableAvatars, config, getAppSecret };
