<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { config } from '../data/config.ts';
import { t } from '../i18n/es.ts';
import { formatB, formatCbInput, formatQty, parseB, parseQty } from '../lib/format.ts';
import { CONDICIONES, type Condicion } from '../lib/domain/values.ts';
import type { StockItemView } from '../lib/stock/stock.ts';
import { api } from './api.ts';
import { loadCatalogData, type CatalogData } from './catalog-store.ts';
import AddArticle from './AddArticle.vue';
import ArticleCard from './ArticleCard.vue';

/** Mi stock: gestión de mis artículos (añadir, editar cantidad/estado/valor, pausar, borrar con deshacer). */
const props = defineProps<{ nick: string; avatar: string | null }>();

const items = ref<StockItemView[]>([]);
const catalog = ref<CatalogData | null>(null);
const loading = ref(true);
const error = ref('');
const notice = ref('');
const adding = ref(false);

const categoryName = (slug: string) => catalog.value?.categories.find((c) => c.slug === slug)?.nombre ?? '';

const activeCount = computed(() => items.value.filter((i) => i.estado === 'activo').length);
const pausedCount = computed(() => items.value.filter((i) => i.estado === 'pausado').length);

async function load() {
  const [stock, cat] = await Promise.all([api<{ items: StockItemView[] }>('/api/me/stock'), loadCatalogData()]);
  loading.value = false;
  catalog.value = cat;
  if (stock.ok) items.value = stock.data.items;
  else error.value = stock.data.message ?? t.comun.errorGenerico;
}

// --- Edición ---------------------------------------------------------------------------------
const editing = ref<StockItemView | null>(null);
const form = ref({ cantidad: '', condicion: 'nuevo' as Condicion, valor: '', caducaEl: '', nota: '' });
const formError = ref('');
const saving = ref(false);

function startEdit(item: StockItemView) {
  editing.value = item;
  formError.value = '';
  form.value = {
    cantidad: formatQty(item.cantidad),
    condicion: item.condicion ?? 'nuevo',
    valor: item.ownValueCb === null || item.ownValueCb === undefined ? '' : formatCbInput(item.ownValueCb),
    caducaEl: item.caducaEl ?? '',
    nota: item.nota ?? '',
  };
}

async function saveEdit() {
  const item = editing.value;
  if (!item) return;
  formError.value = '';
  const cantidad = parseQty(form.value.cantidad);
  if (cantidad === null) {
    formError.value = t.comun.cantidadInvalida;
    return;
  }
  let ownValueCb: number | null = null;
  if (form.value.valor.trim() !== '') {
    ownValueCb = parseB(form.value.valor);
    if (ownValueCb === null) {
      formError.value = t.comun.importeInvalido;
      return;
    }
  } else if (item.custom) {
    formError.value = t.comun.campoObligatorio;
    return;
  }
  let confirmado = false;
  if (item.custom && ownValueCb !== null && ownValueCb > config.productosPropios.confirmarValorMayorQue * config.moneda.centesimas) {
    if (!window.confirm(t.anadir.confirmarValor(formatB(ownValueCb)))) return;
    confirmado = true;
  }
  saving.value = true;
  const result = await api(`/api/me/stock/${item.id}`, {
    body: {
      action: 'update',
      cantidad,
      ...(item.tipo === 'bien' ? { condicion: form.value.condicion } : {}),
      ownValueCb,
      confirmado,
      caducaEl: form.value.caducaEl || null,
      nota: form.value.nota.trim() || null,
    },
  });
  saving.value = false;
  if (!result.ok) {
    formError.value = result.data.message ?? t.comun.errorGenerico;
    return;
  }
  editing.value = null;
  notice.value = t.miStock.guardado;
  await load();
}

// --- Pausar, reanudar, borrar con deshacer ---------------------------------------------------
const undo = ref<{ id: number; nombre: string } | null>(null);
let undoTimer: ReturnType<typeof setTimeout> | undefined;

async function act(item: StockItemView, action: 'pause' | 'resume' | 'delete') {
  error.value = notice.value = '';
  const result = await api(`/api/me/stock/${item.id}`, { body: { action } });
  if (!result.ok) {
    error.value = result.data.message ?? t.comun.errorGenerico;
    return;
  }
  if (action === 'delete') {
    undo.value = { id: item.id, nombre: item.nombre };
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => (undo.value = null), config.stock.deshacerSegundos * 1000);
  }
  await load();
}

async function undoDelete() {
  const pending = undo.value;
  if (!pending) return;
  clearTimeout(undoTimer);
  undo.value = null;
  const result = await api(`/api/me/stock/${pending.id}`, { body: { action: 'undo' } });
  if (!result.ok) error.value = result.data.message ?? t.comun.errorGenerico;
  await load();
}

async function onAdded() {
  adding.value = false;
  notice.value = t.miStock.anadido;
  await load();
}

onMounted(load);
onBeforeUnmount(() => clearTimeout(undoTimer));
</script>

<template>
  <div class="space-y-5">
    <p class="hint">{{ t.miStock.intro }}</p>

    <p v-if="error" class="alert-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="alert-ok" role="status">{{ notice }}</p>

    <!-- Deshacer un borrado durante unos segundos -->
    <div v-if="undo" class="alert-info flex flex-wrap items-center justify-between gap-3" role="status">
      <span>{{ t.miStock.borrado(undo.nombre) }}</span>
      <button type="button" class="btn-secondary" @click="undoDelete">{{ t.miStock.deshacer }}</button>
    </div>

    <AddArticle
      v-if="adding && catalog"
      :nick="props.nick"
      :avatar="props.avatar"
      :categories="catalog.categories"
      :items="catalog.items"
      @added="onAdded"
      @close="adding = false"
    />

    <template v-else>
      <p v-if="loading">{{ t.comun.cargando }}</p>

      <!-- Estado vacío: explicación y botón claro -->
      <div v-else-if="items.length === 0" class="card text-center">
        <h2 class="mb-2">{{ t.miStock.vacioTitulo }}</h2>
        <p class="mb-4">{{ t.miStock.vacioTexto }}</p>
        <button type="button" class="btn-primary" :disabled="!catalog" @click="adding = true">{{ t.miStock.primero }}</button>
      </div>

      <template v-else>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="hint">{{ t.miStock.activos(activeCount) }}<span v-if="pausedCount > 0"> · {{ t.miStock.pausados(pausedCount) }}</span></p>
          <button type="button" class="btn-primary" :disabled="!catalog" @click="adding = true">{{ t.miStock.anadir }}</button>
        </div>

        <ul class="space-y-4">
          <li v-for="item in items" :key="item.id">
            <form v-if="editing?.id === item.id" class="card space-y-4" novalidate @submit.prevent="saveEdit">
              <h3 class="text-lg font-bold">{{ item.nombre }}</h3>
              <div>
                <label class="label" :for="`e-cant-${item.id}`">{{ t.miStock.cantidad }} ({{ item.unidad }})</label>
                <input :id="`e-cant-${item.id}`" v-model="form.cantidad" class="input" type="text" inputmode="decimal" autocomplete="off" />
                <p v-if="item.reservado > 0" class="hint mt-1">{{ t.articulo.reservadas(formatQty(item.reservado)) }}</p>
              </div>
              <div v-if="item.tipo === 'bien'">
                <label class="label" :for="`e-cond-${item.id}`">{{ t.miStock.estadoBien }}</label>
                <select :id="`e-cond-${item.id}`" v-model="form.condicion" class="input">
                  <option v-for="c in CONDICIONES" :key="c" :value="c">{{ t.articulo.condicion[c] }} · {{ t.articulo.condicionAyuda[c] }}</option>
                </select>
                <p v-if="item.custom" class="hint mt-1">{{ t.miStock.estadoBienInformativo }}</p>
              </div>
              <div>
                <label class="label" :for="`e-val-${item.id}`">{{ t.miStock.valorPropio }}</label>
                <input
                  :id="`e-val-${item.id}`"
                  v-model="form.valor"
                  class="input"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  :placeholder="item.custom ? '' : formatB(item.maxCb ?? 0)"
                />
                <p v-if="!item.custom" class="hint mt-1">
                  {{ t.miStock.valorRecomendado(formatB(item.maxCb ?? 0)) }} {{ t.miStock.valorQuitar }}
                </p>
                <p v-else-if="item.unverified" class="hint mt-1">{{ t.miStock.sinVerificarAviso }}</p>
                <p v-else class="hint mt-1">{{ t.miStock.verificadoAviso }} ({{ t.miStock.valorMaximo(formatB(item.maxCb ?? 0)) }})</p>
              </div>
              <div v-if="item.perecedero || item.custom">
                <label class="label" :for="`e-cad-${item.id}`">{{ t.miStock.caducidad }}</label>
                <input :id="`e-cad-${item.id}`" v-model="form.caducaEl" class="input" type="date" />
              </div>
              <div>
                <label class="label" :for="`e-nota-${item.id}`">{{ t.miStock.nota }}</label>
                <input :id="`e-nota-${item.id}`" v-model="form.nota" class="input" type="text" :maxlength="config.stock.notaMax" autocomplete="off" />
              </div>
              <p v-if="formError" class="alert-error" role="alert">{{ formError }}</p>
              <div class="flex flex-wrap gap-3">
                <button type="submit" class="btn-primary" :disabled="saving">{{ t.miStock.guardar }}</button>
                <button type="button" class="btn-secondary" @click="editing = null">{{ t.miStock.cancelar }}</button>
              </div>
            </form>

            <ArticleCard v-else :item="item" :category-name="categoryName(item.categoria)">
              <template #actions>
                <p v-if="item.estado === 'pausado'" class="w-full rounded-lg bg-crema-100 px-3 py-2 text-base font-semibold">
                  {{ item.hiddenReason ? t.miStock.ocultoAdmin(item.hiddenReason) : t.miStock.pausado }}
                </p>
                <button type="button" class="btn-secondary" @click="startEdit(item)">{{ t.miStock.editar }}</button>
                <button v-if="item.estado === 'activo'" type="button" class="btn-secondary" @click="act(item, 'pause')">{{ t.miStock.pausar }}</button>
                <button v-else-if="!item.hiddenReason" type="button" class="btn-secondary" @click="act(item, 'resume')">{{ t.miStock.reanudar }}</button>
                <button type="button" class="btn-ghost text-peligro-700" @click="act(item, 'delete')">{{ t.miStock.borrar }}</button>
              </template>
            </ArticleCard>
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>
