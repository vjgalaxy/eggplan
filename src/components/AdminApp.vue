<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '../i18n/es.ts';
import { api, go } from './api.ts';
import AvatarImg from './AvatarImg.vue';
import CodeCards, { type IssuedCode } from './CodeCards.vue';

/**
 * Panel de administración (Fase 0): plazas, códigos iniciales (tarjetas imprimibles) y bloqueo.
 * El administrador NO ve claves, hashes, sesiones, mensajes de propuestas ni avisos personales.
 */
interface Seat {
  id: number;
  seat: number;
  nick: string;
  avatar: string | null;
  status: 'sin_activar' | 'activo' | 'bloqueado';
  hasCredential: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

const seats = ref<Seat[]>([]);
const loading = ref(true);
const error = ref('');
const notice = ref('');
const busy = ref(false);

const codes = ref<IssuedCode[]>([]);
const address = ref('');

const renaming = ref<Seat | null>(null);
const newNick = ref('');

const pending = computed(() => seats.value.filter((s) => !s.hasCredential && s.status !== 'bloqueado').length);

function lastLogin(seat: Seat): string {
  if (!seat.lastLoginAt) return t.admin.nunca;
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(seat.lastLoginAt));
}

function seatState(seat: Seat): string {
  if (seat.status === 'sin_activar') return seat.hasCredential ? t.admin.pendienteClave : t.admin.sinCodigo;
  return t.admin.estado[seat.status];
}

async function load() {
  const result = await api<{ seats: Seat[] }>('/api/admin/seats');
  loading.value = false;
  if (result.ok) seats.value = result.data.seats;
  else error.value = result.data.message ?? t.comun.errorGenerico;
}

async function issue(body: { seatId: number } | { onlyMissing: true }) {
  busy.value = true;
  error.value = notice.value = '';
  const result = await api<{ codes: IssuedCode[] }>('/api/admin/codes', { body });
  busy.value = false;
  if (!result.ok) {
    error.value = result.data.message ?? t.comun.errorGenerico;
    return;
  }
  address.value = window.location.origin;
  codes.value = result.data.codes;
  await load();
}

function regenerate(seat: Seat) {
  if (window.confirm(t.admin.regenerarConfirmar(seat.nick))) void issue({ seatId: seat.id });
}

function printCards() {
  window.print();
}

function closeCodes() {
  if (window.confirm(t.admin.cerrarCodigosConfirmar)) codes.value = [];
}

async function toggleBlock(seat: Seat) {
  const block = seat.status !== 'bloqueado';
  if (block && !window.confirm(t.admin.bloquearConfirmar(seat.nick))) return;
  error.value = notice.value = '';
  const result = await api(`/api/admin/seats/${seat.id}`, { body: { action: block ? 'block' : 'unblock' } });
  if (!result.ok) error.value = result.data.message ?? t.comun.errorGenerico;
  await load();
}

function startRename(seat: Seat) {
  renaming.value = seat;
  newNick.value = seat.nick;
  error.value = notice.value = '';
}

async function saveRename() {
  if (!renaming.value) return;
  const result = await api(`/api/admin/seats/${renaming.value.id}`, { body: { action: 'rename', nick: newNick.value } });
  if (!result.ok) {
    error.value = result.data.message ?? t.comun.errorGenerico;
    return;
  }
  notice.value = `Nick cambiado a ${newNick.value}.`;
  renaming.value = null;
  await load();
}

async function logout() {
  const result = await api('/api/auth/logout', { body: {} });
  go(result.data.redirect ?? '/admin/login');
}

onMounted(load);
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-6">
    <header class="mb-6 flex items-center justify-between gap-3 print:hidden">
      <div>
        <p class="text-xl font-extrabold text-berenjena-700">{{ t.app.nombre }}</p>
        <p class="hint">{{ t.admin.loginTitulo }}</p>
      </div>
      <button type="button" class="btn-secondary" @click="logout">{{ t.nav.salir }}</button>
    </header>

    <!-- Códigos recién generados: se muestran una sola vez -->
    <section v-if="codes.length > 0" aria-labelledby="codes-title">
      <div class="print:hidden">
        <h1 id="codes-title" class="mb-2">{{ t.admin.codigosTitulo }}</h1>
        <p class="alert-info mb-4">{{ t.admin.codigosAviso }}</p>
        <div class="mb-6 flex flex-wrap gap-3">
          <button type="button" class="btn-primary" @click="printCards">{{ t.admin.imprimir }}</button>
          <button type="button" class="btn-secondary" @click="closeCodes">{{ t.admin.cerrarCodigos }}</button>
        </div>
      </div>
      <CodeCards :codes="codes" :address="address" />
    </section>

    <section v-else class="print:hidden" aria-labelledby="seats-title">
      <h1 id="seats-title" class="mb-1">{{ t.admin.plazas }}</h1>
      <p class="hint mb-5">{{ t.admin.plazasAyuda }}</p>

      <div class="card mb-6">
        <button type="button" class="btn-primary w-full sm:w-auto" :disabled="busy || pending === 0" @click="issue({ onlyMissing: true })">
          {{ t.admin.generarCodigos }} ({{ pending }})
        </button>
        <p class="hint mt-2">{{ pending === 0 ? t.admin.nadaPendiente : t.admin.generarCodigosAyuda }}</p>
      </div>

      <p v-if="error" class="alert-error mb-4" role="alert">{{ error }}</p>
      <p v-if="notice" class="alert-ok mb-4" role="status">{{ notice }}</p>

      <form v-if="renaming" class="card mb-6" @submit.prevent="saveRename">
        <label class="label" for="new-nick">{{ t.admin.nuevoNick }}</label>
        <input id="new-nick" v-model="newNick" class="input" type="text" autocomplete="off" />
        <div class="mt-4 flex gap-3">
          <button type="submit" class="btn-primary">{{ t.comun.guardar }}</button>
          <button type="button" class="btn-secondary" @click="renaming = null">{{ t.comun.cancelar }}</button>
        </div>
      </form>

      <p v-if="loading">{{ t.comun.cargando }}</p>
      <ul v-else class="space-y-3">
        <li v-for="seat in seats" :key="seat.id" class="card flex flex-col gap-3 sm:flex-row sm:items-center">
          <div class="flex flex-1 items-center gap-3">
            <AvatarImg :avatar="seat.avatar" :nick="seat.nick" size="md" />
            <div>
              <p class="text-lg font-bold">{{ seat.nick }}</p>
              <p class="hint">{{ seatState(seat) }} · {{ t.admin.ultimoAcceso }}: {{ lastLogin(seat) }}</p>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-secondary" :disabled="busy" @click="regenerate(seat)">{{ t.admin.regenerar }}</button>
            <button type="button" class="btn-secondary" @click="startRename(seat)">{{ t.admin.renombrar }}</button>
            <button type="button" :class="seat.status === 'bloqueado' ? 'btn-secondary' : 'btn-danger'" @click="toggleBlock(seat)">
              {{ seat.status === 'bloqueado' ? t.admin.desbloquear : t.admin.bloquear }}
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
