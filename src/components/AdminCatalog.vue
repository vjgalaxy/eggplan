<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '../i18n/es.ts';
import { formatB, formatCbInput, formatDate, parseB } from '../lib/format.ts';
import { searchItems } from '../lib/domain/search.ts';
import type { CatalogItemRow, CategoryRow, ValueHistoryRow } from '../lib/catalog/catalog.ts';
import { api } from './api.ts';
import ProductEmoji from './ProductEmoji.vue';
import { refreshCatalogData } from './catalog-store.ts';

/** Catálogo (administración): crear, editar, activar/desactivar y cambiar el valor de referencia con historial. */
const categories = ref<CategoryRow[]>([]);
const items = ref<CatalogItemRow[]>([]);
const loading = ref(true);
const error = ref('');
const notice = ref('');

const query = ref('');
const categoryFilter = ref('');
const onlyInactive = ref(false);
const LIMIT = 40;

const categoryName = (slug: string) => categories.value.find((c) => c.slug === slug)?.nombre ?? slug;

const filtered = computed(() => {
  let list = items.value.map((i) => ({ ...i, extra: categoryName(i.categoria) }));
  if (categoryFilter.value) list = list.filter((i) => i.categoria === categoryFilter.value);
  if (onlyInactive.value) list = list.filter((i) => !i.activo);
  return searchItems(list, query.value);
});
const shown = computed(() => filtered.value.slice(0, LIMIT));

// --- Formulario (crear / editar) ---------------------------------------------------------------
const mode = ref<'crear' | 'editar' | null>(null);
const editingId = ref<number | null>(null);
const form = ref({ nombre: '', categoria: 'otros', tipo: 'bien', unidad: 'unidad', valor: '', perecedero: false, activo: true, nota: '' });
const formError = ref('');
const saving = ref(false);
const history = ref<ValueHistoryRow[] | null>(null);

async function load() {
  const result = await api<{ categories: CategoryRow[]; items: CatalogItemRow[] }>('/api/admin/catalogo');
  loading.value = false;
  if (result.ok) {
    categories.value = result.data.categories;
    items.value = result.data.items;
  } else {
    error.value = result.data.message ?? t.comun.errorGenerico;
  }
}

function startCreate() {
  mode.value = 'crear';
  editingId.value = null;
  history.value = null;
  formError.value = notice.value = '';
  form.value = { nombre: '', categoria: categoryFilter.value || 'otros', tipo: 'bien', unidad: 'unidad', valor: '', perecedero: false, activo: true, nota: '' };
}

async function startEdit(item: CatalogItemRow) {
  mode.value = 'editar';
  editingId.value = item.id;
  formError.value = notice.value = '';
  form.value = {
    nombre: item.nombre,
    categoria: item.categoria,
    tipo: item.tipo,
    unidad: item.unidad,
    valor: formatCbInput(item.refCb),
    perecedero: item.perecedero,
    activo: item.activo,
    nota: item.nota ?? '',
  };
  history.value = null;
  const result = await api<{ history: ValueHistoryRow[] }>(`/api/admin/catalogo/${item.id}/historial`);
  if (result.ok) history.value = result.data.history;
}

async function save() {
  formError.value = '';
  const refCb = parseB(form.value.valor);
  if (refCb === null) {
    formError.value = t.comun.importeInvalido;
    return;
  }
  if (form.value.nombre.trim().length < 2 || form.value.unidad.trim().length < 1) {
    formError.value = t.comun.campoObligatorio;
    return;
  }
  const body = {
    nombre: form.value.nombre,
    categoria: form.value.categoria,
    tipo: form.value.tipo,
    unidad: form.value.unidad,
    refCb,
    perecedero: form.value.perecedero,
    activo: form.value.activo,
    nota: form.value.nota.trim() || null,
  };
  saving.value = true;
  const result =
    mode.value === 'crear'
      ? await api('/api/admin/catalogo', { body })
      : await api(`/api/admin/catalogo/${editingId.value}`, { body });
  saving.value = false;
  if (!result.ok) {
    formError.value = result.data.message ?? t.comun.errorGenerico;
    return;
  }
  notice.value = mode.value === 'crear' ? t.adminCatalogo.creado : t.adminCatalogo.guardado;
  mode.value = null;
  refreshCatalogData();
  await load();
}

function historyLine(row: ValueHistoryRow): string {
  const when = formatDate(row.at);
  return row.oldCb === null
    ? t.adminCatalogo.historialInicial(formatB(row.newCb), when)
    : t.adminCatalogo.historialLinea(formatB(row.oldCb), formatB(row.newCb), when);
}

onMounted(load);
</script>

<template>
  <section class="space-y-5 print:hidden">
    <div>
      <h1 class="mb-1">{{ t.adminCatalogo.titulo }}</h1>
      <p class="hint">{{ t.adminCatalogo.ayuda }}</p>
    </div>

    <p v-if="error" class="alert-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="alert-ok" role="status">{{ notice }}</p>

    <!-- Crear / editar -->
    <form v-if="mode" class="card space-y-4" novalidate @submit.prevent="save">
      <h2>{{ mode === 'crear' ? t.adminCatalogo.nuevo : t.adminCatalogo.editar }}</h2>
      <div>
        <label class="label" for="c-nombre">{{ t.adminCatalogo.nombre }}</label>
        <input id="c-nombre" v-model="form.nombre" class="input" type="text" maxlength="120" autocomplete="off" />
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="c-cat">{{ t.adminCatalogo.categoria }}</label>
          <select id="c-cat" v-model="form.categoria" class="input">
            <option v-for="c in categories" :key="c.slug" :value="c.slug">{{ c.nombre }}</option>
          </select>
        </div>
        <div>
          <label class="label" for="c-tipo">{{ t.adminCatalogo.tipo }}</label>
          <select id="c-tipo" v-model="form.tipo" class="input">
            <option value="bien">{{ t.articulo.tipo.bien }}</option>
            <option value="servicio">{{ t.articulo.tipo.servicio }}</option>
            <option value="prestamo">{{ t.articulo.tipo.prestamo }}</option>
          </select>
        </div>
        <div>
          <label class="label" for="c-uni">{{ t.adminCatalogo.unidad }}</label>
          <input id="c-uni" v-model="form.unidad" class="input" type="text" maxlength="40" autocomplete="off" />
        </div>
        <div>
          <label class="label" for="c-val">{{ t.adminCatalogo.valor }}</label>
          <input id="c-val" v-model="form.valor" class="input" type="text" inputmode="decimal" autocomplete="off" />
        </div>
      </div>
      <label class="flex min-h-12 items-center gap-3 text-base font-semibold">
        <input v-model="form.perecedero" type="checkbox" class="h-6 w-6" /> {{ t.adminCatalogo.perecedero }}
      </label>
      <label class="flex min-h-12 items-center gap-3 text-base font-semibold">
        <input v-model="form.activo" type="checkbox" class="h-6 w-6" /> {{ t.adminCatalogo.activo }}
      </label>
      <div>
        <label class="label" for="c-nota">{{ t.adminCatalogo.nota }}</label>
        <input id="c-nota" v-model="form.nota" class="input" type="text" maxlength="300" autocomplete="off" />
      </div>

      <div v-if="mode === 'editar'">
        <h3 class="mb-1 text-lg font-bold">{{ t.adminCatalogo.historial }}</h3>
        <p v-if="history && history.length === 0" class="hint">{{ t.adminCatalogo.historialVacio }}</p>
        <ul v-else-if="history" class="list-disc pl-5">
          <li v-for="(row, index) in history" :key="index">{{ historyLine(row) }}</li>
        </ul>
      </div>

      <p v-if="formError" class="alert-error" role="alert">{{ formError }}</p>
      <div class="flex flex-wrap gap-3">
        <button type="submit" class="btn-primary" :disabled="saving">{{ mode === 'crear' ? t.adminCatalogo.crear : t.adminCatalogo.guardar }}</button>
        <button type="button" class="btn-secondary" @click="mode = null">{{ t.adminCatalogo.cancelar }}</button>
      </div>
    </form>

    <template v-else>
      <div class="flex flex-wrap items-end gap-3">
        <div class="min-w-48 flex-1">
          <label class="label" for="ac-q">{{ t.adminCatalogo.buscar }}</label>
          <input id="ac-q" v-model="query" class="input" type="search" autocomplete="off" />
        </div>
        <div class="min-w-48">
          <label class="label" for="ac-cat">{{ t.adminCatalogo.categoria }}</label>
          <select id="ac-cat" v-model="categoryFilter" class="input">
            <option value="">{{ t.adminCatalogo.todas }}</option>
            <option v-for="c in categories" :key="c.slug" :value="c.slug">{{ c.nombre }}</option>
          </select>
        </div>
        <label class="flex min-h-12 items-center gap-2 text-base font-semibold">
          <input v-model="onlyInactive" type="checkbox" class="h-6 w-6" /> {{ t.adminCatalogo.soloInactivos }}
        </label>
        <button type="button" class="btn-primary" @click="startCreate">{{ t.adminCatalogo.nuevo }}</button>
      </div>

      <p v-if="loading">{{ t.comun.cargando }}</p>
      <template v-else>
        <p class="hint" role="status">{{ t.adminCatalogo.mostrando(shown.length, filtered.length) }}</p>
        <ul class="space-y-2">
          <li v-for="item in shown" :key="item.id" class="card flex flex-wrap items-center justify-between gap-3 p-4!">
            <div>
              <p class="font-bold">
                <ProductEmoji :nombre="item.nombre" :categoria="item.categoria" :tipo="item.tipo" />{{ item.nombre }}
                <span v-if="!item.activo" class="ml-1 rounded-lg bg-crema-200 px-2 text-base">{{ t.adminCatalogo.inactivo }}</span>
                <span v-if="item.refSource === 'admin'" class="ml-1 rounded-lg bg-berenjena-100 px-2 text-base text-berenjena-800">{{ t.adminCatalogo.editadoAdmin }}</span>
              </p>
              <p class="hint">{{ categoryName(item.categoria) }} · {{ t.articulo.tipo[item.tipo] }} · {{ t.articulo.porUnidad(formatB(item.refCb), item.unidad) }}</p>
            </div>
            <button type="button" class="btn-secondary" @click="startEdit(item)">{{ t.adminCatalogo.editar }}</button>
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>
