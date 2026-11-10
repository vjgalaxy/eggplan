<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { config } from '../data/config.ts';
import { t } from '../i18n/es.ts';
import type { ChatMessageView, ChatPage } from '../lib/chat/chat.ts';
import { api } from './api.ts';
import AvatarImg from './AvatarImg.vue';
import { startVisiblePolling } from './poller.ts';

/**
 * La Plaza: chat clásico (estilo IRC/BBS) con polling solo con la pestaña visible.
 * La caja ocupa el alto visible de la pantalla (variable `--vvh`, que se actualiza cuando aparece
 * el teclado del móvil), así que el campo de escribir queda siempre por encima del teclado.
 * Con `admin`, lo que se escribe se publica como anuncio y se puede borrar cualquier mensaje.
 */
const props = defineProps<{ myId: number; admin?: boolean }>();

const messages = ref<ChatMessageView[]>([]);
const hasMore = ref(false);
const loading = ref(true);
const loadingOlder = ref(false);
const error = ref('');
const text = ref('');
const busy = ref(false);
const unseen = ref(false);
const listEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);
let serverNow = '';

const lastId = computed(() => messages.value.at(-1)?.id ?? 0);
const length = computed(() => [...text.value].length);

// Colores de nick con contraste AA sobre blanco.
const NICK_COLORS = ['#5b2a86', '#2f6b3a', '#a11d33', '#1d4e89', '#8a4b08', '#6b2f5f', '#0f6466', '#5a5a00'];
const nickColor = (userId: number) => NICK_COLORS[userId % NICK_COLORS.length];

const time = (iso: string) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
function dayLabel(iso: string): string {
  const day = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(day, today)) return t.plaza.hoy;
  if (same(day, yesterday)) return t.plaza.ayer;
  return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(day);
}
const showDay = (index: number) => {
  const current = messages.value[index];
  const previous = messages.value[index - 1];
  return current !== undefined && (previous === undefined || new Date(previous.createdAt).toDateString() !== new Date(current.createdAt).toDateString());
};

function nearBottom(): boolean {
  const el = listEl.value;
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}
async function scrollToBottom() {
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
  unseen.value = false;
}

function merge(incoming: ChatMessageView[]) {
  const known = new Set(messages.value.map((m) => m.id));
  const fresh = incoming.filter((m) => !known.has(m.id));
  if (fresh.length > 0) messages.value = [...messages.value, ...fresh];
  return fresh.length;
}

function applyDeleted(ids: number[]) {
  if (ids.length === 0) return;
  const gone = new Set(ids);
  messages.value = messages.value.map((m) => (gone.has(m.id) && !m.deleted ? { ...m, deleted: true, cuerpo: null } : m));
}

async function load() {
  const result = await api<ChatPage>('/api/chat');
  loading.value = false;
  if (!result.ok) {
    error.value = result.data.message ?? t.comun.errorGenerico;
    return;
  }
  messages.value = result.data.messages;
  hasMore.value = result.data.hasMore;
  serverNow = result.data.now;
  await scrollToBottom();
}

let polling = false;
async function poll() {
  if (polling || loading.value) return;
  polling = true;
  const params = new URLSearchParams({ since: String(lastId.value) });
  if (serverNow) params.set('deletedSince', serverNow);
  const result = await api<ChatPage>(`/api/chat?${params}`);
  polling = false;
  if (!result.ok) return;
  const stick = nearBottom();
  const added = merge(result.data.messages);
  applyDeleted(result.data.deletedIds);
  serverNow = result.data.now;
  if (added > 0) {
    if (stick) await scrollToBottom();
    else unseen.value = true;
  }
}

async function loadOlder() {
  const first = messages.value[0];
  if (!first || loadingOlder.value) return;
  loadingOlder.value = true;
  const result = await api<ChatPage>(`/api/chat?before=${first.id}`);
  loadingOlder.value = false;
  if (!result.ok) return;
  const el = listEl.value;
  const previousHeight = el?.scrollHeight ?? 0;
  messages.value = [...result.data.messages, ...messages.value];
  hasMore.value = result.data.hasMore;
  await nextTick();
  // Mantener a la vista el mismo mensaje que se estaba leyendo.
  if (el) el.scrollTop += el.scrollHeight - previousHeight;
}

async function send() {
  const cuerpo = text.value.trim();
  if (!cuerpo || busy.value) return;
  busy.value = true;
  error.value = '';
  const result = await api<{ message: ChatMessageView }>('/api/chat', { body: { cuerpo } });
  busy.value = false;
  if (!result.ok) {
    error.value = result.data.message ?? t.comun.errorGenerico;
    return;
  }
  text.value = '';
  merge([result.data.message]);
  await scrollToBottom();
  void poll(); // refresca en el acto lo que hayan escrito otras personas
  inputEl.value?.focus();
}

function onKeydown(event: KeyboardEvent) {
  // Intro envía; Mayúsculas + Intro cambia de línea. Nunca a mitad de una composición (acentos, IME).
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void send();
  }
}

async function remove(message: ChatMessageView) {
  if (!window.confirm(t.plaza.borrarConfirmar)) return;
  error.value = '';
  const result = await api(`/api/chat/${message.id}`, { body: { action: 'delete' } });
  if (!result.ok) {
    error.value = result.data.message ?? t.comun.errorGenerico;
    return;
  }
  messages.value = messages.value.map((m) =>
    m.id === message.id ? { ...m, deleted: true, cuerpo: null, deletedByAdmin: Boolean(props.admin) && m.userId !== props.myId } : m,
  );
}

const canDelete = (m: ChatMessageView) => !m.deleted && (props.admin === true || m.userId === props.myId);

let stopPolling: (() => void) | undefined;
onMounted(async () => {
  await load();
  stopPolling = startVisiblePolling(() => void poll(), config.chat.pollingMs);
});
onBeforeUnmount(() => stopPolling?.());
</script>

<template>
  <section class="plaza flex flex-col gap-3" :aria-label="t.plaza.titulo">
    <p v-if="error" class="alert-error" role="alert">{{ error }}</p>

    <div class="relative min-h-0 flex-1">
      <div
        ref="listEl"
        class="h-full overflow-y-auto rounded-2xl border border-berenjena-100 bg-white px-3 py-2 font-mono text-base"
        role="log"
        aria-live="polite"
        :aria-label="t.plaza.titulo"
        tabindex="0"
        @scroll="nearBottom() && (unseen = false)"
      >
        <p v-if="loading" class="py-4 font-sans">{{ t.comun.cargando }}</p>
        <template v-else>
          <div v-if="hasMore" class="py-2 text-center font-sans">
            <button type="button" class="btn-ghost" :disabled="loadingOlder" @click="loadOlder">{{ t.plaza.cargarAnteriores }}</button>
          </div>
          <p v-if="messages.length === 0" class="py-6 text-center font-sans">{{ t.plaza.vacio }}</p>
          <ol class="space-y-1">
            <li v-for="(m, index) in messages" :key="m.id">
              <p v-if="showDay(index)" class="my-2 text-center font-sans text-base font-semibold text-tinta-600">— {{ dayLabel(m.createdAt) }} —</p>

              <!-- Anuncio de la administración: estilo diferenciado -->
              <div v-if="m.kind === 'anuncio'" class="my-1 rounded-xl border-2 border-hoja-700 bg-hoja-100 px-3 py-2">
                <p class="flex items-center justify-between gap-2 font-sans text-base font-bold text-hoja-700">
                  <span>{{ t.plaza.anuncio }} · {{ time(m.createdAt) }}</span>
                  <button v-if="canDelete(m)" type="button" class="min-h-11 rounded-lg px-2 font-semibold underline" :aria-label="t.plaza.borrarMensaje(m.nick)" @click="remove(m)">
                    {{ t.plaza.borrar }}
                  </button>
                </p>
                <p v-if="m.deleted" class="italic text-tinta-600">({{ m.deletedByAdmin ? t.plaza.borradoAdmin : t.plaza.borradoAutor }})</p>
                <p v-else class="whitespace-pre-wrap break-words text-berenjena-900">{{ m.cuerpo }}</p>
              </div>

              <!-- Línea clásica: [hora] avatar nick: texto -->
              <div v-else class="group flex items-start gap-2 leading-snug">
                <span class="shrink-0 pt-0.5 text-tinta-600">[{{ time(m.createdAt) }}]</span>
                <AvatarImg :avatar="m.avatar" :nick="m.nick" size="xs" class="mt-0.5 shrink-0" />
                <p class="min-w-0 flex-1 break-words">
                  <span class="font-bold" :style="{ color: nickColor(m.userId) }">{{ m.nick }}<span v-if="m.userId === myId" class="font-normal text-tinta-600"> ({{ t.plaza.tu }})</span>:</span>
                  <span v-if="m.deleted" class="italic text-tinta-600"> ({{ m.deletedByAdmin ? t.plaza.borradoAdmin : t.plaza.borradoAutor }})</span>
                  <span v-else class="whitespace-pre-wrap"> {{ m.cuerpo }}</span>
                </p>
                <button
                  v-if="canDelete(m)"
                  type="button"
                  class="min-h-11 shrink-0 rounded-lg px-2 font-sans text-base font-semibold text-tinta-600 underline hover:text-peligro-700"
                  :aria-label="t.plaza.borrarMensaje(m.nick)"
                  @click="remove(m)"
                >
                  {{ t.plaza.borrar }}
                </button>
              </div>
            </li>
          </ol>
        </template>
      </div>
      <button v-if="unseen" type="button" class="btn-primary absolute bottom-3 left-1/2 -translate-x-1/2 shadow-lg" @click="scrollToBottom">
        {{ t.plaza.nuevos }} ↓
      </button>
    </div>

    <!-- Campo de escribir: siempre visible, por encima del teclado -->
    <form class="shrink-0 space-y-1" @submit.prevent="send">
      <label class="sr-only" for="plaza-msg">{{ admin ? t.plaza.adminEscribir : t.plaza.escribir }}</label>
      <div class="flex items-end gap-2">
        <textarea
          id="plaza-msg"
          ref="inputEl"
          v-model="text"
          class="input min-h-12! flex-1 resize-none"
          rows="2"
          :maxlength="config.chat.maxCaracteres"
          :placeholder="admin ? t.plaza.adminEscribir : t.plaza.escribir"
          enterkeyhint="send"
          @keydown="onKeydown"
          @focus="scrollToBottom"
        ></textarea>
        <button type="submit" class="btn-primary shrink-0" :disabled="busy || text.trim() === ''">
          {{ busy ? t.plaza.enviando : admin ? t.plaza.adminEnviar : t.plaza.enviar }}
        </button>
      </div>
      <p class="hint flex flex-wrap justify-between gap-2 text-base">
        <span>{{ t.plaza.ayudaTeclado }}</span>
        <span :class="length > config.chat.maxCaracteres * 0.9 ? 'font-semibold text-peligro-700' : ''">{{ t.plaza.caracteres(length, config.chat.maxCaracteres) }}</span>
      </p>
    </form>
  </section>
</template>

<style scoped>
/* Alto = parte visible de la pantalla (se encoge con el teclado del móvil) menos la cabecera y la navegación. */
.plaza {
  height: calc(var(--vvh, 100dvh) - var(--plaza-offset, 10rem) - var(--nav-h, 0px));
  min-height: 18rem;
}
</style>
