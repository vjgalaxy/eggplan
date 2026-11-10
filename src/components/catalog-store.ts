import { api } from './api.ts';
import type { CatalogItemRow, CategoryRow } from '../lib/catalog/catalog.ts';

export interface CatalogData {
  categories: CategoryRow[];
  items: CatalogItemRow[];
}

let cached: Promise<CatalogData | null> | null = null;

/** Catálogo activo (una sola descarga por pantalla). Devuelve null si falla; el siguiente intento vuelve a pedirlo. */
export function loadCatalogData(): Promise<CatalogData | null> {
  if (!cached) {
    cached = api<CatalogData>('/api/catalogo').then((result) => {
      if (result.ok) return { categories: result.data.categories, items: result.data.items };
      cached = null;
      return null;
    });
  }
  return cached;
}

export function refreshCatalogData(): void {
  cached = null;
}
