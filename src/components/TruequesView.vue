<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { config } from '../data/config.ts';
import { t } from '../i18n/es.ts';
import { formatDate } from '../lib/format.ts';
import type { AvisoView } from '../lib/avisos.ts';
import type { TradeView } from '../lib/trades/trades.ts';
import { api, go } from './api.ts';
import { avisoInfo } from './avisos-info.ts';
import AvatarImg from './AvatarImg.vue';
import PlazaHint from './PlazaHint.vue';
import TradeSummaryBar from './TradeSummaryBar.vue';
import { startAdaptivePolling, type AdaptivePoller } from './poller.ts';

/** Trueques: mis propuestas (por grupos) y el buzón de avisos. */
const props = defineProps<{ tab?: 'propuestas' | 'avisos' }>();
const emit = defineEmits<{ unread: [n: number] }>();

const tab = ref<'propuestas' | 'avisos'>(props.tab ?? 'propuestas');
const trades = ref<TradeView[]>([]);
const avisos = ref<AvisoView[]>([]);
const unread = ref(0);
const loading = ref(true);
const error = ref('');

const counterpart = (trade: TradeView) => (trade.me === 'proposer' ? trade.receiver : trade.proposer);

const groups = computed(() => {
  const all = trades.value;
  return [
    { key: 'respuesta', title: t.trueques.grupoRespuesta, items: all.filter((x) => x.estado === 'pendiente' && x.me === 'receiver') },
    { key: 'enviadas', title: t.trueques.grupoEnviadas, items: all.filter((x) => x.estado === 'pendiente' && x.me === 'proposer') },
    { key: 'aceptadas', title: t.trueques.grupoAceptadas, items: all.filter((x) => x.estado === 'aceptada') },
    { key: 'prestados', title: t.trueques.grupoPrestados, items: all.filter((x) => x.estado === 'completada' && x.onLoan) },
    { key: 'historial', title: t.trueques.grupoHistorial, items: all.filter((x) => !['pendiente', 'aceptada'].includes(x.estado) && !(x.estado === 'completada' && x.onLoan)) },
  ].filter((g) => g.items.length > 0);
});

/** Huella de la lista y del buzón: si cambia, ha llegado algo (propuesta, respuesta, aviso…). */
let lastSignature = '';
const signatureOf = (list: TradeView[], av: AvisoView[]) =>
  `${list.map((x) => `${x.id}:${x.estado}:${x.updatedAt}`).join(',')}|${av.map((a) => `${a.id}:${a.read}`).join(',')}`;

/** Carga propuestas y avisos. Devuelve true si ha cambiado algo. */
async function load(): Promise<boolean> {
  const [tr, av] = await Promise.all([
    api<{ trades: TradeView[] }>('/api/me/trueques'),
    api<{ avisos: AvisoView[]; unread: number }>('/api/me/avisos'),
  ]);
  loading.value = false;
  if (tr.ok) {
    trades.value = tr.data.trades;
    error.value = '';
  } else if (trades.value.length === 0) {
    error.value = tr.data.message ?? t.comun.errorGenerico;
  }
  if (av.ok) {
    avisos.value = av.data.avisos;
    unread.value = av.data.unread;
    emit('unread', unread.value);
  }
  const signature = signatureOf(trades.value, avisos.value);
  const changed = lastSignature !== '' && signature !== lastSignature;
  lastSignature = signature;
  return changed;
}

async function markAll() {
  const result = await api<{ unread: number }>('/api/me/avisos', { body: { action: 'read_all' } });
  if (result.ok) {
    unread.value = result.data.unread;
    emit('unread', unread.value);
    avisos.value = avisos.value.map((a) => ({ ...a, read: true }));
  }
}

async function open(aviso: AvisoView) {
  const { href } = avisoInfo(aviso);
  if (!aviso.read) await api('/api/me/avisos', { body: { action: 'read', ids: [aviso.id] } });
  if (href) go(href);
}

// La lista se actualiza sola (antes solo se cargaba al abrirla): rápido mientras llegan cosas, en calma después.
let poller: AdaptivePoller | undefined;
const { rapidoMs, reposoMs, reposoTrasMs } = config.tiempoReal;
onMounted(async () => {
  await load();
  poller = startAdaptivePolling(load, { fastMs: rapidoMs, slowMs: reposoMs, idleAfterMs: reposoTrasMs });
});
onBeforeUnmount(() => poller?.stop());
</script>

<template>
  <div class="space-y-5">
    <div class="grid grid-cols-2 gap-2" role="tablist" :aria-label="t.trueques.titulo">
      <button
        type="button"
        role="tab"
        class="min-h-12 rounded-xl border-2 px-2 text-base font-bold"
        :class="tab === 'propuestas' ? 'border-berenjena-700 bg-berenjena-700 text-white' : 'border-berenjena-200 bg-white text-berenjena-800 hover:bg-berenjena-50'"
        :aria-selected="tab === 'propuestas'"
        @click="tab = 'propuestas'"
      >
        {{ t.trueques.pestanaPropuestas }}
      </button>
      <button
        type="button"
        role="tab"
        class="min-h-12 rounded-xl border-2 px-2 text-base font-bold"
        :class="tab === 'avisos' ? 'border-berenjena-700 bg-berenjena-700 text-white' : 'border-berenjena-200 bg-white text-berenjena-800 hover:bg-berenjena-50'"
        :aria-selected="tab === 'avisos'"
        @click="tab = 'avisos'"
      >
        {{ t.trueques.pestanaAvisos }}<span v-if="unread > 0"> ({{ unread }})</span>
      </button>
    </div>

    <p v-if="error" class="alert-error" role="alert">{{ error }}</p>
    <p v-if="loading">{{ t.comun.cargando }}</p>

    <!-- Propuestas -->
    <section v-else-if="tab === 'propuestas'" class="space-y-6">
      <a href="/app/trueques/nuevo" class="btn-primary w-full sm:w-auto">{{ t.trueques.nueva }}</a>

      <div v-if="trades.length === 0" class="card text-center">
        <h2 class="mb-2">{{ t.trueques.vacioTitulo }}</h2>
        <p class="mb-4">{{ t.trueques.vacioTexto }}</p>
        <a href="/app/stocks" class="btn-secondary">{{ t.trueques.verStocks }}</a>
      </div>
      <PlazaHint v-if="trades.length === 0" :text="t.plaza.enlaces.trueques" />

      <section v-for="group in groups" :key="group.key" :aria-labelledby="`g-${group.key}`">
        <h2 :id="`g-${group.key}`" class="mb-3">{{ group.title }}</h2>
        <ul class="space-y-3">
          <li v-for="trade in group.items" :key="trade.id">
            <a :href="`/app/trueques/${trade.id}`" class="card block hover:border-berenjena-300">
              <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p class="flex items-center gap-2">
                  <AvatarImg :avatar="counterpart(trade).avatar" :nick="counterpart(trade).nick" size="sm" />
                  <span class="text-lg font-bold">{{ t.trueques.con(counterpart(trade).nick) }}</span>
                </p>
                <span class="rounded-lg bg-berenjena-100 px-3 py-1 text-base font-bold text-berenjena-800">{{ t.trueques.estado[trade.estado] }}</span>
              </div>
              <TradeSummaryBar :summary="trade.summary" />
              <p class="hint mt-2">
                {{ trade.estado === 'pendiente' ? t.trueques.caduca(formatDate(trade.expiresAt)) : t.trueques.actualizada(formatDate(trade.updatedAt)) }}
              </p>
            </a>
          </li>
        </ul>
      </section>
    </section>

    <!-- Avisos -->
    <section v-else class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="hint">{{ unread > 0 ? t.avisos.sinLeer(unread) : '' }}</p>
        <button v-if="unread > 0" type="button" class="btn-secondary" @click="markAll">{{ t.avisos.marcarTodos }}</button>
      </div>
      <p v-if="avisos.length === 0" class="card text-center">{{ t.avisos.vacio }}</p>
      <ul v-else class="space-y-2">
        <li v-for="aviso in avisos" :key="aviso.id">
          <button
            type="button"
            class="flex min-h-14 w-full items-start justify-between gap-3 rounded-xl border-2 px-4 py-3 text-left"
            :class="aviso.read ? 'border-berenjena-100 bg-white' : 'border-berenjena-300 bg-berenjena-50'"
            @click="open(aviso)"
          >
            <span :class="aviso.read ? '' : 'font-bold'">{{ avisoInfo(aviso).texto }}</span>
            <span class="hint shrink-0">{{ formatDate(aviso.createdAt) }}</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
