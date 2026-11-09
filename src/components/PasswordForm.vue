<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '../i18n/es.ts';
import { checkPassword, passwordStrength, type PasswordProblem } from '../lib/domain/password-policy.ts';
import { api, go } from './api.ts';

/**
 * Formulario de clave: obligatorio en el primer acceso (sin pedir la clave actual: la persona
 * acaba de entrar con el código) y voluntario desde Ajustes (con la clave actual).
 */
const props = defineProps<{ nick: string; forced: boolean; minLength: number }>();
const emit = defineEmits<{ saved: [] }>();

const current = ref('');
const next = ref('');
const repeat = ref('');
const busy = ref(false);
const serverError = ref('');
const done = ref(false);
const touched = ref(false);

const problemTexts = computed(() => t.clave.problemas(props.minLength));

// Prealimentación: se valida mientras escribe, y los errores solo se muestran tras escribir algo.
const liveProblems = computed<PasswordProblem[]>(() => {
  if (next.value.length === 0) return [];
  const problems = checkPassword({
    password: next.value,
    nick: props.nick,
    minLength: props.minLength,
    currentPassword: props.forced ? undefined : current.value,
  });
  if (repeat.value.length > 0 && repeat.value !== next.value) problems.push('no_coincide');
  return problems;
});

const strength = computed(() => passwordStrength(next.value));
const strengthColor = computed(
  () => ({ muy_debil: 'bg-peligro-700', debil: 'bg-orange-600', aceptable: 'bg-hoja-600', buena: 'bg-hoja-700' })[strength.value],
);
const strengthWidth = computed(() => ({ muy_debil: 'w-1/4', debil: 'w-2/4', aceptable: 'w-3/4', buena: 'w-full' })[strength.value]);

const canSubmit = computed(
  () =>
    !busy.value &&
    next.value.length > 0 &&
    repeat.value.length > 0 &&
    (props.forced || current.value.length > 0) &&
    liveProblems.value.length === 0,
);

async function submit() {
  touched.value = true;
  if (!canSubmit.value) return;
  busy.value = true;
  serverError.value = '';
  const result = await api<{ problems?: PasswordProblem[] }>('/api/me/password', {
    body: { current: props.forced ? undefined : current.value, next: next.value, repeat: repeat.value },
  });
  busy.value = false;
  if (result.ok) {
    done.value = true;
    current.value = next.value = repeat.value = '';
    emit('saved');
    if (props.forced && result.data.redirect) go(result.data.redirect);
    return;
  }
  const problems = result.data.problems;
  serverError.value = problems?.length
    ? problems.map((p) => problemTexts.value[p]).join(' ')
    : (result.data.message ?? t.comun.errorGenerico);
}
</script>

<template>
  <form class="space-y-5" novalidate @submit.prevent="submit">
    <p v-if="forced" class="alert-info">{{ t.clave.introObligatorio }}</p>

    <div v-if="!forced">
      <label class="label" for="pw-current">{{ t.clave.actual }}</label>
      <input id="pw-current" v-model="current" class="input" type="password" autocomplete="current-password" />
    </div>

    <div>
      <label class="label" for="pw-next">{{ t.clave.nueva }}</label>
      <input
        id="pw-next"
        v-model="next"
        class="input"
        type="password"
        autocomplete="new-password"
        aria-describedby="pw-rules pw-strength"
      />
      <p id="pw-rules" class="hint mt-1">{{ t.clave.reglas(minLength) }}</p>
      <div v-if="next.length > 0" id="pw-strength" class="mt-2" aria-live="polite">
        <div class="h-2 w-full rounded-full bg-crema-200">
          <div class="h-2 rounded-full transition-all" :class="[strengthColor, strengthWidth]"></div>
        </div>
        <p class="hint mt-1">{{ t.clave.fortalezaEtiqueta }}: {{ t.clave.fortaleza[strength] }}</p>
      </div>
    </div>

    <div>
      <label class="label" for="pw-repeat">{{ t.clave.repetir }}</label>
      <input id="pw-repeat" v-model="repeat" class="input" type="password" autocomplete="new-password" />
    </div>

    <ul v-if="liveProblems.length > 0" class="alert-error list-disc space-y-1 pl-8" role="alert">
      <li v-for="problem in liveProblems" :key="problem">{{ problemTexts[problem] }}</li>
    </ul>
    <p v-if="serverError" class="alert-error" role="alert">{{ serverError }}</p>
    <p v-if="done && !forced" class="alert-ok" role="status">{{ t.clave.guardada }}</p>

    <button type="submit" class="btn-primary w-full sm:w-auto" :disabled="!canSubmit">
      {{ busy ? t.clave.guardando : t.clave.guardar }}
    </button>
  </form>
</template>
