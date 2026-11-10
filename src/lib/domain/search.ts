/**
 * Búsqueda en el catálogo: sin distinguir mayúsculas ni tildes, con sinónimos básicos.
 * Lógica pura (sin servidor): la usan el servidor y las islas de Vue sobre la lista ya cargada.
 */
import { sinonimos } from '../../data/sinonimos.ts';

/** Minúsculas y sin tildes ni diéresis («Cigarrón» → «cigarron»; «ñ» → «n»). */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

const GROUPS: readonly (readonly string[])[] = sinonimos.map((group) => group.map(fold));

/** Palabra → todas las equivalentes (incluida ella misma). */
function expand(word: string): string[] {
  const found = new Set<string>([word]);
  for (const group of GROUPS) if (group.includes(word)) group.forEach((w) => found.add(w));
  return [...found];
}

export interface Searchable {
  nombre: string;
  /** Texto adicional en el que también se busca (p. ej. el nombre de la categoría). */
  extra?: string;
}

/**
 * Devuelve los elementos que contienen TODAS las palabras de la consulta (o algún sinónimo de
 * cada una), ordenados: primero los que empiezan por la consulta, luego los demás por nombre.
 */
export function searchItems<T extends Searchable>(items: readonly T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  const variants = words.map(expand);
  const folded = fold(query);

  const scored: { item: T; haystack: string; score: number }[] = [];
  for (const item of items) {
    const name = fold(item.nombre);
    const haystack = `${name} ${fold(item.extra ?? '')}`;
    if (!variants.every((options) => options.some((option) => haystack.includes(option)))) continue;
    const score = name.startsWith(folded) ? 0 : name.split(/\s+/).some((w) => w.startsWith(words[0] ?? '')) ? 1 : 2;
    scored.push({ item, haystack, score });
  }
  scored.sort((a, b) => a.score - b.score || a.item.nombre.localeCompare(b.item.nombre, 'es'));
  return scored.map((s) => s.item);
}

/** Nombre → slug (minúsculas, sin tildes, guiones). */
export function slugify(text: string): string {
  return fold(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
