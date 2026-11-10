<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '../i18n/es.ts';
import { searchItems } from '../lib/domain/search.ts';
import type { FamilySummary, StockItemView } from '../lib/stock/stock.ts';
import type { WantView } from '../lib/stock/wants.ts';
import { api } from './api.ts';
import { loadCatalogData, type CatalogData } from './catalog-store.ts';
import ArticleCard from './ArticleCard.vue';
import AvatarImg from './AvatarImg.vue';
import PlazaHint from './PlazaHint.vue';
import WantsBoard from './WantsBoard.vue';

/**
 * Stocks: lo que tienen las demás familias, por familia o por producto, y el tablón «Se busca».
 * El servidor ya ha quitado los artículos pausados y borrados; aquí solo se explora.
 */
defineProps<{ myId: number }>();

type Tab = 'familia' | 'producto' | 'busca';
const tab = ref<Tab>('familia');
const loading = ref(true);
const error = ref('');

const families = ref<FamilySummary[]>([]);
const items = ref<StockItemView[]>([]);
const wants = ref<WantView[]>([]);
const catalog = ref<CatalogData | null>(null);

const selectedFamily = ref<number | null>(null);
const query = ref('');
const categoryFilter = ref('');
const tipoFilter = ref('');
const wantStart = ref('');

const categoryName = (slug: string) => catalog.value?.categories.find((c) => c.slug === slug)?.nombre ?? '';

const countByFamily = computed(() => {
  const counts = new Map<number, number>();
  for (const item of items.value) counts.set(item.userId, (counts.get(item.userId) ?? 0) + 1);
  return counts;
});

const family = computed(() => families.value.find((f) => f.id === selectedFamily.value) ?? null);
const familyItems = computed(() => items.value.filter((i) => i.userId === selectedFamily.value));

const productResults = computed(() => {
  let list = items.value.map((i) => ({ ...i, extra: categoryName(i.categoria) }));
  if (categoryFilter.value) list = list.filter((i) => i.categoria === categoryFilter.value);
  if (tipoFilter.value) list = list.filter((i) => i.tipo === tipoFilter.value);
  const found = searchItems(list, query.value);
  // Lo disponible primero; lo agotado, al final.
  return [...found].sort((a, b) => Number(a.disponible <= 0) - Number(b.disponible <= 0));
});

const relatedWants = computed(() => (query.value.trim().length >= 2 ? searchItems(wants.value, query.value) : []));

async function load() {
  const [stocks, board, cat] = await Promise.all([
    api<{ families: FamilySummary[]; items: StockItemView[] }>('/api/stocks'),
    api<{ wants: WantView[] }>('/api/busquedas'),
    loadCatalogData(),
  ]);
  loading.value = false;
  catalog.value = cat;
  if (stocks.ok) {
    families.value = stocks.data.families;
    items.value = stocks.data.items;
  } else {
    error.value = stocks.data.message ?? t.comun.errorGenerico;
  }
  if (board.ok) wants.value = board.data.wants;
}

async function reloadWants() {
  const board = await api<{ wants: WantView[] }>('/api/busquedas');
  if (board.ok) wants.value = board.data.wants;
}

/** «Proponer trueque» abre la propuesta con este artículo ya añadido. */
const proposeLink = (item: StockItemView) => `/app/trueques/nuevo?con=${item.userId}&articulo=${item.id}`;

function publishFromSearch() {
  wantStart.value = query.value.trim();
  tab.value = 'busca';
}

onMounted(load);

const tabs: { key: Tab; label: string }[] = [
  { key: 'familia', label: t.stocks.porFamilia },
  { key: 'producto', label: t.stocks.porProducto },
  { key: 'busca', label: t.stocks.seBusca },
];
</script>

<template>
  <div class="space-y-5">
    <p class="hint">{{ t.stocks.intro }}</p>

    <div class="grid grid-cols-3 gap-2" role="tablist" :aria-label="t.nav.stocks">
      <button
        v-for="item in tabs"
        :key="item.key"
        type="button"
        role="tab"
        class="min-h-12 rounded-xl border-2 px-2 text-base font-bold"
        :class="tab === item.key ? 'border-berenjena-700 bg-berenjena-700 text-white' : 'border-berenjena-200 bg-white text-berenjena-800 hover:bg-berenjena-50'"
        :aria-selected="tab === item.key"
        @click="tab = item.key; selectedFamily = null"
      >
        {{ item.label }}
      </button>
    </div>

    <p v-if="error" class="alert-error" role="alert">{{ error }}</p>
    <p v-if="loading">{{ t.comun.cargando }}</p>

    <!-- Por familia -->
    <section v-else-if="tab === 'familia'">
      <div v-if="family" class="space-y-4">
        <button type="button" class="btn-ghost" @click="selectedFamily = null">← {{ t.stocks.volver }}</button>
        <div class="flex items-center gap-4">
          <AvatarImg :avatar="family.avatar" :nick="family.nick" size="lg" />
          <div>
            <h2>{{ family.nick }}</h2>
            <p class="hint">{{ t.stocks.familiaArticulos(familyItems.length) }} · {{ t.stocks.completados(family.completados) }}</p>
            <a v-if="family.id === myId" href="/app/mi-stock" class="font-semibold text-berenjena-700 underline">{{ t.stocks.tuStock }}</a>
          </div>
        </div>
        <div v-if="familyItems.length === 0" class="card text-center">{{ t.stocks.familiaVacia }}</div>
        <ul v-else class="space-y-3">
          <li v-for="item in familyItems" :key="item.id">
            <ArticleCard :item="item" :category-name="categoryName(item.categoria)">
              <template v-if="item.userId !== myId && item.disponible > 0" #actions>
                <a :href="proposeLink(item)" class="btn-primary">{{ t.trueques.proponer }}</a>
              </template>
            </ArticleCard>
          </li>
        </ul>
      </div>

      <ul v-else class="grid gap-3 sm:grid-cols-2">
        <li v-for="f in families" :key="f.id">
          <button
            type="button"
            class="card flex min-h-20 w-full items-center gap-4 text-left hover:border-berenjena-300"
            @click="selectedFamily = f.id"
          >
            <AvatarImg :avatar="f.avatar" :nick="f.nick" size="lg" />
            <span>
              <span class="block text-lg font-bold">{{ f.nick }}<span v-if="f.id === myId" class="hint"> (tú)</span></span>
              <span class="hint">{{ t.stocks.familiaArticulos(countByFamily.get(f.id) ?? 0) }}</span>
            </span>
          </button>
        </li>
      </ul>
    </section>

    <!-- Por producto -->
    <section v-else-if="tab === 'producto'" class="space-y-4">
      <div>
        <label class="label" for="s-q">{{ t.stocks.buscar }}</label>
        <input id="s-q" v-model="query" class="input" type="search" autocomplete="off" :placeholder="t.stocks.buscarAyuda" />
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="label" for="s-cat">{{ t.anadir.filtroCategoria }}</label>
          <select id="s-cat" v-model="categoryFilter" class="input">
            <option value="">{{ t.anadir.todasCategorias }}</option>
            <option v-for="c in catalog?.categories ?? []" :key="c.slug" :value="c.slug">{{ c.nombre }}</option>
          </select>
        </div>
        <div>
          <label class="label" for="s-tipo">{{ t.anadir.tipo }}</label>
          <select id="s-tipo" v-model="tipoFilter" class="input">
            <option value="">{{ t.stocks.todosTipos }}</option>
            <option value="bien">{{ t.articulo.tipoPlural.bien }}</option>
            <option value="servicio">{{ t.articulo.tipoPlural.servicio }}</option>
            <option value="prestamo">{{ t.articulo.tipoPlural.prestamo }}</option>
          </select>
        </div>
      </div>

      <p class="hint" role="status">{{ t.stocks.resultados(productResults.length) }}</p>

      <div v-if="productResults.length === 0" class="card text-center">
        <p class="font-semibold">{{ items.length === 0 ? t.stocks.sinArticulos : t.stocks.sinResultados }}</p>
        <template v-if="items.length > 0">
          <p class="hint mt-1">{{ t.stocks.sinResultadosAyuda }}</p>
          <button type="button" class="btn-primary mt-4" @click="publishFromSearch">{{ t.stocks.publicarBusqueda }}</button>
        </template>
      </div>
      <PlazaHint v-if="productResults.length === 0 && items.length > 0" :text="t.plaza.enlaces.stocksSinResultados" />
      <ul v-else class="space-y-3">
        <li v-for="item in productResults" :key="item.id">
          <ArticleCard :item="item" show-owner :category-name="categoryName(item.categoria)">
            <template v-if="item.userId !== myId && item.disponible > 0" #actions>
              <a :href="proposeLink(item)" class="btn-primary">{{ t.trueques.proponer }}</a>
            </template>
          </ArticleCard>
        </li>
      </ul>

      <div v-if="relatedWants.length > 0" class="alert-info">
        <p class="font-semibold">{{ t.stocks.busquedasRelacionadas }}</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="w in relatedWants" :key="w.id">{{ w.nombre }} — {{ w.nick }}</li>
        </ul>
      </div>
    </section>

    <!-- Se busca -->
    <section v-else>
      <WantsBoard
        :key="wantStart"
        :wants="wants"
        :catalog-items="catalog?.items ?? []"
        :my-id="myId"
        :start-text="wantStart"
        @changed="reloadWants"
      />
    </section>
  </div>
</template>
