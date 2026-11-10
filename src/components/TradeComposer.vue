<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { config } from '../data/config.ts';
import { t } from '../i18n/es.ts';
import { formatB, formatQty, parseQty } from '../lib/format.ts';
import { summarize, type SummaryLine } from '../lib/domain/trades.ts';
import type { FamilySummary, StockItemView } from '../lib/stock/stock.ts';
import type { TradeDetail } from '../lib/trades/trades.ts';
import { api, go } from './api.ts';
import AvatarImg from './AvatarImg.vue';
import TradeSummaryBar from './TradeSummaryBar.vue';

/**
 * Componer una propuesta en pasos: familia → lo que recibes → lo que das → revisar y enviar.
 * El resumen «Tú das · Recibes · Diferencia» está siempre visible y se actualiza en vivo.
 * También sirve para contraofertar (`counterOf`): parte de la propuesta recibida, con los lados cambiados.
 */
const props = defineProps<{
  myId: number;
  preFamily?: number | undefined;
  preItem?: number | undefined;
  counterOf?: number | undefined;
}>();

type StepKey = 'familia' | 'recibes' | 'das' | 'revisar';

const loading = ref(true);
const error = ref('');
const busy = ref(false);
const families = ref<FamilySummary[]>([]);
const items = ref<StockItemView[]>([]);
const original = ref<TradeDetail | null>(null);

const target = ref<number | null>(null);
/** Cantidad elegida por artículo (texto del campo). */
const receive = ref<Record<number, string>>({});
const give = ref<Record<number, string>>({});
const mensaje = ref('');
const stepIndex = ref(0);

const skipFamily = computed(() => props.counterOf !== undefined || props.preFamily !== undefined || props.preItem !== undefined);
const steps = computed<StepKey[]>(() => (skipFamily.value ? ['recibes', 'das', 'revisar'] : ['familia', 'recibes', 'das', 'revisar']));
const step = computed(() => steps.value[stepIndex.value] ?? 'revisar');

const other = computed(() => families.value.find((f) => f.id === target.value) ?? null);
const theirItems = computed(() => items.value.filter((i) => i.userId === target.value && i.disponible > 0));
const myItems = computed(() => items.value.filter((i) => i.userId === props.myId && i.disponible > 0));
const itemById = computed(() => new Map(items.value.map((i) => [i.id, i])));

interface Chosen {
  item: StockItemView;
  cantidad: number;
}
function chosen(map: Record<number, string>): Chosen[] {
  const result: Chosen[] = [];
  for (const [id, text] of Object.entries(map)) {
    const item = itemById.value.get(Number(id));
    const cantidad = parseQty(text);
    if (item && cantidad !== null && cantidad > 0) result.push({ item, cantidad });
  }
  return result;
}
const receiveLines = computed(() => chosen(receive.value));
const giveLines = computed(() => chosen(give.value));

const summary = computed(() => {
  const lines: SummaryLine[] = [
    ...giveLines.value.map((c) => ({ lado: 'proposer' as const, valueCb: c.item.valueCb, cantidad: c.cantidad, unverified: c.item.unverified })),
    ...receiveLines.value.map((c) => ({ lado: 'receiver' as const, valueCb: c.item.valueCb, cantidad: c.cantidad, unverified: c.item.unverified })),
  ];
  return summarize(lines, 'proposer');
});
const isGift = computed(() => (giveLines.value.length === 0) !== (receiveLines.value.length === 0));

/** Mensaje si la cantidad elegida supera lo disponible o no es un número válido. */
function problem(item: StockItemView, text: string | undefined): string {
  if (text === undefined || text.trim() === '') return '';
  const q = parseQty(text);
  if (q === null) return t.comun.cantidadInvalida;
  if (q > item.disponible) return t.trueques.cantidadMayor(item.nombre, formatQty(item.disponible));
  return '';
}
const hasProblems = computed(() =>
  [...theirItems.value.map((i) => problem(i, receive.value[i.id])), ...myItems.value.map((i) => problem(i, give.value[i.id]))].some(Boolean),
);

function bump(map: Record<number, string>, item: StockItemView, delta: number) {
  const current = parseQty(map[item.id] ?? '') ?? 0;
  const next = Math.min(item.disponible, Math.max(0, Math.round((current + delta) * 100) / 100));
  map[item.id] = next === 0 ? '' : formatQty(next);
}

// --- Carga y valores iniciales -----------------------------------------------------------------
async function load() {
  const [stocks, trade] = await Promise.all([
    api<{ families: FamilySummary[]; items: StockItemView[] }>('/api/stocks'),
    props.counterOf === undefined ? Promise.resolve(null) : api<{ trade: TradeDetail }>(`/api/me/trueques/${props.counterOf}`),
  ]);
  loading.value = false;
  if (!stocks.ok) {
    error.value = stocks.data.message ?? t.comun.errorGenerico;
    return;
  }
  families.value = stocks.data.families.filter((f) => f.id !== props.myId);
  items.value = stocks.data.items;

  if (props.counterOf !== undefined) {
    if (!trade || !trade.ok) {
      error.value = trade?.data.message ?? t.comun.errorGenerico;
      return;
    }
    const old = trade.data.trade;
    if (old.estado !== 'pendiente' || old.me !== 'receiver') {
      error.value = t.erroresTrueque.not_pending;
      return;
    }
    original.value = old;
    target.value = old.proposer.id;
    // Lados cambiados: lo que yo daba como receptor (lado receiver) sigue siendo mío; lo del otro, lo recibo.
    for (const line of old.lines) {
      const item = line.stockItemId === null ? undefined : itemById.value.get(line.stockItemId);
      if (!item || item.disponible <= 0) continue;
      const q = Math.min(line.cantidad, item.disponible);
      (line.lado === 'receiver' ? give.value : receive.value)[item.id] = formatQty(q);
    }
    return;
  }
  if (props.preItem !== undefined) {
    const item = itemById.value.get(props.preItem);
    if (item && item.userId !== props.myId && item.disponible > 0) {
      target.value = item.userId;
      receive.value[item.id] = formatQty(Math.min(1, item.disponible));
    }
  }
  if (target.value === null && props.preFamily !== undefined && families.value.some((f) => f.id === props.preFamily)) target.value = props.preFamily;
  if (target.value === null && skipFamily.value) stepIndex.value = 0; // sin familia válida: se queda en el primer paso disponible
}

// --- Navegación ---------------------------------------------------------------------------------
const canNext = computed(() => {
  if (step.value === 'familia') return target.value !== null;
  if (step.value === 'recibes' || step.value === 'das') return !hasProblems.value;
  return false;
});
const canSend = computed(() => target.value !== null && !hasProblems.value && receiveLines.value.length + giveLines.value.length > 0);

function next() {
  error.value = '';
  if (canNext.value) stepIndex.value += 1;
}
function back() {
  error.value = '';
  if (stepIndex.value > 0) stepIndex.value -= 1;
  else go(props.counterOf === undefined ? '/app/trueques' : `/app/trueques/${props.counterOf}`);
}

async function send() {
  error.value = '';
  if (!canSend.value || target.value === null) {
    error.value = t.trueques.revisaAlgo;
    return;
  }
  busy.value = true;
  const doy = giveLines.value.map((c) => ({ stockItemId: c.item.id, cantidad: c.cantidad }));
  const recibo = receiveLines.value.map((c) => ({ stockItemId: c.item.id, cantidad: c.cantidad }));
  const text = mensaje.value.trim() || null;
  const result =
    props.counterOf === undefined
      ? await api<{ id: number }>('/api/me/trueques', { body: { receiverId: target.value, doy, recibo, mensaje: text } })
      : await api<{ id: number }>(`/api/me/trueques/${props.counterOf}`, { body: { action: 'counter', doy, recibo, mensaje: text } });
  busy.value = false;
  if (!result.ok) {
    error.value = result.data.message ?? t.comun.errorGenerico;
    return;
  }
  go(`/app/trueques/${result.data.id}`);
}

onMounted(load);
</script>

<template>
  <div class="space-y-5">
    <p v-if="original" class="alert-info">{{ t.trueques.contraAyuda(original.proposer.nick) }}</p>
    <p v-if="loading">{{ t.comun.cargando }}</p>
    <p v-if="error" class="alert-error" role="alert">{{ error }}</p>

    <template v-if="!loading && !(counterOf !== undefined && original === null)">
      <!-- Resumen siempre visible -->
      <div class="sticky top-18 z-10">
        <TradeSummaryBar :summary="summary" :gift="isGift" />
      </div>

      <p class="hint" role="status">{{ t.trueques.paso(stepIndex + 1, steps.length) }} · {{ t.trueques.informativo }}</p>

      <!-- 1. Familia -->
      <section v-if="step === 'familia'" aria-labelledby="st-familia">
        <h2 id="st-familia" class="mb-3">{{ t.trueques.elegirFamilia }}</h2>
        <ul class="grid gap-3 sm:grid-cols-2">
          <li v-for="f in families" :key="f.id">
            <button
              type="button"
              class="card flex min-h-20 w-full items-center gap-4 text-left"
              :class="target === f.id ? 'border-berenjena-700! bg-berenjena-50' : 'hover:border-berenjena-300'"
              :aria-pressed="target === f.id"
              @click="target = f.id"
            >
              <AvatarImg :avatar="f.avatar" :nick="f.nick" size="lg" />
              <span class="text-lg font-bold">{{ f.nick }}</span>
            </button>
          </li>
        </ul>
      </section>

      <!-- 2. Lo que recibes -->
      <section v-else-if="step === 'recibes'" aria-labelledby="st-recibes">
        <h2 id="st-recibes" class="mb-1">{{ t.trueques.pasoRecibes }}</h2>
        <p class="hint mb-3">{{ other ? t.trueques.recibesAyuda(other.nick) : '' }}</p>
        <p v-if="target === null" class="alert-info">{{ t.trueques.elegirFamilia }}</p>
        <p v-else-if="theirItems.length === 0" class="alert-info">{{ t.trueques.sinArticulosOtra }}</p>
        <ul v-else class="space-y-3">
          <li v-for="item in theirItems" :key="item.id" class="card">
            <p class="text-lg font-bold">{{ item.nombre }}</p>
            <p class="hint">
              {{ t.trueques.disponibles(formatQty(item.disponible), item.unidad) }} · {{ t.articulo.porUnidad(formatB(item.valueCb), item.unidad) }}
              <span v-if="item.unverified"> · {{ t.articulo.valorSinVerificar }}</span>
            </p>
            <div class="mt-3 flex items-end gap-2">
              <button type="button" class="btn-secondary px-4!" :aria-label="`${t.trueques.quitar} ${item.nombre}`" @click="bump(receive, item, -1)">−</button>
              <div class="flex-1">
                <label class="label" :for="`r-${item.id}`">{{ t.trueques.cantidad }}</label>
                <input :id="`r-${item.id}`" v-model="receive[item.id]" class="input" type="text" inputmode="decimal" autocomplete="off" placeholder="0" />
              </div>
              <button type="button" class="btn-secondary px-4!" :aria-label="`${t.trueques.anadir} ${item.nombre}`" @click="bump(receive, item, 1)">+</button>
            </div>
            <p v-if="problem(item, receive[item.id])" class="alert-error mt-2" role="alert">{{ problem(item, receive[item.id]) }}</p>
          </li>
        </ul>
      </section>

      <!-- 3. Lo que das -->
      <section v-else-if="step === 'das'" aria-labelledby="st-das">
        <h2 id="st-das" class="mb-1">{{ t.trueques.pasoDas }}</h2>
        <p class="hint mb-3">{{ t.trueques.dasAyuda }}</p>
        <div v-if="myItems.length === 0" class="alert-info">
          <p>{{ t.trueques.sinArticulosMios }}</p>
          <a href="/app/mi-stock" class="mt-2 inline-block font-semibold underline">{{ t.trueques.irMiStock }}</a>
        </div>
        <ul v-else class="space-y-3">
          <li v-for="item in myItems" :key="item.id" class="card">
            <p class="text-lg font-bold">{{ item.nombre }}</p>
            <p class="hint">
              {{ t.trueques.disponibles(formatQty(item.disponible), item.unidad) }} · {{ t.articulo.porUnidad(formatB(item.valueCb), item.unidad) }}
              <span v-if="item.unverified"> · {{ t.articulo.valorSinVerificar }}</span>
            </p>
            <div class="mt-3 flex items-end gap-2">
              <button type="button" class="btn-secondary px-4!" :aria-label="`${t.trueques.quitar} ${item.nombre}`" @click="bump(give, item, -1)">−</button>
              <div class="flex-1">
                <label class="label" :for="`g-${item.id}`">{{ t.trueques.cantidad }}</label>
                <input :id="`g-${item.id}`" v-model="give[item.id]" class="input" type="text" inputmode="decimal" autocomplete="off" placeholder="0" />
              </div>
              <button type="button" class="btn-secondary px-4!" :aria-label="`${t.trueques.anadir} ${item.nombre}`" @click="bump(give, item, 1)">+</button>
            </div>
            <p v-if="problem(item, give[item.id])" class="alert-error mt-2" role="alert">{{ problem(item, give[item.id]) }}</p>
          </li>
        </ul>
      </section>

      <!-- 4. Revisar y enviar -->
      <section v-else aria-labelledby="st-revisar" class="space-y-4">
        <h2 id="st-revisar">{{ t.trueques.pasoRevisar }}<span v-if="other"> · {{ t.trueques.con(other.nick) }}</span></h2>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="card">
            <h3 class="mb-2 text-lg font-bold">{{ t.trueques.das }}</h3>
            <p v-if="giveLines.length === 0" class="hint">{{ t.trueques.nadaLineas }}</p>
            <ul v-else class="space-y-1">
              <li v-for="c in giveLines" :key="c.item.id">{{ formatQty(c.cantidad) }} {{ c.item.unidad }} · {{ c.item.nombre }}</li>
            </ul>
          </div>
          <div class="card">
            <h3 class="mb-2 text-lg font-bold">{{ t.trueques.recibes }}</h3>
            <p v-if="receiveLines.length === 0" class="hint">{{ t.trueques.nadaLineas }}</p>
            <ul v-else class="space-y-1">
              <li v-for="c in receiveLines" :key="c.item.id">{{ formatQty(c.cantidad) }} {{ c.item.unidad }} · {{ c.item.nombre }}</li>
            </ul>
          </div>
        </div>
        <div>
          <label class="label" for="t-msg">{{ t.trueques.mensaje }}</label>
          <textarea id="t-msg" v-model="mensaje" class="input min-h-24!" :maxlength="config.propuestas.maxCaracteresMensaje" rows="3"></textarea>
          <p class="hint mt-1">{{ t.trueques.mensajeAyuda }}</p>
        </div>
      </section>

      <div class="flex flex-wrap gap-3 pb-4">
        <button type="button" class="btn-secondary" @click="back">{{ t.trueques.anterior }}</button>
        <button v-if="step !== 'revisar'" type="button" class="btn-primary" :disabled="!canNext" @click="next">{{ t.trueques.siguiente }}</button>
        <button v-else type="button" class="btn-primary" :disabled="busy || !canSend" @click="send">{{ busy ? t.trueques.enviando : t.trueques.enviar }}</button>
      </div>
    </template>
  </div>
</template>
