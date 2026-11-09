/**
 * Lectura de variables de entorno. En Netlify (runtime) están en `process.env`; en desarrollo
 * Vite carga `.env` en `import.meta.env`. Se consultan ambas. Nunca se registran en logs.
 */
export function readEnv(name: string): string | undefined {
  const fromProcess = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  if (fromProcess) return fromProcess;
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return meta?.[name] || undefined;
}

/** Secreto para firmar (HMAC) IP y claves de intentos. Obligatorio en producción. */
export function getAppSecret(): string {
  const secret = readEnv('APP_SECRET');
  if (secret && secret.length >= 16) return secret;
  if ((import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD) {
    throw new Error('Falta la variable de entorno APP_SECRET (mínimo 16 caracteres).');
  }
  return 'eggplan-solo-desarrollo-no-usar-en-produccion';
}
