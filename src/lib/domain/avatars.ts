import { fold } from './password-policy.ts';

const stem = (file: string): string => fold(file.replace(/\.[^.]+$/, ''));

/**
 * Asignación inicial de avatares: si existe un archivo con el nombre del nick (`peliqueiro.svg`)
 * se usa; si no, se reparte por orden entre los disponibles evitando repetir mientras sea posible.
 * Si hay menos avatares que plazas, se permite repetir (se reinicia el reparto).
 * Devuelve un avatar por nick, en el mismo orden; `null` si no hay ningún avatar.
 */
export function assignAvatars(nicks: readonly string[], available: readonly string[]): (string | null)[] {
  if (available.length === 0) return nicks.map(() => null);

  const byName = new Map(available.map((file) => [stem(file), file]));
  const result: (string | null)[] = nicks.map((nick) => byName.get(fold(nick)) ?? null);
  const used = new Set(result.filter((a): a is string => a !== null));

  let pool = available.filter((file) => !used.has(file));
  for (let i = 0; i < result.length; i++) {
    if (result[i] !== null) continue;
    if (pool.length === 0) pool = [...available]; // más plazas que avatares: se repite
    result[i] = pool.shift() ?? null;
  }
  return result;
}

/** El servidor solo acepta identificadores que existen en la lista (nunca rutas libres). */
export function isValidAvatar(id: unknown, available: readonly string[]): id is string {
  return typeof id === 'string' && available.includes(id);
}

export function avatarUrl(id: string | null | undefined): string | null {
  return id ? `/avatars/${encodeURIComponent(id)}` : null;
}
