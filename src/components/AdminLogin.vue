<script setup lang="ts">
import { ref } from 'vue';
import { t } from '../i18n/es.ts';
import { api, go } from './api.ts';

const password = ref('');
const busy = ref(false);
const error = ref('');

async function submit() {
  if (busy.value || password.value.length === 0) return;
  busy.value = true;
  error.value = '';
  const result = await api('/api/auth/admin-login', { body: { password: password.value } });
  if (result.ok && result.data.redirect) {
    go(result.data.redirect);
    return;
  }
  error.value = result.data.message ?? t.comun.errorGenerico;
  password.value = '';
  busy.value = false;
}
</script>

<template>
  <form class="mx-auto max-w-md" novalidate @submit.prevent="submit">
    <h1 class="mb-2">{{ t.admin.loginTitulo }}</h1>
    <p class="hint mb-6">{{ t.admin.loginAyuda }}</p>

    <label class="label" for="admin-password">{{ t.admin.clave }}</label>
    <input
      id="admin-password"
      v-model="password"
      class="input"
      type="password"
      autocomplete="current-password"
      :aria-invalid="error ? 'true' : 'false'"
      :aria-describedby="error ? 'admin-error' : undefined"
    />
    <p v-if="error" id="admin-error" class="alert-error mt-4" role="alert">{{ error }}</p>

    <button type="submit" class="btn-primary mt-6 w-full" :disabled="busy || password.length === 0">
      {{ busy ? t.login.entrando : t.admin.entrar }}
    </button>
  </form>
</template>
