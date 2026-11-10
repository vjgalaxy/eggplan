<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { t } from '../i18n/es.ts';
import { formatB, formatDate, formatQty } from '../lib/format.ts';
import type { TradeMetadata } from '../lib/trades/metadata.ts';
import { api } from './api.ts';

/**
 * Trueques para la administración: solo metadatos (partes, estado, fechas, artículos y valores).
 * Los mensajes de cada propuesta son privados de las dos partes y no se pueden ver desde aquí.
 */
const trades = ref<TradeMetadata[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  const result = await api<{ trades: TradeMetadata[] }>('/api/admin/trueques');
  loading.value = false;
  if (result.ok) trades.value = result.data.trades;
  else error.value = result.data.message ?? t.comun.errorGenerico;
}
onMounted(load);
</script>

<template>
  <section class="space-y-5 print:hidden">
    <div>
      <h1 class="mb-1">{{ t.adminTrueques.titulo }}</h1>
      <p class="hint">{{ t.adminTrueques.ayuda }}</p>
    </div>
    <p v-if="error" class="alert-error" role="alert">{{ error }}</p>
    <p v-if="loading">{{ t.comun.cargando }}</p>
    <p v-else-if="trades.length === 0" class="card text-center">{{ t.adminTrueques.vacio }}</p>
    <ul v-else class="space-y-3">
      <li v-for="trade in trades" :key="trade.id" class="card space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-lg font-bold">#{{ trade.id }} · {{ t.adminTrueques.entre(trade.proposer, trade.receiver) }}</p>
          <span class="rounded-lg bg-berenjena-100 px-3 py-1 text-base font-bold text-berenjena-800">{{ t.trueques.estado[trade.estado] }}</span>
        </div>
        <p class="hint">
          {{ t.adminTrueques.creada(formatDate(trade.createdAt)) }}
          <span v-if="trade.estado === 'pendiente'"> · {{ t.trueques.caduca(formatDate(trade.expiresAt)) }}</span>
          <span v-if="trade.estado === 'aceptada'"> · {{ t.adminTrueques.entregas(trade.proposerDelivered, trade.receiverDelivered) }}</span>
        </p>
        <div class="grid gap-3 sm:grid-cols-2">
          <div v-for="side in (['proposer', 'receiver'] as const)" :key="side">
            <p class="font-semibold">{{ t.adminTrueques.da(side === 'proposer' ? trade.proposer : trade.receiver) }}</p>
            <ul class="list-disc pl-5">
              <li v-for="(line, index) in trade.lines.filter((l) => l.lado === side)" :key="index">
                {{ formatQty(line.cantidad) }} {{ line.unidad }} · {{ line.nombre }} ({{ formatB(line.valueCb) }})
              </li>
              <li v-if="trade.lines.every((l) => l.lado !== side)" class="list-none hint">—</li>
            </ul>
          </div>
        </div>
        <p class="hint">{{ t.trueques.das }}: {{ formatB(trade.summary.giveCb) }} · {{ t.trueques.recibes }}: {{ formatB(trade.summary.receiveCb) }}</p>
      </li>
    </ul>
  </section>
</template>
