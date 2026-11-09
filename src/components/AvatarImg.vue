<script setup lang="ts">
import { computed } from 'vue';
import { avatarUrl } from '../lib/domain/avatars.ts';

const props = withDefaults(defineProps<{ avatar: string | null; nick: string; size?: 'sm' | 'md' | 'lg' | 'xl' }>(), {
  size: 'md',
});

const url = computed(() => avatarUrl(props.avatar));
const sizeClass = computed(
  () => ({ sm: 'h-8 w-8', md: 'h-12 w-12', lg: 'h-20 w-20', xl: 'h-28 w-28' })[props.size],
);
const initial = computed(() => props.nick.charAt(0).toUpperCase());
</script>

<template>
  <img
    v-if="url"
    :src="url"
    :alt="nick"
    :class="[sizeClass, 'shrink-0 rounded-full border-2 border-berenjena-200 bg-crema-100 object-cover']"
    loading="lazy"
    width="112"
    height="112"
  />
  <span
    v-else
    role="img"
    :aria-label="nick"
    :class="[sizeClass, 'inline-flex shrink-0 items-center justify-center rounded-full bg-berenjena-100 font-bold text-berenjena-700']"
  >
    {{ initial }}
  </span>
</template>
