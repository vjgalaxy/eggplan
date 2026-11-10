<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { config } from '../data/config.ts';
import { t } from '../i18n/es.ts';
import { api, go } from './api.ts';
import AvatarImg from './AvatarImg.vue';
import MyStockView from './MyStockView.vue';
import PasswordForm from './PasswordForm.vue';
import StocksView from './StocksView.vue';
import TradeComposer from './TradeComposer.vue';
import TradeDetail from './TradeDetail.vue';
import TruequesView from './TruequesView.vue';

/**
 * Área de miembros (/app): navegación (5 elementos + menú del avatar), bienvenida, Ajustes,
 * Stocks (con «Se busca») y Mi stock. Trueques y Plaza llegan en las fases siguientes.
 */
const props = defineProps<{
  userId: number;
  nick: string;
  avatar: string | null;
  avatars: string[];
  pathname: string;
  /** Cadena de consulta de la URL (p. ej. «?con=3&articulo=12»), para abrir una propuesta ya empezada. */
  search: string;
  minPasswordLength: number;
}>();

const currentAvatar = ref(props.avatar);
const menuOpen = ref(false);
const avatarMessage = ref('');
const avatarError = ref('');

const items = [
  { key: 'inicio', href: '/app', label: t.nav.inicio },
  { key: 'stocks', href: '/app/stocks', label: t.nav.stocks },
  { key: 'mi-stock', href: '/app/mi-stock', label: t.nav.miStock },
  { key: 'trueques', href: '/app/trueques', label: t.nav.trueques },
  { key: 'plaza', href: '/app/plaza', label: t.nav.plaza },
] as const;

const path = computed(() => props.pathname.replace(/\/+$/, ''));
const query = computed(() => new URLSearchParams(props.search));
const numberParam = (name: string): number | undefined => {
  const n = Number(query.value.get(name));
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
const tradeId = computed(() => {
  const match = /^\/app\/trueques\/(\d+)$/.exec(path.value);
  return match ? Number(match[1]) : undefined;
});

const view = computed(() => {
  if (path.value === '/app/ajustes') return 'ajustes';
  if (path.value === '/app/trueques/nuevo') return 'trueque-nuevo';
  if (tradeId.value !== undefined) return 'trueque-detalle';
  return items.find((i) => i.href === path.value)?.key ?? 'inicio';
});

/** Elemento de la navegación inferior que se marca como actual. */
const activeNav = computed(() => (view.value === 'trueque-nuevo' || view.value === 'trueque-detalle' ? 'trueques' : view.value));

const title = computed(() => {
  if (view.value === 'ajustes') return t.ajustes.titulo;
  if (view.value === 'trueque-nuevo') return numberParam('contra') === undefined ? t.trueques.nuevaTitulo : t.trueques.contraTitulo;
  if (view.value === 'trueque-detalle') return t.trueques.titulo;
  return items.find((i) => i.key === view.value)?.label ?? t.nav.inicio;
});

// Contador de avisos sin leer: consulta ligera cada ~30 s, solo con la pestaña visible.
const unread = ref(0);
async function refreshUnread() {
  if (document.visibilityState !== 'visible') return;
  const result = await api<{ unread: number }>('/api/me/avisos?count=1');
  if (result.ok) unread.value = result.data.unread;
}
let unreadTimer: ReturnType<typeof setInterval> | undefined;

function avatarName(file: string): string {
  return file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
}

async function pickAvatar(file: string) {
  avatarMessage.value = '';
  avatarError.value = '';
  const previous = currentAvatar.value;
  currentAvatar.value = file; // cambio al instante
  const result = await api('/api/me/avatar', { body: { avatar: file } });
  if (result.ok) avatarMessage.value = t.ajustes.avatarCambiado;
  else {
    currentAvatar.value = previous;
    avatarError.value = result.data.message ?? t.ajustes.avatarError;
  }
}

async function logout() {
  const result = await api('/api/auth/logout', { body: {} });
  go(result.data.redirect ?? '/');
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') menuOpen.value = false;
}
onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('visibilitychange', refreshUnread);
  void refreshUnread();
  unreadTimer = setInterval(refreshUnread, config.avisos.pollingMs);
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('visibilitychange', refreshUnread);
  clearInterval(unreadTimer);
});
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="sticky top-0 z-20 border-b border-berenjena-100 bg-white">
      <div class="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-2">
        <a href="/app" class="text-xl font-extrabold text-berenjena-700">{{ t.app.nombre }}</a>
        <div class="relative">
          <button
            type="button"
            class="flex min-h-12 items-center gap-2 rounded-xl px-2 hover:bg-berenjena-50"
            :aria-expanded="menuOpen"
            aria-haspopup="menu"
            :aria-label="t.nav.menuUsuario"
            @click="menuOpen = !menuOpen"
          >
            <AvatarImg :avatar="currentAvatar" :nick="nick" size="sm" />
            <span class="font-semibold">{{ nick }}</span>
          </button>
          <div
            v-if="menuOpen"
            role="menu"
            class="absolute right-0 mt-2 w-48 rounded-xl border border-berenjena-100 bg-white p-1 shadow-lg"
          >
            <a role="menuitem" href="/app/ajustes" class="flex min-h-12 items-center rounded-lg px-3 font-semibold hover:bg-berenjena-50">
              {{ t.nav.ajustes }}
            </a>
            <button role="menuitem" type="button" class="flex min-h-12 w-full items-center rounded-lg px-3 text-left font-semibold hover:bg-berenjena-50" @click="logout">
              {{ t.nav.salir }}
            </button>
          </div>
        </div>
      </div>
    </header>

    <main class="mx-auto w-full max-w-4xl flex-1 px-4 pb-28 pt-6">
      <h1 class="mb-5">{{ title }}</h1>

      <!-- Inicio: bienvenida y explicación de la unidad de cuenta -->
      <section v-if="view === 'inicio'" class="space-y-5">
        <div class="card">
          <h2 class="mb-2">{{ t.inicio.bienvenida(nick) }}</h2>
          <p>{{ t.inicio.queEs }}</p>
        </div>
        <div class="card border-berenjena-200 bg-berenjena-50">
          <h2 class="mb-2">{{ t.inicio.berenjenaTitulo }}</h2>
          <p>{{ t.inicio.berenjenaTexto }}</p>
          <p class="hint mt-2">{{ t.inicio.ejemplo }}</p>
        </div>
        <div class="card">
          <h2 class="mb-2">{{ t.inicio.proximosPasos }}</h2>
          <ul class="list-disc space-y-1 pl-6">
            <li v-for="paso in t.inicio.pasos" :key="paso">{{ paso }}</li>
          </ul>
        </div>
      </section>

      <!-- Ajustes -->
      <section v-else-if="view === 'ajustes'" class="space-y-6">
        <div class="card">
          <h2 class="mb-1">{{ t.ajustes.avatarTitulo }}</h2>
          <p class="hint mb-4">{{ t.ajustes.avatarAyuda }}</p>
          <ul class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
            <li v-for="file in avatars" :key="file">
              <button
                type="button"
                class="flex min-h-12 w-full items-center justify-center rounded-2xl border-2 p-1"
                :class="file === currentAvatar ? 'border-berenjena-700 bg-berenjena-100' : 'border-transparent hover:border-berenjena-200'"
                :aria-pressed="file === currentAvatar"
                :aria-label="t.ajustes.avatarOpcion(avatarName(file))"
                @click="pickAvatar(file)"
              >
                <AvatarImg :avatar="file" :nick="avatarName(file)" size="lg" />
              </button>
            </li>
          </ul>
          <p v-if="avatarMessage" class="alert-ok mt-4" role="status">{{ avatarMessage }}</p>
          <p v-if="avatarError" class="alert-error mt-4" role="alert">{{ avatarError }}</p>
        </div>

        <div class="card">
          <h2 class="mb-4">{{ t.clave.tituloVoluntario }}</h2>
          <PasswordForm :nick="nick" :forced="false" :min-length="minPasswordLength" />
        </div>
      </section>

      <StocksView v-else-if="view === 'stocks'" :my-id="userId" />
      <MyStockView v-else-if="view === 'mi-stock'" :nick="nick" :avatar="currentAvatar" />
      <TruequesView v-else-if="view === 'trueques'" @unread="unread = $event" />
      <TradeComposer
        v-else-if="view === 'trueque-nuevo'"
        :my-id="userId"
        :pre-family="numberParam('con')"
        :pre-item="numberParam('articulo')"
        :counter-of="numberParam('contra')"
      />
      <TradeDetail v-else-if="view === 'trueque-detalle' && tradeId !== undefined" :trade-id="tradeId" />

      <!-- Secciones de fases posteriores -->
      <section v-else class="card text-center">
        <p class="text-lg">{{ t.comun.proximamente }}</p>
        <a href="/app" class="btn-primary mt-4">{{ t.errores.irInicio }}</a>
      </section>
    </main>

    <!-- Navegación inferior: 5 elementos con palabras, nunca solo iconos -->
    <nav class="fixed inset-x-0 bottom-0 z-20 border-t border-berenjena-100 bg-white" :aria-label="t.nav.principal">
      <ul class="mx-auto grid max-w-4xl grid-cols-5">
        <li v-for="item in items" :key="item.key">
          <a
            :href="item.href"
            class="flex min-h-14 items-center justify-center px-1 py-2 text-center text-sm font-bold leading-tight"
            :class="activeNav === item.key ? 'bg-berenjena-100 text-berenjena-800' : 'text-tinta-600 hover:bg-berenjena-50'"
            :aria-current="activeNav === item.key ? 'page' : undefined"
          >
            {{ item.label }}
            <span
              v-if="item.key === 'trueques' && unread > 0"
              class="ml-1 inline-flex min-w-6 items-center justify-center rounded-full bg-peligro-700 px-1.5 text-sm font-bold text-white"
              :aria-label="t.avisos.sinLeer(unread)"
            >
              {{ unread }}
            </span>
          </a>
        </li>
      </ul>
    </nav>
  </div>
</template>
