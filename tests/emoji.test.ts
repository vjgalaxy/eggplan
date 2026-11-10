import { describe, expect, it } from 'vitest';
import { catalogo } from '../src/data/catalogo.ts';
import { emojiFromName, productEmoji } from '../src/lib/domain/emoji.ts';

describe('emojis de productos', () => {
  it('todos los productos del catálogo tienen un emoji propio (no el genérico de su categoría)', () => {
    const sinEmoji = catalogo.filter((item) => emojiFromName(item.nombre) === null).map((i) => i.nombre);
    expect(sinEmoji).toEqual([]);
  });

  it('elige por la primera palabra que es el producto', () => {
    expect(productEmoji({ nombre: 'Patata de siembra' })).toBe('🥔');
    expect(productEmoji({ nombre: 'Zumo de manzana casero' })).toBe('🧃');
    expect(productEmoji({ nombre: 'Miel de castaño' })).toBe('🍯');
    expect(productEmoji({ nombre: 'Leña de castaño seca' })).toBe('🪵');
    expect(productEmoji({ nombre: 'Castañas secas (pilongas)' })).toBe('🌰');
    expect(productEmoji({ nombre: 'Vinagre de vino' })).toBe('🍶');
    expect(productEmoji({ nombre: 'Vela de cera de abeja' })).toBe('🕯️');
    expect(productEmoji({ nombre: 'Cocina por encargo (comida para 4)' })).toBe('🍲');
    expect(productEmoji({ nombre: 'Cocina o estufa de leña usada' })).toBe('🔥');
  });

  it('palabras cortas solo coinciden enteras; las largas también en plural', () => {
    expect(productEmoji({ nombre: 'Pandeireta' })).toBe('🪘'); // no 🍞 por «pan»
    expect(productEmoji({ nombre: 'Patatas nuevas' })).toBe('🥔');
    expect(productEmoji({ nombre: 'Perejil' })).toBe('🌿'); // no 🍐 por «pera»
  });

  it('ignora mayúsculas y tildes, y sirve para productos propios', () => {
    expect(productEmoji({ nombre: 'MERMELADA DE HIGOS de mi abuela' })).toBe('🫙');
    expect(productEmoji({ nombre: 'Jabón de laurel' })).toBe('🧼');
  });

  it('si el nombre no dice nada, usa la categoría y luego el tipo', () => {
    expect(productEmoji({ nombre: 'Cosa rara', categoria: 'huerta' })).toBe('🥬');
    expect(productEmoji({ nombre: 'Cosa rara', categoria: 'inexistente', tipo: 'prestamo' })).toBe('🔁');
    expect(productEmoji({ nombre: 'Cosa rara' })).toBe('📦');
  });
});
