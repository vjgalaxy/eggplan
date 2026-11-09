<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '../i18n/es.ts';
import { api, go } from './api.ts';
import AvatarImg from './AvatarImg.vue';
import PasswordForm from './PasswordForm.vue';

/**
 * Área de miembros (/app). Fase 0: esqueleto de navegación (5 elementos + menú del avatar),
 * pantalla de bienvenida y Ajustes (avatar y clave). Stocks, Mi stock, Trueques y Plaza llegan
 * en las fases siguientes.
 */
const props = defineProps<{
  nick: string;
  avatar: string | null;
  avatars: string[];
  pathname: string;
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

const view = computed(() => {
  const path = props.pathname.replace(/\/+$/, '');
  if (path === '/app/ajustes') return 'ajustes';
  return items.find((i) => i.href === path)?.key ?? 'inicio';
});

const title = computed(() =>
  view.value === 'ajustes' ? t.ajustes.titulo : (items.find((i) => i.key === view.value)?.label ?? t.nav.inicio),
);

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
onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
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
            :class="view === item.key ? 'bg-berenjena-100 text-berenjena-800' : 'text-tinta-600 hover:bg-berenjena-50'"
            :aria-current="view === item.key ? 'page' : undefined"
          >
            {{ item.label }}
          </a>
        </li>
      </ul>
    </nav>
  </div>
</template>
