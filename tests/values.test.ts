import { describe, expect, it } from 'vitest';
import {
  checkCatalogOwnValue,
  checkCustomValue,
  effectiveCb,
  maxAllowedCb,
  recommendedCb,
} from '../src/lib/domain/values.ts';
import { formatB, formatQty, parseB, parseQty } from '../src/lib/format.ts';
import { fold, searchItems, slugify } from '../src/lib/domain/search.ts';

describe('valor recomendado y efectivo', () => {
  it('referencia × factor de estado (solo bienes)', () => {
    expect(recommendedCb(400, 'bien', 'nuevo')).toBe(400);
    expect(recommendedCb(400, 'bien', 'bueno')).toBe(300);
    expect(recommendedCb(400, 'bien', 'usado')).toBe(200);
    expect(recommendedCb(400, 'bien', 'para_reparar')).toBe(100);
    expect(recommendedCb(350, 'bien', 'bueno')).toBe(263); // 262,5 → redondeo a entero
    expect(recommendedCb(400, 'servicio', null)).toBe(400);
    expect(recommendedCb(400, 'prestamo', null)).toBe(400);
  });

  it('sin valor propio rige el recomendado; con valor propio, el mínimo de los dos', () => {
    const base = { refCb: 400, tipo: 'bien', condicion: 'usado', valueStatus: 'catalogo', verifiedCb: null } as const;
    expect(effectiveCb({ ...base, ownCb: null })).toBe(200);
    expect(effectiveCb({ ...base, ownCb: 150 })).toBe(150);
    expect(effectiveCb({ ...base, ownCb: 900 })).toBe(200);
  });

  it('producto propio: su valor mientras no está verificado; luego el mínimo con el verificado', () => {
    const base = { refCb: null, tipo: 'bien', condicion: null } as const;
    expect(effectiveCb({ ...base, ownCb: 700, valueStatus: 'sin_verificar', verifiedCb: null })).toBe(700);
    expect(effectiveCb({ ...base, ownCb: 700, valueStatus: 'verificado', verifiedCb: 500 })).toBe(500);
    expect(effectiveCb({ ...base, ownCb: 300, valueStatus: 'verificado', verifiedCb: 500 })).toBe(300);
  });

  it('no se puede fijar un valor propio por encima de referencia × factor', () => {
    expect(checkCatalogOwnValue(200, 400, 'bien', 'usado')).toEqual({ ok: true });
    expect(checkCatalogOwnValue(201, 400, 'bien', 'usado')).toEqual({ ok: false, code: 'value_too_high', maxCb: 200 });
    expect(checkCatalogOwnValue(-1, 400, 'bien', 'usado')).toMatchObject({ ok: false, code: 'invalid' });
    expect(checkCatalogOwnValue(1.5, 400, 'bien', 'usado')).toMatchObject({ ok: false, code: 'invalid' });
    expect(checkCatalogOwnValue(0, 400, 'prestamo', null)).toEqual({ ok: true }); // un préstamo puede valer 0
  });

  it('producto propio: tope duro, confirmación por encima del umbral y tope del valor verificado', () => {
    const libre = { valueStatus: 'sin_verificar', verifiedCb: null } as const;
    expect(checkCustomValue(500, { ...libre, confirmed: false })).toEqual({ ok: true });
    expect(checkCustomValue(100_001, { ...libre, confirmed: true })).toMatchObject({ ok: false, code: 'value_above_hard_cap' });
    expect(checkCustomValue(100_000, { ...libre, confirmed: true })).toEqual({ ok: true }); // 1000 B, el tope duro
    expect(checkCustomValue(10_100, { ...libre, confirmed: false })).toMatchObject({ ok: false, code: 'needs_confirmation' });
    expect(checkCustomValue(10_000, { ...libre, confirmed: false })).toEqual({ ok: true });
    const verificado = { valueStatus: 'verificado', verifiedCb: 500, confirmed: false } as const;
    expect(checkCustomValue(500, verificado)).toEqual({ ok: true });
    expect(checkCustomValue(501, verificado)).toEqual({ ok: false, code: 'value_above_verified', maxCb: 500 });
  });

  it('maxAllowedCb refleja la regla de cada tipo de artículo', () => {
    expect(maxAllowedCb({ refCb: 400, tipo: 'bien', condicion: 'bueno', valueStatus: 'catalogo', verifiedCb: null })).toBe(300);
    expect(maxAllowedCb({ refCb: null, tipo: 'bien', condicion: null, valueStatus: 'sin_verificar', verifiedCb: null })).toBe(100_000);
    expect(maxAllowedCb({ refCb: null, tipo: 'bien', condicion: null, valueStatus: 'verificado', verifiedCb: 800 })).toBe(800);
  });
});

describe('formato de importes y cantidades', () => {
  it('muestra hasta dos decimales sin ceros sobrantes', () => {
    expect(formatB(25)).toBe('0,25 B');
    expect(formatB(400)).toBe('4 B');
    expect(formatB(425)).toBe('4,25 B');
    expect(formatB(450)).toBe('4,5 B');
    expect(formatB(0)).toBe('0 B');
  });

  it('lee importes con coma o punto y rechaza lo que no es válido', () => {
    expect(parseB('4')).toBe(400);
    expect(parseB('4,5')).toBe(450);
    expect(parseB('0.25')).toBe(25);
    expect(parseB(' 12,05 ')).toBe(1205);
    expect(parseB('4,255')).toBeNull();
    expect(parseB('abc')).toBeNull();
    expect(parseB('-3')).toBeNull();
    expect(parseB('')).toBeNull();
  });

  it('cantidades', () => {
    expect(formatQty(2.5)).toBe('2,5');
    expect(formatQty(12)).toBe('12');
    expect(parseQty('2,5')).toBe(2.5);
    expect(parseQty('3')).toBe(3);
    expect(parseQty('2,555')).toBeNull();
  });
});

describe('búsqueda en el catálogo', () => {
  const items = [
    { nombre: 'Huevos camperos' },
    { nombre: 'Patata de siembra' },
    { nombre: 'Cigarrón (disfraz)' },
    { nombre: 'Miel de castaño' },
    { nombre: 'Castañas', extra: 'Frutas y frutos secos' },
  ];

  it('ignora mayúsculas y tildes', () => {
    expect(fold('CigarRÓN Piñeiro')).toBe('cigarron pineiro');
    expect(searchItems(items, 'cigarron').map((i) => i.nombre)).toEqual(['Cigarrón (disfraz)']);
    expect(searchItems(items, 'CASTANO').map((i) => i.nombre)).toEqual(['Miel de castaño']);
  });

  it('usa sinónimos básicos (castellano y gallego)', () => {
    expect(searchItems(items, 'ovos').map((i) => i.nombre)).toEqual(['Huevos camperos']);
    expect(searchItems(items, 'pataca').map((i) => i.nombre)).toEqual(['Patata de siembra']);
    expect(searchItems(items, 'mel').map((i) => i.nombre)).toEqual(['Miel de castaño']);
  });

  it('exige todas las palabras y busca también en el texto extra', () => {
    expect(searchItems(items, 'miel castaño')).toHaveLength(1);
    expect(searchItems(items, 'miel patata')).toHaveLength(0);
    expect(searchItems(items, 'frutos')).toHaveLength(1);
    expect(searchItems(items, '')).toHaveLength(items.length);
  });

  it('slugify', () => {
    expect(slugify('Pieza de forja (grande)')).toBe('pieza-de-forja-grande');
    expect(slugify('Cigarrón')).toBe('cigarron');
  });
});
