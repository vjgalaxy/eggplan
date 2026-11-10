/**
 * Sinónimos básicos para el buscador del catálogo (datos de la comunidad, no del código).
 * Cada grupo es una lista de palabras sueltas equivalentes (castellano y gallego). Buscar una
 * cualquiera encuentra los productos que contengan cualquiera de las otras. El buscador ignora
 * mayúsculas y tildes, así que aquí se pueden escribir con ellas.
 */
export const sinonimos: readonly (readonly string[])[] = [
  ['huevo', 'huevos', 'ovo', 'ovos'],
  ['patata', 'patatas', 'pataca', 'patacas'],
  ['cebolla', 'cebollas', 'cebola', 'cebolas'],
  ['ajo', 'ajos', 'allo', 'allos'],
  ['miel', 'mel'],
  ['leche', 'leite'],
  ['queso', 'queijo', 'queixo'],
  ['maiz', 'millo'],
  ['castana', 'castanas', 'castanha'],
  ['manzana', 'manzanas', 'mazá', 'maza', 'mazas'],
  ['vino', 'viño', 'vinho'],
  ['aguardiente', 'orujo', 'augardente'],
  ['lena', 'lenha', 'leña'],
  ['gallina', 'galiña', 'galina', 'polla'],
  ['conejo', 'coello'],
  ['cerdo', 'cochino', 'porco', 'puerco'],
  ['tomate', 'tomates'],
  ['herramienta', 'herramientas', 'ferramenta', 'ferramentas'],
  ['hora', 'horas'],
];
