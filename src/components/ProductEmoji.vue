<script setup lang="ts">
import { computed } from 'vue';
import { productEmoji } from '../lib/domain/emoji.ts';

/** Emoji decorativo de un producto: ayuda a reconocerlo de un vistazo; los lectores de pantalla lo ignoran. */
const props = defineProps<{
  nombre: string;
  categoria?: string | null | undefined;
  tipo?: 'bien' | 'servicio' | 'prestamo' | null | undefined;
}>();
const emoji = computed(() => productEmoji({ nombre: props.nombre, categoria: props.categoria, tipo: props.tipo }));
</script>

<template>
  <span aria-hidden="true" class="mr-1 inline-block not-italic">{{ emoji }}</span>
</template>
