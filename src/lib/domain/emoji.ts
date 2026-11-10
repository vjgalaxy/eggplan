/** Emoji de un artículo a partir de su nombre, categoría y tipo. Reglas y datos en src/data/emojis.ts. */
import { emojis } from '../../data/emojis.ts';
import { fold } from './search.ts';

const PALABRAS = new Map<string, string>(emojis.palabras.map(([k, e]) => [k, e]));
const PALABRAS_LARGAS = emojis.palabras.filter(([k]) => k.length >= 4);
const CATEGORIAS: Record<string, string> = emojis.categorias;

export interface EmojiInput {
  nombre: string;
  categoria?: string | null | undefined;
  tipo?: 'bien' | 'servicio' | 'prestamo' | null | undefined;
}

/** Emoji por el nombre, o null si el nombre no coincide con nada (útil para saber qué falta en los datos). */
export function emojiFromName(nombre: string): string | null {
  const name = fold(nombre);
  for (const [frase, emoji] of emojis.frases) if (name.includes(frase)) return emoji;
  for (const word of name.split(/[^a-z0-9]+/).filter(Boolean)) {
    const exact = PALABRAS.get(word);
    if (exact) return exact;
    const prefix = PALABRAS_LARGAS.find(([k]) => word.startsWith(k));
    if (prefix) return prefix[1];
  }
  return null;
}

export function productEmoji(item: EmojiInput): string {
  return (
    emojiFromName(item.nombre) ??
    (item.categoria ? CATEGORIAS[item.categoria] : undefined) ??
    (item.tipo ? emojis.tipos[item.tipo] : undefined) ??
    emojis.tipos.bien
  );
}
