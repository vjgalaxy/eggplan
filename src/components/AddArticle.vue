<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { config } from '../data/config.ts';
import { t } from '../i18n/es.ts';
import { formatB, parseB, parseQty } from '../lib/format.ts';
import { searchItems } from '../lib/domain/search.ts';
import { CONDICIONES, effectiveCb, recommendedCb, type Condicion, type Tipo } from '../lib/domain/values.ts';
import type { CatalogItemRow, CategoryRow } from '../lib/catalog/catalog.ts';
import type { StockItemView } from '../lib/stock/stock.ts';
import { api } from './api.ts';
import ArticleCard from './ArticleCard.vue';

/**
 * Añadir un artículo: primero un buscador del catálogo; si no está lo que busca, el botón
 * «No está en la lista: añadir el mío» aparece justo ahí y abre el formulario de producto propio.
 */
const props = defineProps<{
  nick: string;
  avatar: string | null;
  categories: CategoryRow[];
  items: CatalogItemRow[];
}>();
const emit = defineEmits<{ added: []; close: [] }>();

type Step = 'buscar' | 'catalogo' | 'propio';
const step = ref<Step>('buscar');
const error = ref('');
const busy = ref(false);

const categoryName = (slug: string) => props.categories.find((c) => c.slug === slug)?.nombre ?? slug;

// --- Buscador -------------------------------------------------------------------------------
const query = ref('');
const categoryFilter = ref('');
const LIMIT = 12;

const withCategory = computed(() => props.items.map((i) => ({ ...i, extra: categoryName(i.categoria) })));
const matches = computed(() => {
  const base = categoryFilter.value ? withCategory.value.filter((i) => i.categoria === categoryFilter.value) : withCategory.value;
  return searchItems(base, query.value);
});
const shown = computed(() => matches.value.slice(0, LIMIT));

// --- Formulario común -----------------------------------------------------------------------
const chosen = ref<CatalogItemRow | null>(null);
const cantidad = ref('1');
const condicion = ref<Condicion>('nuevo');
const ownValue = ref('');
const caducaEl = ref('');
const nota = ref('');

// --- Producto propio -------------------------------------------------------------------------
const nombre = ref('');
const tipo = ref<Tipo>('bien');
const categoria = ref('otros');
const unidad = ref<string>(config.stock.unidadesHabituales[0] ?? 'unidad');
const unidadOtra = ref('');
const valor = ref('');
const OTRA = '__otra__';

function choose(item: CatalogItemRow) {
  chosen.value = item;
  cantidad.value = '1';
  condicion.value = 'nuevo';
  ownValue.value = '';
  caducaEl.value = '';
  nota.value = '';
  error.value = '';
  step.value = 'catalogo';
}

function startCustom() {
  nombre.value = query.value.trim().length >= 3 ? query.value.trim() : '';
  tipo.value = 'bien';
  categoria.value = categoryFilter.value || 'otros';
  unidad.value = config.stock.unidadesHabituales[0] ?? 'unidad';
  unidadOtra.value = '';
  valor.value = '';
  cantidad.value = '1';
  condicion.value = 'bueno';
  caducaEl.value = '';
  nota.value = '';
  error.value = '';
  step.value = 'propio';
}

// Unidad típica según el tipo: horas para servicios, días para préstamos (se puede cambiar).
watch(tipo, (value) => {
  if (value === 'servicio') unidad.value = 'hora';
  else if (value === 'prestamo') unidad.value = 'día';
});

/** «Para orientarte»: 3–5 productos parecidos del catálogo con su valor de referencia. */
const hints = computed(() => {
  const base = props.items.filter((i) => i.categoria === categoria.value && i.tipo === tipo.value);
  const ranked = nombre.value.trim().length >= 3 ? searchItems(base, nombre.value) : [];
  const pool = ranked.length >= 3 ? ranked : [...ranked, ...base.filter((b) => !ranked.includes(b))];
  return pool.slice(0, 5);
});

// --- Vista previa -----------------------------------------------------------------------------
const qty = computed(() => parseQty(cantidad.value) ?? 0);
const preview = computed<StockItemView | null>(() => {
  const common = { userId: 0, nick: props.nick, avatar: props.avatar, reservado: 0, cantidad: qty.value, disponible: qty.value, caducaEl: caducaEl.value || null, nota: nota.value.trim() || null };
  if (step.value === 'catalogo' && chosen.value) {
    const item = chosen.value;
    const own = ownValue.value.trim() === '' ? null : parseB(ownValue.value);
    const cond = item.tipo === 'bien' ? condicion.value : null;
    return {
      ...common,
      id: 0,
      catalogItemId: item.id,
      catalogSlug: item.slug,
      nombre: item.nombre,
      categoria: item.categoria,
      tipo: item.tipo,
      unidad: item.unidad,
      condicion: cond,
      valueCb: effectiveCb({ refCb: item.refCb, tipo: item.tipo, condicion: cond, ownCb: own, valueStatus: 'catalogo', verifiedCb: null }),
      unverified: false,
      custom: false,
      perecedero: item.perecedero,
    };
  }
  if (step.value === 'propio') {
    return {
      ...common,
      id: 0,
      catalogItemId: null,
      catalogSlug: null,
      nombre: nombre.value.trim() || '…',
      categoria: categoria.value,
      tipo: tipo.value,
      unidad: finalUnit(),
      condicion: tipo.value === 'bien' ? condicion.value : null,
      valueCb: parseB(valor.value) ?? 0,
      unverified: true,
      custom: true,
      perecedero: false,
    };
  }
  return null;
});

const recommended = computed(() =>
  chosen.value ? recommendedCb(chosen.value.refCb, chosen.value.tipo, chosen.value.tipo === 'bien' ? condicion.value : null) : 0,
);
const hardCap = config.productosPropios.valorMaximoPropio * config.moneda.centesimas;

function finalUnit(): string {
  return unidad.value === OTRA ? unidadOtra.value.trim() : unidad.value;
}

// --- Envío -------------------------------------------------------------------------------------
async function submit() {
  error.value = '';
  const q = parseQty(cantidad.value);
  if (q === null || q <= 0) {
    error.value = t.comun.cantidadInvalida;
    return;
  }
  const common = {
    cantidad: q,
    caducaEl: caducaEl.value || null,
    nota: nota.value.trim() || null,
  };

  let body: Record<string, unknown>;
  if (step.value === 'catalogo' && chosen.value) {
    let own: number | null = null;
    let confirmado = false;
    if (ownValue.value.trim() !== '') {
      own = parseB(ownValue.value);
      if (own === null) {
        error.value = t.comun.importeInvalido;
        return;
      }
      // Pide confirmación solo si el valor es muy alto y además supera el recomendado.
      if (own > config.productosPropios.confirmarValorMayorQue * config.moneda.centesimas && own > recommended.value) {
        if (!window.confirm(t.anadir.confirmarValor(formatB(own)))) return;
        confirmado = true;
      }
    }
    body = {
      modo: 'catalogo',
      catalogItemId: chosen.value.id,
      condicion: chosen.value.tipo === 'bien' ? condicion.value : null,
      ownValueCb: own,
      confirmado,
      ...common,
    };
  } else {
    const valueCb = parseB(valor.value);
    if (valueCb === null) {
      error.value = t.comun.importeInvalido;
      return;
    }
    const name = nombre.value.trim();
    const unit = finalUnit();
    if (name.length < 3 || unit.length < 1) {
      error.value = t.comun.campoObligatorio;
      return;
    }
    let confirmado = false;
    if (valueCb > config.productosPropios.confirmarValorMayorQue * config.moneda.centesimas) {
      if (!window.confirm(t.anadir.confirmarValor(formatB(valueCb)))) return;
      confirmado = true;
    }
    body = {
      modo: 'propio',
      nombre: name,
      tipo: tipo.value,
      categoria: categoria.value,
      unidad: unit,
      condicion: tipo.value === 'bien' ? condicion.value : null,
      valueCb,
      confirmado,
      ...common,
    };
  }

  busy.value = true;
  const result = await api('/api/me/stock', { body });
  busy.value = false;
  if (!result.ok) {
    error.value = result.data.message ?? t.comun.errorGenerico;
    return;
  }
  emit('added');
}
</script>

<template>
  <section class="card" aria-labelledby="add-title">
    <div class="mb-4 flex items-start justify-between gap-3">
      <h2 id="add-title">{{ step === 'propio' ? t.anadir.tituloPropio : t.anadir.titulo }}</h2>
      <button type="button" class="btn-ghost" @click="emit('close')">{{ t.anadir.cerrar }}</button>
    </div>

    <!-- 1. Buscador del catálogo -->
    <div v-if="step === 'buscar'" class="space-y-4">
      <div>
        <label class="label" for="add-search">{{ t.anadir.buscar }}</label>
        <input id="add-search" v-model="query" class="input" type="search" autocomplete="off" :placeholder="t.anadir.buscarAyuda" />
      </div>
      <div>
        <label class="label" for="add-cat">{{ t.anadir.filtroCategoria }}</label>
        <select id="add-cat" v-model="categoryFilter" class="input">
          <option value="">{{ t.anadir.todasCategorias }}</option>
          <option v-for="c in categories" :key="c.slug" :value="c.slug">{{ c.nombre }}</option>
        </select>
      </div>

      <!-- El botón de producto propio está SIEMPRE aquí, donde la persona se queda atascada -->
      <div class="rounded-xl border-2 border-dashed border-berenjena-300 bg-berenjena-50 p-4">
        <button type="button" class="btn-secondary w-full sm:w-auto" @click="startCustom">{{ t.anadir.noEsta }}</button>
        <p class="hint mt-2">{{ t.anadir.noEstaAyuda }}</p>
      </div>

      <p v-if="shown.length === 0" class="alert-info" role="status">{{ t.anadir.sinResultados }}</p>
      <ul v-else class="space-y-2">
        <li v-for="item in shown" :key="item.id">
          <button
            type="button"
            class="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border-2 border-berenjena-100 bg-white px-4 py-2 text-left hover:border-berenjena-300"
            @click="choose(item)"
          >
            <span>
              <span class="block font-semibold">{{ item.nombre }}</span>
              <span class="hint">{{ categoryName(item.categoria) }} · {{ t.articulo.tipo[item.tipo] }}</span>
            </span>
            <span class="shrink-0 font-bold text-berenjena-700">{{ t.articulo.porUnidad(formatB(item.refCb), item.unidad) }}</span>
          </button>
        </li>
      </ul>
      <p v-if="matches.length > LIMIT" class="hint">{{ t.anadir.verMas(matches.length - LIMIT) }}</p>
    </div>

    <!-- 2a. Artículo del catálogo -->
    <form v-else-if="step === 'catalogo' && chosen" class="space-y-4" novalidate @submit.prevent="submit">
      <div>
        <p class="text-lg font-bold">{{ chosen.nombre }}</p>
        <p class="hint">{{ t.anadir.referencia(formatB(chosen.refCb), chosen.unidad) }}</p>
      </div>
      <div>
        <label class="label" for="a-cant">{{ t.miStock.cantidad }} ({{ chosen.unidad }})</label>
        <input id="a-cant" v-model="cantidad" class="input" type="text" inputmode="decimal" autocomplete="off" />
      </div>
      <div v-if="chosen.tipo === 'bien'">
        <label class="label" for="a-cond">{{ t.miStock.estadoBien }}</label>
        <select id="a-cond" v-model="condicion" class="input">
          <option v-for="c in CONDICIONES" :key="c" :value="c">{{ t.articulo.condicion[c] }} · {{ t.articulo.condicionAyuda[c] }}</option>
        </select>
      </div>
      <details class="rounded-xl border-2 border-berenjena-100 p-3">
        <summary class="cursor-pointer text-base font-semibold">{{ t.miStock.valorPropioBajar }}</summary>
        <div class="mt-3">
          <label class="label" for="a-own">{{ t.miStock.valorPropio }}</label>
          <input id="a-own" v-model="ownValue" class="input" type="text" inputmode="decimal" autocomplete="off" :placeholder="formatB(recommended)" />
          <p class="hint mt-1">{{ t.miStock.valorRecomendado(formatB(recommended)) }}</p>
        </div>
      </details>
      <div v-if="chosen.perecedero">
        <label class="label" for="a-cad">{{ t.miStock.caducidad }}</label>
        <input id="a-cad" v-model="caducaEl" class="input" type="date" />
      </div>
      <div>
        <label class="label" for="a-nota">{{ t.miStock.nota }}</label>
        <input id="a-nota" v-model="nota" class="input" type="text" :maxlength="config.stock.notaMax" autocomplete="off" />
      </div>

      <div v-if="preview">
        <p class="label">{{ t.miStock.vistaPrevia }}</p>
        <ArticleCard :item="preview" show-owner />
      </div>
      <p v-if="error" class="alert-error" role="alert">{{ error }}</p>
      <div class="flex flex-wrap gap-3">
        <button type="submit" class="btn-primary" :disabled="busy">{{ busy ? t.anadir.publicando : t.anadir.publicar }}</button>
        <button type="button" class="btn-secondary" @click="step = 'buscar'">{{ t.anadir.volverLista }}</button>
      </div>
    </form>

    <!-- 2b. Producto propio -->
    <form v-else class="space-y-4" novalidate @submit.prevent="submit">
      <div>
        <label class="label" for="p-nombre">{{ t.anadir.nombre }}</label>
        <input id="p-nombre" v-model="nombre" class="input" type="text" maxlength="60" autocomplete="off" />
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="p-tipo">{{ t.anadir.tipo }}</label>
          <select id="p-tipo" v-model="tipo" class="input">
            <option value="bien">{{ t.articulo.tipo.bien }}</option>
            <option value="servicio">{{ t.articulo.tipo.servicio }}</option>
            <option value="prestamo">{{ t.articulo.tipo.prestamo }}</option>
          </select>
        </div>
        <div>
          <label class="label" for="p-cat">{{ t.anadir.categoria }}</label>
          <select id="p-cat" v-model="categoria" class="input">
            <option v-for="c in categories" :key="c.slug" :value="c.slug">{{ c.nombre }}</option>
          </select>
          <p class="hint mt-1">{{ t.anadir.categoriaOtros }}</p>
        </div>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="p-uni">{{ t.anadir.unidad }}</label>
          <select id="p-uni" v-model="unidad" class="input">
            <option v-for="u in config.stock.unidadesHabituales" :key="u" :value="u">{{ u }}</option>
            <option :value="OTRA">{{ t.anadir.unidadOtra }}</option>
          </select>
          <input
            v-if="unidad === OTRA"
            v-model="unidadOtra"
            class="input mt-2"
            type="text"
            :maxlength="config.stock.unidadOtraMax"
            :aria-label="t.anadir.unidadOtraTexto"
            :placeholder="t.anadir.unidadOtraTexto"
          />
        </div>
        <div>
          <label class="label" for="p-cant">{{ t.anadir.cantidad }}</label>
          <input id="p-cant" v-model="cantidad" class="input" type="text" inputmode="decimal" autocomplete="off" />
        </div>
      </div>
      <div v-if="tipo === 'bien'">
        <label class="label" for="p-cond">{{ t.miStock.estadoBien }}</label>
        <select id="p-cond" v-model="condicion" class="input">
          <option v-for="c in CONDICIONES" :key="c" :value="c">{{ t.articulo.condicion[c] }} · {{ t.articulo.condicionAyuda[c] }}</option>
        </select>
        <p class="hint mt-1">{{ t.miStock.estadoBienInformativo }}</p>
      </div>

      <div>
        <label class="label" for="p-valor">{{ t.anadir.valorObligatorio }}</label>
        <input id="p-valor" v-model="valor" class="input" type="text" inputmode="decimal" autocomplete="off" />
        <div v-if="hints.length > 0" class="alert-info mt-2">
          <p class="font-semibold">{{ t.anadir.orientarte }}</p>
          <ul class="mt-1 list-disc pl-5">
            <li v-for="h in hints" :key="h.id">{{ t.anadir.orientarteItem(h.nombre, formatB(h.refCb), h.unidad) }}</li>
          </ul>
        </div>
        <p class="hint mt-1">{{ t.miStock.valorMaximo(formatB(hardCap)) }}</p>
      </div>
      <div>
        <label class="label" for="p-cad">{{ t.miStock.caducidad }}</label>
        <input id="p-cad" v-model="caducaEl" class="input" type="date" />
      </div>
      <div>
        <label class="label" for="p-nota">{{ t.miStock.nota }}</label>
        <input id="p-nota" v-model="nota" class="input" type="text" :maxlength="config.stock.notaMax" autocomplete="off" />
      </div>

      <p class="alert-info">{{ t.miStock.sinVerificarAviso }}</p>
      <div v-if="preview">
        <p class="label">{{ t.miStock.vistaPrevia }}</p>
        <ArticleCard :item="preview" show-owner :category-name="categoryName(categoria)" />
      </div>
      <p v-if="error" class="alert-error" role="alert">{{ error }}</p>
      <div class="flex flex-wrap gap-3">
        <button type="submit" class="btn-primary" :disabled="busy">{{ busy ? t.anadir.publicando : t.anadir.publicar }}</button>
        <button type="button" class="btn-secondary" @click="step = 'buscar'">{{ t.anadir.volverLista }}</button>
      </div>
    </form>
  </section>
</template>
