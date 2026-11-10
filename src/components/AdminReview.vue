<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '../i18n/es.ts';
import { formatB, formatCbInput, formatDate, formatQty, parseB } from '../lib/format.ts';
import { searchItems } from '../lib/domain/search.ts';
import type { ReviewItem } from '../lib/stock/review.ts';
import { api } from './api.ts';
import AvatarImg from './AvatarImg.vue';
import { loadCatalogData, refreshCatalogData, type CatalogData } from './catalog-store.ts';

/**
 * Cola «Artículos propios por revisar» (supervisión: no bloquea nada). Acciones: verificar,
 * ajustar valor, vincular a un producto, crear en el catálogo u ocultar con motivo.
 */
const emit = defineEmits<{ count: [n: number] }>();

const items = ref<ReviewItem[]>([]);
const catalog = ref<CatalogData | null>(null);
const loading = ref(true);
const error = ref('');
const notice = ref('');
const busy = ref(false);

type Kind = 'ajustar' | 'vincular' | 'crear' | 'ocultar';
const open = ref<{ id: number; kind: Kind } | null>(null);
const valor = ref('');
const motivo = ref('');
const search = ref('');
const nombre = ref('');
const categoria = ref('otros');
const unidad = ref('');

const categoryName = (slug: string) => catalog.value?.categories.find((c) => c.slug === slug)?.nombre ?? slug;
const suggestions = computed(() => (search.value.trim().length >= 2 ? searchItems(catalog.value?.items ?? [], search.value).slice(0, 6) : []));

async function load() {
  const [queue, cat] = await Promise.all([api<{ items: ReviewItem[] }>('/api/admin/revision'), loadCatalogData()]);
  loading.value = false;
  catalog.value = cat;
  if (queue.ok) {
    items.value = queue.data.items;
    emit('count', items.value.length);
  } else {
    error.value = queue.data.message ?? t.comun.errorGenerico;
  }
}

function openPanel(item: ReviewItem, kind: Kind) {
  open.value = { id: item.id, kind };
  error.value = notice.value = '';
  valor.value = formatCbInput(item.valueCb);
  motivo.value = search.value = '';
  nombre.value = item.nombre;
  categoria.value = item.categoria;
  unidad.value = item.unidad;
}

async function send(item: ReviewItem, body: Record<string, unknown>) {
  busy.value = true;
  error.value = notice.value = '';
  const result = await api(`/api/admin/revision/${item.id}`, { body });
  busy.value = false;
  if (!result.ok) {
    error.value = result.data.message ?? t.comun.errorGenerico;
    return;
  }
  open.value = null;
  notice.value = t.revision.hecho;
  refreshCatalogData();
  await load();
}

function adjust(item: ReviewItem) {
  const cb = parseB(valor.value);
  if (cb === null) {
    error.value = t.comun.importeInvalido;
    return;
  }
  void send(item, { action: 'adjust', valueCb: cb });
}

function create(item: ReviewItem) {
  const cb = parseB(valor.value);
  if (cb === null) {
    error.value = t.comun.importeInvalido;
    return;
  }
  void send(item, { action: 'create', nombre: nombre.value, categoria: categoria.value, unidad: unidad.value, refCb: cb });
}

function hide(item: ReviewItem) {
  if (motivo.value.trim().length < 3) {
    error.value = t.comun.campoObligatorio;
    return;
  }
  if (window.confirm(t.revision.ocultarConfirmar)) void send(item, { action: 'hide', motivo: motivo.value });
}

onMounted(load);
</script>

<template>
  <section class="space-y-5 print:hidden">
    <div>
      <h1 class="mb-1">{{ t.revision.titulo }}</h1>
      <p class="hint">{{ t.revision.ayuda }}</p>
    </div>
    <p v-if="error" class="alert-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="alert-ok" role="status">{{ notice }}</p>

    <p v-if="loading">{{ t.comun.cargando }}</p>
    <div v-else-if="items.length === 0" class="card text-center">
      <h2 class="mb-2">{{ t.revision.vacioTitulo }}</h2>
      <p>{{ t.revision.vacioTexto }}</p>
    </div>

    <ul v-else class="space-y-4">
      <li v-for="item in items" :key="item.id" class="card space-y-3">
        <div>
          <h3 class="text-lg font-bold">{{ item.nombre }}</h3>
          <p class="hint">{{ categoryName(item.categoria) }} · {{ t.articulo.tipo[item.tipo] }} · {{ formatQty(item.cantidad) }} {{ item.unidad }}</p>
          <p class="mt-1 font-semibold">{{ t.revision.valorFamilia(formatB(item.valueCb), item.unidad) }}</p>
          <p v-if="item.nota" class="hint">{{ item.nota }}</p>
        </div>
        <p class="flex items-center gap-2">
          <AvatarImg :avatar="item.avatar" :nick="item.nick" size="sm" />
          <span>{{ t.revision.de(item.nick, formatDate(item.createdAt)) }}</span>
        </p>

        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-primary" :disabled="busy" @click="send(item, { action: 'verify' })">{{ t.revision.verificar }}</button>
          <button type="button" class="btn-secondary" @click="openPanel(item, 'ajustar')">{{ t.revision.ajustar }}</button>
          <button type="button" class="btn-secondary" @click="openPanel(item, 'vincular')">{{ t.revision.vincular }}</button>
          <button type="button" class="btn-secondary" @click="openPanel(item, 'crear')">{{ t.revision.crear }}</button>
          <button type="button" class="btn-ghost text-peligro-700" @click="openPanel(item, 'ocultar')">{{ t.revision.ocultar }}</button>
        </div>

        <!-- Panel de la acción elegida -->
        <div v-if="open?.id === item.id" class="rounded-xl border-2 border-berenjena-100 bg-berenjena-50 p-4">
          <form v-if="open.kind === 'ajustar'" class="space-y-3" novalidate @submit.prevent="adjust(item)">
            <label class="label" :for="`r-val-${item.id}`">{{ t.revision.nuevoValor }}</label>
            <input :id="`r-val-${item.id}`" v-model="valor" class="input" type="text" inputmode="decimal" autocomplete="off" />
            <div class="flex gap-3">
              <button type="submit" class="btn-primary" :disabled="busy">{{ t.revision.confirmar }}</button>
              <button type="button" class="btn-secondary" @click="open = null">{{ t.revision.cancelar }}</button>
            </div>
          </form>

          <div v-else-if="open.kind === 'vincular'" class="space-y-3">
            <label class="label" :for="`r-q-${item.id}`">{{ t.revision.buscarProducto }}</label>
            <input :id="`r-q-${item.id}`" v-model="search" class="input" type="search" autocomplete="off" />
            <ul class="space-y-2">
              <li v-for="s in suggestions" :key="s.id" class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3">
                <span>
                  <span class="block font-semibold">{{ s.nombre }}</span>
                  <span class="hint">{{ t.articulo.porUnidad(formatB(s.refCb), s.unidad) }}</span>
                </span>
                <button type="button" class="btn-primary" :disabled="busy" @click="send(item, { action: 'link', catalogItemId: s.id })">
                  {{ t.revision.elegirProducto }}
                </button>
              </li>
            </ul>
            <button type="button" class="btn-secondary" @click="open = null">{{ t.revision.cancelar }}</button>
          </div>

          <form v-else-if="open.kind === 'crear'" class="space-y-3" novalidate @submit.prevent="create(item)">
            <div>
              <label class="label" :for="`r-n-${item.id}`">{{ t.revision.nombreProducto }}</label>
              <input :id="`r-n-${item.id}`" v-model="nombre" class="input" type="text" maxlength="120" autocomplete="off" />
            </div>
            <div class="grid gap-3 sm:grid-cols-3">
              <div>
                <label class="label" :for="`r-c-${item.id}`">{{ t.adminCatalogo.categoria }}</label>
                <select :id="`r-c-${item.id}`" v-model="categoria" class="input">
                  <option v-for="c in catalog?.categories ?? []" :key="c.slug" :value="c.slug">{{ c.nombre }}</option>
                </select>
              </div>
              <div>
                <label class="label" :for="`r-u-${item.id}`">{{ t.adminCatalogo.unidad }}</label>
                <input :id="`r-u-${item.id}`" v-model="unidad" class="input" type="text" maxlength="40" autocomplete="off" />
              </div>
              <div>
                <label class="label" :for="`r-v-${item.id}`">{{ t.revision.valorReferencia }}</label>
                <input :id="`r-v-${item.id}`" v-model="valor" class="input" type="text" inputmode="decimal" autocomplete="off" />
              </div>
            </div>
            <div class="flex gap-3">
              <button type="submit" class="btn-primary" :disabled="busy">{{ t.revision.confirmar }}</button>
              <button type="button" class="btn-secondary" @click="open = null">{{ t.revision.cancelar }}</button>
            </div>
          </form>

          <form v-else class="space-y-3" novalidate @submit.prevent="hide(item)">
            <label class="label" :for="`r-m-${item.id}`">{{ t.revision.motivo }}</label>
            <input :id="`r-m-${item.id}`" v-model="motivo" class="input" type="text" maxlength="200" autocomplete="off" />
            <div class="flex gap-3">
              <button type="submit" class="btn-danger" :disabled="busy">{{ t.revision.ocultar }}</button>
              <button type="button" class="btn-secondary" @click="open = null">{{ t.revision.cancelar }}</button>
            </div>
          </form>
        </div>
      </li>
    </ul>
  </section>
</template>
