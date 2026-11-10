<script setup lang="ts">
import { computed, ref } from 'vue';
import { config } from '../data/config.ts';
import { t } from '../i18n/es.ts';
import { formatDate, formatQty, parseQty } from '../lib/format.ts';
import { searchItems } from '../lib/domain/search.ts';
import type { CatalogItemRow } from '../lib/catalog/catalog.ts';
import type { WantView } from '../lib/stock/wants.ts';
import { api } from './api.ts';
import AvatarImg from './AvatarImg.vue';

/** «Se busca»: tablón de lo que las familias necesitan, con formulario para publicar. */
const props = defineProps<{ wants: WantView[]; catalogItems: CatalogItemRow[]; myId: number; startText?: string }>();
const emit = defineEmits<{ changed: [] }>();

const open = ref(Boolean(props.startText));
const mode = ref<'lista' | 'libre'>('lista');
const query = ref(props.startText ?? '');
const chosen = ref<CatalogItemRow | null>(null);
const texto = ref(props.startText ?? '');
const cantidad = ref('');
const nota = ref('');
const error = ref('');
const notice = ref('');
const busy = ref(false);

const suggestions = computed(() => (query.value.trim().length >= 2 ? searchItems(props.catalogItems, query.value).slice(0, 6) : []));

function choose(item: CatalogItemRow) {
  chosen.value = item;
  query.value = item.nombre;
}

async function publish() {
  error.value = notice.value = '';
  let qty: number | null = null;
  if (cantidad.value.trim() !== '') {
    qty = parseQty(cantidad.value);
    if (qty === null || qty <= 0) {
      error.value = t.comun.cantidadInvalida;
      return;
    }
  }
  const body =
    mode.value === 'lista'
      ? chosen.value
        ? { catalogItemId: chosen.value.id, cantidad: qty, unidad: chosen.value.unidad, nota: nota.value.trim() || null }
        : null
      : texto.value.trim().length >= config.busquedas.textoMin
        ? { textoLibre: texto.value.trim(), cantidad: qty, nota: nota.value.trim() || null }
        : null;
  if (!body) {
    error.value = t.erroresStock.busquedaInvalida;
    return;
  }
  busy.value = true;
  const result = await api('/api/me/wants', { body });
  busy.value = false;
  if (!result.ok) {
    error.value = result.data.message ?? t.comun.errorGenerico;
    return;
  }
  open.value = false;
  chosen.value = null;
  query.value = texto.value = cantidad.value = nota.value = '';
  notice.value = t.busquedas.publicada;
  emit('changed');
}

async function close(want: WantView) {
  if (!window.confirm(t.busquedas.cerrarConfirmar)) return;
  error.value = notice.value = '';
  const result = await api(`/api/me/wants/${want.id}`, { body: { action: 'close' } });
  if (!result.ok) {
    error.value = result.data.message ?? t.comun.errorGenerico;
    return;
  }
  notice.value = t.busquedas.cerrada;
  emit('changed');
}
</script>

<template>
  <div class="space-y-5">
    <p class="hint">{{ t.busquedas.intro }}</p>
    <p v-if="notice" class="alert-ok" role="status">{{ notice }}</p>
    <p v-if="error && !open" class="alert-error" role="alert">{{ error }}</p>

    <div v-if="!open">
      <button type="button" class="btn-primary" @click="open = true">{{ t.busquedas.publicar }}</button>
    </div>

    <form v-else class="card space-y-4" novalidate @submit.prevent="publish">
      <h2>{{ t.busquedas.publicar }}</h2>
      <p class="hint">{{ t.busquedas.queAyuda }}</p>
      <div class="flex flex-wrap gap-2" role="group" :aria-label="t.busquedas.que">
        <button type="button" :class="mode === 'lista' ? 'btn-primary' : 'btn-secondary'" :aria-pressed="mode === 'lista'" @click="mode = 'lista'">
          {{ t.busquedas.elegirDeLista }}
        </button>
        <button type="button" :class="mode === 'libre' ? 'btn-primary' : 'btn-secondary'" :aria-pressed="mode === 'libre'" @click="mode = 'libre'">
          {{ t.busquedas.escribirLibre }}
        </button>
      </div>

      <div v-if="mode === 'lista'">
        <label class="label" for="w-q">{{ t.busquedas.que }}</label>
        <input id="w-q" v-model="query" class="input" type="search" autocomplete="off" @input="chosen = null" />
        <ul v-if="!chosen && suggestions.length > 0" class="mt-2 space-y-2">
          <li v-for="s in suggestions" :key="s.id">
            <button type="button" class="flex min-h-12 w-full items-center rounded-xl border-2 border-berenjena-100 bg-white px-4 text-left font-semibold hover:border-berenjena-300" @click="choose(s)">
              {{ s.nombre }}
            </button>
          </li>
        </ul>
        <p v-if="chosen" class="alert-ok mt-2">{{ chosen.nombre }} ({{ chosen.unidad }})</p>
      </div>
      <div v-else>
        <label class="label" for="w-t">{{ t.busquedas.texto }}</label>
        <input id="w-t" v-model="texto" class="input" type="text" :maxlength="config.busquedas.textoMax" autocomplete="off" />
      </div>

      <div>
        <label class="label" for="w-c">{{ t.busquedas.cantidad }}</label>
        <input id="w-c" v-model="cantidad" class="input" type="text" inputmode="decimal" autocomplete="off" />
      </div>
      <div>
        <label class="label" for="w-n">{{ t.busquedas.nota }}</label>
        <input id="w-n" v-model="nota" class="input" type="text" :maxlength="config.stock.notaMax" autocomplete="off" />
      </div>
      <p v-if="error" class="alert-error" role="alert">{{ error }}</p>
      <div class="flex flex-wrap gap-3">
        <button type="submit" class="btn-primary" :disabled="busy">{{ t.busquedas.publicarBoton }}</button>
        <button type="button" class="btn-secondary" @click="open = false">{{ t.comun.cancelar }}</button>
      </div>
    </form>

    <div v-if="wants.length === 0" class="card text-center">
      <h2 class="mb-2">{{ t.busquedas.vacioTitulo }}</h2>
      <p>{{ t.busquedas.vacioTexto }}</p>
    </div>
    <ul v-else class="space-y-3">
      <li v-for="w in wants" :key="w.id" class="card">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 class="text-lg font-bold">{{ w.nombre }}</h3>
            <p v-if="w.cantidad" class="font-semibold">{{ formatQty(w.cantidad) }} <span v-if="w.unidad">{{ w.unidad }}</span></p>
            <p v-if="w.nota" class="hint">{{ w.nota }}</p>
          </div>
          <p class="hint">{{ t.busquedas.hace(formatDate(w.createdAt)) }}</p>
        </div>
        <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p class="flex items-center gap-2">
            <AvatarImg :avatar="w.avatar" :nick="w.nick" size="sm" />
            <span class="font-semibold">{{ w.nick }}</span>
            <span v-if="w.userId === myId" class="rounded-lg bg-berenjena-100 px-2 text-base font-semibold text-berenjena-800">{{ t.busquedas.tuya }}</span>
          </p>
          <button v-if="w.userId === myId" type="button" class="btn-secondary" @click="close(w)">{{ t.busquedas.cerrar }}</button>
        </div>
      </li>
    </ul>
  </div>
</template>
