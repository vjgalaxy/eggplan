<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { t } from '../i18n/es.ts';
import { api, go } from './api.ts';
import AvatarImg from './AvatarImg.vue';

interface Card {
  nick: string;
  avatar: string | null;
  canLogin: boolean;
  blocked: boolean;
}

const props = defineProps<{ cards: Card[] }>();

const selected = ref<Card | null>(null);
const password = ref('');
const showPassword = ref(false);
const busy = ref(false);
const error = ref('');
const passwordInput = ref<HTMLInputElement | null>(null);

const hasCards = computed(() => props.cards.length > 0);

async function choose(card: Card) {
  if (!card.canLogin) return;
  selected.value = card;
  password.value = '';
  error.value = '';
  await nextTick();
  passwordInput.value?.focus();
}

function back() {
  selected.value = null;
  password.value = '';
  error.value = '';
}

async function submit() {
  if (!selected.value || busy.value || password.value.length === 0) return;
  busy.value = true;
  error.value = '';
  const result = await api('/api/auth/login', { body: { nick: selected.value.nick, password: password.value } });
  if (result.ok && result.data.redirect) {
    go(result.data.redirect);
    return;
  }
  error.value = result.data.message ?? t.comun.errorGenerico;
  password.value = '';
  busy.value = false;
  passwordInput.value?.focus();
}
</script>

<template>
  <div>
    <!-- Paso 2: pedir solo la clave -->
    <form v-if="selected" class="mx-auto max-w-md" novalidate @submit.prevent="submit">
      <div class="mb-6 flex flex-col items-center gap-3 text-center">
        <AvatarImg :avatar="selected.avatar" :nick="selected.nick" size="xl" />
        <h2>{{ t.login.entrandoComo(selected.nick) }}</h2>
      </div>

      <label class="label" for="login-password">{{ t.login.clave }}</label>
      <div class="flex gap-2">
        <input
          id="login-password"
          ref="passwordInput"
          v-model="password"
          class="input"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="current-password"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          :aria-describedby="error ? 'login-error login-help' : 'login-help'"
          :aria-invalid="error ? 'true' : 'false'"
        />
        <button type="button" class="btn-secondary shrink-0" :aria-pressed="showPassword" @click="showPassword = !showPassword">
          {{ showPassword ? t.login.ocultar : t.login.mostrar }}
        </button>
      </div>
      <p id="login-help" class="hint mt-1">{{ t.login.claveAyuda }}</p>

      <p v-if="error" id="login-error" class="alert-error mt-4" role="alert">{{ error }}</p>

      <div class="mt-6 flex flex-col gap-3">
        <button type="submit" class="btn-primary w-full" :disabled="busy || password.length === 0">
          {{ busy ? t.login.entrando : t.login.entrar }}
        </button>
        <button type="button" class="btn-ghost w-full" @click="back">{{ t.login.otraPlaza }}</button>
      </div>
    </form>

    <!-- Paso 1: cuadrícula de tarjetas -->
    <div v-else>
      <h2 class="mb-4 text-center">{{ t.login.elige }}</h2>
      <p v-if="!hasCards" class="alert-info text-center">{{ t.login.sinPlazas }}</p>
      <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        <li v-for="card in cards" :key="card.nick">
          <button
            type="button"
            class="flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 p-3 text-center transition-colors"
            :class="
              card.canLogin
                ? 'border-berenjena-200 bg-white hover:border-berenjena-700 hover:bg-berenjena-50'
                : 'cursor-not-allowed border-crema-200 bg-crema-100'
            "
            :disabled="!card.canLogin"
            :aria-label="card.canLogin ? t.login.plazaAria(card.nick) : `${card.nick}. ${card.blocked ? t.login.bloqueada : t.login.pideCodigo}`"
            @click="choose(card)"
          >
            <AvatarImg :avatar="card.avatar" :nick="card.nick" size="lg" />
            <span class="text-lg font-bold">{{ card.nick }}</span>
            <span v-if="!card.canLogin" class="hint">{{ card.blocked ? t.login.bloqueada : t.login.pideCodigo }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
