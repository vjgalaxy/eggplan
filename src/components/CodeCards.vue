<script setup lang="ts">
import { t } from '../i18n/es.ts';
import AvatarImg from './AvatarImg.vue';

export interface IssuedCode {
  seatId: number;
  nick: string;
  avatar: string | null;
  code: string;
}

defineProps<{ codes: IssuedCode[]; address: string }>();
</script>

<template>
  <!-- Una tarjeta por familia, pensada para recortar: nunca se parte entre páginas al imprimir. -->
  <ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2 print:gap-3">
    <li
      v-for="item in codes"
      :key="item.seatId"
      class="break-inside-avoid rounded-2xl border-2 border-dashed border-berenjena-700 bg-white p-5 text-berenjena-900"
    >
      <div class="flex items-center gap-4">
        <AvatarImg :avatar="item.avatar" :nick="item.nick" size="lg" />
        <div>
          <p class="text-sm font-semibold text-tinta-600"><span aria-hidden="true" class="mr-1">{{ t.app.emoji }}</span>{{ t.app.nombre }}</p>
          <p class="text-2xl font-extrabold">{{ item.nick }}</p>
        </div>
      </div>

      <p class="mt-4 text-sm font-semibold text-tinta-600">{{ t.admin.tarjetaCodigo }}</p>
      <p class="rounded-xl bg-berenjena-50 px-3 py-2 text-center font-mono text-2xl font-bold tracking-wide">{{ item.code }}</p>
      <p class="hint mt-1">{{ t.admin.tarjetaCodigoAviso }}</p>

      <p class="mt-3 text-sm font-semibold text-tinta-600">{{ t.admin.tarjetaDireccion }}</p>
      <p class="break-all font-mono text-base">{{ address }}</p>

      <ol class="mt-3 list-decimal space-y-1 pl-6 text-base">
        <li v-for="paso in t.admin.tarjetaPasos" :key="paso">{{ paso }}</li>
      </ol>
    </li>
  </ul>
</template>
