<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { config } from '../data/config.ts';
import { t } from '../i18n/es.ts';
import { formatB, formatDate, formatQty } from '../lib/format.ts';
import { lineTotalCb } from '../lib/domain/trades.ts';
import type { AvisoView } from '../lib/avisos.ts';
import type { TradeDetail, TradeLineView } from '../lib/trades/trades.ts';
import { api } from './api.ts';
import AvatarImg from './AvatarImg.vue';
import TradeSummaryBar from './TradeSummaryBar.vue';

/** Una propuesta: líneas, resumen, acciones según su estado y el hilo privado de mensajes. */
const props = defineProps<{ tradeId: number }>();

const trade = ref<TradeDetail | null>(null);
const loading = ref(true);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const text = ref('');

const other = computed(() => (trade.value?.me === 'proposer' ? trade.value.receiver : trade.value?.proposer));
const mine = computed(() => trade.value?.lines.filter((l) => l.lado === trade.value?.me) ?? []);
const theirs = computed(() => trade.value?.lines.filter((l) => l.lado !== trade.value?.me) ?? []);
const isGift = computed(() => (mine.value.length === 0) !== (theirs.value.length === 0));
const myDelivered = computed(() => (trade.value?.me === 'proposer' ? trade.value.proposerDelivered : trade.value?.receiverDelivered) ?? false);
const otherDelivered = computed(() => (trade.value?.me === 'proposer' ? trade.value.receiverDelivered : trade.value?.proposerDelivered) ?? false);
const threadOpen = computed(() => ['pendiente', 'aceptada', 'completada'].includes(trade.value?.estado ?? ''));

async function load(markRead = false) {
  const result = await api<{ trade: TradeDetail }>(`/api/me/trueques/${props.tradeId}`);
  loading.value = false;
  if (!result.ok) {
    error.value = result.data.message ?? t.comun.errorGenerico;
    return;
  }
  trade.value = result.data.trade;
  if (markRead) await markRelatedAvisos();
}

/** Al abrir la propuesta, sus avisos sin leer pasan a leídos. */
async function markRelatedAvisos() {
  const result = await api<{ avisos: AvisoView[] }>('/api/me/avisos');
  if (!result.ok) return;
  const ids = result.data.avisos.filter((a) => !a.read && a.payload['tradeId'] === props.tradeId).map((a) => a.id);
  if (ids.length > 0) await api('/api/me/avisos', { body: { action: 'read', ids } });
}

async function act(body: Record<string, unknown>, done?: string) {
  busy.value = true;
  error.value = notice.value = '';
  const result = await api(`/api/me/trueques/${props.tradeId}`, { body });
  busy.value = false;
  if (!result.ok) {
    error.value = result.data.message ?? t.comun.errorGenerico;
    await load();
    return;
  }
  if (done) notice.value = done;
  await load();
}

function accept() {
  void act({ action: 'accept' }, t.trueques.accionHecha);
}
function reject() {
  if (window.confirm(t.trueques.rechazarConfirmar)) void act({ action: 'reject' }, t.trueques.accionHecha);
}
function cancel() {
  const message = otherDelivered.value && other.value ? t.trueques.cancelarConfirmarEntregado(other.value.nick) : t.trueques.cancelarConfirmar;
  if (window.confirm(message)) void act({ action: 'cancel' }, t.trueques.accionHecha);
}
function delivered() {
  if (window.confirm(t.trueques.entregadoConfirmar)) void act({ action: 'delivered' }, t.trueques.accionHecha);
}
function returned(line: TradeLineView) {
  if (window.confirm(t.trueques.devueltoConfirmar)) void act({ action: 'returned', lineId: line.id }, t.trueques.accionHecha);
}
async function sendMessage() {
  const cuerpo = text.value.trim();
  if (!cuerpo) return;
  busy.value = true;
  error.value = notice.value = '';
  const result = await api(`/api/me/trueques/${props.tradeId}`, { body: { action: 'message', cuerpo } });
  busy.value = false;
  if (!result.ok) {
    error.value = result.data.message ?? t.comun.errorGenerico;
    return;
  }
  text.value = '';
  await load();
}

// Refresco ligero del hilo y del estado mientras la pestaña está visible.
let timer: ReturnType<typeof setInterval> | undefined;
function tick() {
  if (document.visibilityState === 'visible' && !busy.value) void load();
}
onMounted(() => {
  void load(true);
  timer = setInterval(tick, config.avisos.pollingMs);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div class="space-y-5">
    <a href="/app/trueques" class="inline-block font-semibold text-berenjena-700 underline">← {{ t.trueques.volver }}</a>
    <p v-if="loading">{{ t.comun.cargando }}</p>
    <p v-if="error" class="alert-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="alert-ok" role="status">{{ notice }}</p>

    <template v-if="trade && other">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <AvatarImg :avatar="other.avatar" :nick="other.nick" size="lg" />
          <div>
            <h2>{{ trade.me === 'proposer' ? t.trueques.propuestaA(other.nick) : t.trueques.propuestaDe(other.nick) }}</h2>
            <p class="hint">
              {{ trade.estado === 'pendiente' ? t.trueques.caduca(formatDate(trade.expiresAt)) : t.trueques.actualizada(formatDate(trade.updatedAt)) }}
            </p>
          </div>
        </div>
        <span class="rounded-lg bg-berenjena-100 px-3 py-1 text-base font-bold text-berenjena-800">{{ t.trueques.estado[trade.estado] }}</span>
      </div>

      <TradeSummaryBar :summary="trade.summary" :gift="isGift" />

      <div class="grid gap-4 sm:grid-cols-2">
        <section class="card" aria-labelledby="d-das">
          <h3 id="d-das" class="mb-2 text-lg font-bold">{{ t.trueques.das }}</h3>
          <p v-if="mine.length === 0" class="hint">{{ t.trueques.nadaLineas }}</p>
          <ul v-else class="space-y-3">
            <li v-for="line in mine" :key="line.id">
              <p class="font-semibold">{{ formatQty(line.cantidad) }} {{ line.unidad }} · {{ line.nombre }}</p>
              <p class="hint">{{ t.articulo.porUnidad(formatB(line.valueCb), line.unidad) }} · {{ formatB(lineTotalCb(line.valueCb, line.cantidad)) }}</p>
              <p v-if="line.unverified" class="hint">{{ t.articulo.valorSinVerificar }}</p>
              <template v-if="line.tipo === 'prestamo' && trade.estado === 'completada'">
                <p v-if="line.returnedAt" class="font-semibold text-hoja-700">{{ t.trueques.prestamoDevuelto }}</p>
                <div v-else>
                  <p class="hint">{{ t.trueques.prestamoTuyoPendiente }}</p>
                  <button type="button" class="btn-secondary mt-2" :disabled="busy" @click="returned(line)">{{ t.trueques.devuelto }}</button>
                </div>
              </template>
            </li>
          </ul>
        </section>
        <section class="card" aria-labelledby="d-recibes">
          <h3 id="d-recibes" class="mb-2 text-lg font-bold">{{ t.trueques.recibes }}</h3>
          <p v-if="theirs.length === 0" class="hint">{{ t.trueques.nadaLineas }}</p>
          <ul v-else class="space-y-3">
            <li v-for="line in theirs" :key="line.id">
              <p class="font-semibold">{{ formatQty(line.cantidad) }} {{ line.unidad }} · {{ line.nombre }}</p>
              <p class="hint">{{ t.articulo.porUnidad(formatB(line.valueCb), line.unidad) }} · {{ formatB(lineTotalCb(line.valueCb, line.cantidad)) }}</p>
              <p v-if="line.unverified" class="hint">{{ t.articulo.valorSinVerificar }}</p>
              <template v-if="line.tipo === 'prestamo' && trade.estado === 'completada'">
                <p v-if="line.returnedAt" class="font-semibold text-hoja-700">{{ t.trueques.prestamoDevuelto }}</p>
                <p v-else class="hint">{{ t.trueques.prestamoPendiente(other.nick) }}</p>
              </template>
            </li>
          </ul>
        </section>
      </div>

      <!-- Acciones según el estado y el papel -->
      <section class="card space-y-4" aria-labelledby="d-acciones">
        <h3 id="d-acciones" class="sr-only">{{ t.trueques.titulo }}</h3>

        <template v-if="trade.estado === 'pendiente' && trade.me === 'receiver'">
          <p class="font-semibold">{{ t.trueques.teEsperan(other.nick) }}</p>
          <p class="hint">{{ t.trueques.aceptarAyuda }}</p>
          <div class="flex flex-wrap gap-3">
            <button type="button" class="btn-primary" :disabled="busy" @click="accept">{{ t.trueques.aceptar }}</button>
            <a :href="`/app/trueques/nuevo?contra=${trade.id}`" class="btn-secondary">{{ t.trueques.contraofertar }}</a>
            <button type="button" class="btn-ghost text-peligro-700" :disabled="busy" @click="reject">{{ t.trueques.rechazar }}</button>
          </div>
        </template>

        <template v-else-if="trade.estado === 'pendiente'">
          <p class="font-semibold">{{ t.trueques.esperando(other.nick) }}</p>
          <button type="button" class="btn-secondary" :disabled="busy" @click="cancel">{{ t.trueques.cancelar }}</button>
        </template>

        <template v-else-if="trade.estado === 'aceptada'">
          <p class="hint">{{ t.trueques.entregadoAyuda }}</p>
          <p v-if="myDelivered" class="alert-ok">{{ t.trueques.yaEntregaste }} {{ t.trueques.faltaEntregar(other.nick) }}</p>
          <p v-else-if="otherDelivered" class="alert-info">{{ t.trueques.heEntregadoNick(other.nick) }}</p>
          <div class="flex flex-wrap gap-3">
            <button v-if="!myDelivered" type="button" class="btn-primary" :disabled="busy" @click="delivered">{{ t.trueques.entregado }}</button>
            <button type="button" class="btn-ghost text-peligro-700" :disabled="busy" @click="cancel">{{ t.trueques.cancelar }}</button>
          </div>
        </template>

        <template v-else-if="trade.estado === 'completada'">
          <p class="alert-ok">{{ t.trueques.completadaTexto }}</p>
        </template>

        <template v-else-if="trade.estado === 'contraofertada'">
          <p class="font-semibold">{{ t.trueques.hechaContra(trade.me === 'receiver' ? t.trueques.tu : other.nick) }}</p>
          <a v-if="trade.counterTradeId" :href="`/app/trueques/${trade.counterTradeId}`" class="btn-secondary">{{ t.trueques.verContra }}</a>
        </template>

        <template v-else>
          <p class="font-semibold">{{ t.trueques.enHechoTexto[trade.estado as 'rechazada' | 'cancelada' | 'caducada'] }}</p>
        </template>

        <a v-if="trade.parentTradeId" :href="`/app/trueques/${trade.parentTradeId}`" class="inline-block font-semibold text-berenjena-700 underline">
          {{ t.trueques.vieneDe }} {{ t.trueques.verOriginal }}
        </a>
      </section>

      <!-- Hilo privado -->
      <section class="card space-y-3" aria-labelledby="d-hilo">
        <h3 id="d-hilo" class="text-lg font-bold">{{ t.trueques.hilo }}</h3>
        <p class="hint">{{ t.trueques.hiloPrivado }}</p>
        <p v-if="trade.messages.length === 0" class="hint">{{ t.trueques.hiloVacio }}</p>
        <ul v-else class="space-y-2" aria-live="polite">
          <li
            v-for="message in trade.messages"
            :key="message.id"
            class="rounded-xl px-4 py-2"
            :class="message.userId === (trade.me === 'proposer' ? trade.proposer.id : trade.receiver.id) ? 'ml-6 bg-berenjena-100' : 'mr-6 bg-crema-100'"
          >
            <p class="text-base font-bold">{{ message.nick }} <span class="hint font-normal">· {{ formatDate(message.createdAt) }}</span></p>
            <p class="whitespace-pre-wrap break-words">{{ message.cuerpo }}</p>
          </li>
        </ul>

        <form v-if="threadOpen" class="space-y-2" @submit.prevent="sendMessage">
          <label class="label" for="d-msg">{{ t.trueques.escribir }}</label>
          <textarea id="d-msg" v-model="text" class="input min-h-20!" rows="2" :maxlength="config.propuestas.maxCaracteresMensaje"></textarea>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="hint">{{ t.trueques.caracteres([...text].length, config.propuestas.maxCaracteresMensaje) }}</p>
            <button type="submit" class="btn-primary" :disabled="busy || text.trim() === ''">{{ t.trueques.enviarMensaje }}</button>
          </div>
        </form>
        <p v-else class="hint">{{ t.trueques.hiloCerrado }}</p>
      </section>
    </template>
  </div>
</template>
