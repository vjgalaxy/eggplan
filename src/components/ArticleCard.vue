<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n/es.ts';
import { formatB, formatDate, formatQty } from '../lib/format.ts';
import type { StockItemView } from '../lib/stock/stock.ts';
import AvatarImg from './AvatarImg.vue';

/** Un artículo del stock, tal y como lo ven las familias (y como se previsualiza al añadirlo). */
const props = defineProps<{ item: StockItemView; showOwner?: boolean; categoryName?: string }>();

const agotado = computed(() => props.item.disponible <= 0);
</script>

<template>
  <article class="card" :class="agotado ? 'opacity-70' : ''">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 class="text-lg font-bold">{{ item.nombre }}</h3>
        <p v-if="categoryName" class="hint">{{ categoryName }}</p>
      </div>
      <p class="rounded-lg bg-berenjena-100 px-3 py-1 text-base font-bold text-berenjena-800">
        {{ t.articulo.porUnidad(formatB(item.valueCb), item.unidad) }}
      </p>
    </div>

    <p v-if="showOwner" class="mt-2 flex items-center gap-2">
      <AvatarImg :avatar="item.avatar" :nick="item.nick" size="sm" />
      <span class="font-semibold">{{ item.nick }}</span>
    </p>

    <ul class="mt-3 space-y-1 text-base">
      <li>
        <span v-if="agotado" class="font-semibold text-peligro-700">{{ t.articulo.agotado }}</span>
        <span v-else class="font-semibold">{{ t.articulo.disponibles(formatQty(item.disponible), item.unidad) }}</span>
        <span v-if="item.reservado > 0" class="hint"> · {{ t.articulo.reservadas(formatQty(item.reservado)) }}</span>
      </li>
      <li v-if="item.tipo !== 'bien'">{{ t.articulo.tipo[item.tipo] }}</li>
      <li v-else-if="item.condicion">{{ t.articulo.condicion[item.condicion] }}</li>
      <li v-if="item.caducaEl">{{ t.articulo.caduca(formatDate(item.caducaEl)) }}</li>
      <li v-if="item.nota" class="hint">{{ item.nota }}</li>
    </ul>

    <p v-if="item.unverified" class="mt-3 inline-block rounded-lg border border-berenjena-200 bg-berenjena-50 px-3 py-1 text-base font-semibold text-berenjena-800">
      {{ t.articulo.valorSinVerificar }}
    </p>
    <p v-else-if="item.custom" class="hint mt-3">{{ t.articulo.productoPropio }}</p>

    <div v-if="$slots['actions']" class="mt-4 flex flex-wrap gap-2">
      <slot name="actions" />
    </div>
  </article>
</template>
