<script setup lang="ts">
import { t } from '../i18n/es.ts';

/** Acceso a la Plaza en un punto concreto de la app, con una frase que explica por qué es útil ahí. */
defineProps<{ text: string; label?: string | undefined }>();
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-hoja-700/30 bg-hoja-100 px-4 py-3">
    <p class="flex-1 text-base text-berenjena-900">{{ text }}</p>
    <a href="/app/plaza" class="btn-secondary shrink-0">{{ label ?? t.plaza.enlaces.preguntar }}</a>
  </div>
</template>
