<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n/es.ts';
import { formatB } from '../lib/format.ts';
import type { TradeSummary } from '../lib/domain/trades.ts';

/** «Tú das · Recibes · Diferencia»: siempre visible y actualizado en vivo. Es informativo, no bloquea. */
const props = defineProps<{ summary: TradeSummary; gift?: boolean }>();

const difference = computed(() => {
  const d = props.summary.diffCb;
  if (d === 0) return t.trueques.equilibrado;
  return d > 0 ? t.trueques.diferenciaA(formatB(d)) : t.trueques.diferenciaEnContra(formatB(-d));
});
</script>

<template>
  <div class="rounded-2xl border-2 border-berenjena-200 bg-berenjena-50 p-4" role="group" :aria-label="`${t.trueques.das}, ${t.trueques.recibes}, ${t.trueques.diferencia}`">
    <dl class="grid grid-cols-3 gap-2 text-center">
      <div>
        <dt class="text-base text-tinta-600">{{ t.trueques.das }}</dt>
        <dd class="text-lg font-bold text-berenjena-900">{{ formatB(summary.giveCb) }}</dd>
      </div>
      <div>
        <dt class="text-base text-tinta-600">{{ t.trueques.recibes }}</dt>
        <dd class="text-lg font-bold text-berenjena-900">{{ formatB(summary.receiveCb) }}</dd>
      </div>
      <div>
        <dt class="text-base text-tinta-600">{{ t.trueques.diferencia }}</dt>
        <dd class="text-lg font-bold text-berenjena-900">{{ difference }}</dd>
      </div>
    </dl>
    <p v-if="gift" class="mt-2 text-center text-base font-semibold">{{ t.trueques.regalo }}</p>
    <p v-if="summary.includesUnverified" class="mt-2 text-center text-base font-semibold text-berenjena-800">{{ t.trueques.sinVerificar }}</p>
  </div>
</template>
