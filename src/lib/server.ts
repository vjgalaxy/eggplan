/** Cableado del servidor: base de datos real, secretos y siembra perezosa. Solo para páginas y endpoints. */
import { config } from '../data/config.ts';
import { nicks } from '../data/nicks.ts';
import { ensureSeededOnce } from './auth/seed.ts';
import { availableAvatars } from './auth/avatar-list.ts';
import { getDb } from './db/index.ts';
import { getAppSecret, readEnv } from './security/env.ts';

export const isProduction = (): boolean => import.meta.env.PROD;

export async function db() {
  const database = getDb();
  await ensureSeededOnce(database, {
    nicks,
    avatars: availableAvatars,
    adminBootstrapPassword: readEnv('ADMIN_BOOTSTRAP_PASSWORD'),
  });
  return database;
}

export { availableAvatars, config, getAppSecret };
