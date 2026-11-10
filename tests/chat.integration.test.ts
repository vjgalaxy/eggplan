import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db/index.ts';
import { makeTestDb } from './helpers/test-db.ts';
import { config } from '../src/data/config.ts';
import { deleteChatMessage, listMessages, postChatMessage, purgeOldMessages } from '../src/lib/chat/chat.ts';
import { startVisiblePolling, type PollerEnv } from '../src/components/poller.ts';

let db: Db;
let admin: { id: number; role: 'admin' };
let ana: { id: number; role: 'member' };
let beto: { id: number; role: 'member' };

async function user(seat: number | null, nick: string, role: 'member' | 'admin'): Promise<number> {
  const { rows } = await db.query<{ id: number }>(`INSERT INTO users (seat, nick, role, status) VALUES ($1, $2, $3, 'activo') RETURNING id`, [seat, nick, role]);
  return rows[0]?.id as number;
}

/** Envejece todos los mensajes para que no salte el límite de frecuencia entre envíos de un test. */
const age = (seconds = 120) => db.query(`UPDATE chat_messages SET created_at = created_at - ($1::int * interval '1 second')`, [seconds]);

async function say(who: { id: number; role: 'member' | 'admin' }, text: string): Promise<number> {
  const result = await postChatMessage(db, who, text);
  if (!result.ok) throw new Error(`no se pudo enviar: ${result.code}`);
  await age(3);
  return result.value.message.id;
}

beforeEach(async () => {
  db = await makeTestDb();
  admin = { id: await user(null, 'admin', 'admin'), role: 'admin' };
  ana = { id: await user(1, 'Peliqueiro', 'member'), role: 'member' };
  beto = { id: await user(2, 'Cigarrón', 'member'), role: 'member' };
});

describe('enviar y leer', () => {
  it('publica y devuelve los mensajes en orden, con nick y avatar', async () => {
    await say(ana, 'Bos días!');
    await say(beto, '¿Alguien tiene leña?');
    const page = await listMessages(db);
    expect(page.messages.map((m) => [m.nick, m.cuerpo, m.kind])).toEqual([
      ['Peliqueiro', 'Bos días!', 'mensaje'],
      ['Cigarrón', '¿Alguien tiene leña?', 'mensaje'],
    ]);
    expect(page.hasMore).toBe(false);
  });

  it('los textos se guardan tal cual: se escapan al mostrarlos, nunca se interpretan como HTML', async () => {
    await say(ana, '<img src=x onerror=alert(1)> & <b>hola</b>');
    expect((await listMessages(db)).messages[0]?.cuerpo).toBe('<img src=x onerror=alert(1)> & <b>hola</b>');
  });

  it('valida longitud: vacío no, más de 500 caracteres no (contando letras, no bytes)', async () => {
    expect(await postChatMessage(db, ana, '   ')).toEqual({ ok: false, code: 'empty' });
    expect(await postChatMessage(db, ana, 'x'.repeat(config.chat.maxCaracteres + 1))).toEqual({ ok: false, code: 'too_long' });
    expect((await postChatMessage(db, ana, 'ñ'.repeat(config.chat.maxCaracteres))).ok).toBe(true);
  });

  it('el sondeo con `since` devuelve solo lo nuevo', async () => {
    const first = await say(ana, 'uno');
    await say(beto, 'dos');
    await say(ana, 'tres');
    const page = await listMessages(db, { since: first });
    expect(page.messages.map((m) => m.cuerpo)).toEqual(['dos', 'tres']);
    expect((await listMessages(db, { since: page.messages[1]?.id })).messages).toEqual([]);
  });

  it('muestra los últimos N y permite «cargar anteriores»', async () => {
    for (let i = 0; i < 7; i += 1) await say(i % 2 ? ana : beto, `m${i}`);
    const last = await listMessages(db, { limit: 3 });
    expect(last.messages.map((m) => m.cuerpo)).toEqual(['m4', 'm5', 'm6']);
    expect(last.hasMore).toBe(true);
    const older = await listMessages(db, { before: last.messages[0]?.id, limit: 3 });
    expect(older.messages.map((m) => m.cuerpo)).toEqual(['m1', 'm2', 'm3']);
    expect(older.hasMore).toBe(true);
    const oldest = await listMessages(db, { before: older.messages[0]?.id, limit: 3 });
    expect(oldest.messages.map((m) => m.cuerpo)).toEqual(['m0']);
    expect(oldest.hasMore).toBe(false);
  });

  it('los mensajes de la administración son anuncios y quedan auditados', async () => {
    await say(admin, 'El sábado hay mercado en la plaza del pueblo.');
    const [message] = (await listMessages(db)).messages;
    expect(message).toMatchObject({ kind: 'anuncio', nick: 'admin' });
    const { rows } = await db.query<{ accion: string }>('SELECT accion FROM admin_audit');
    expect(rows.map((r) => r.accion)).toEqual(['plaza_anuncio_publicado']);
  });

  it('una plaza bloqueada no puede escribir', async () => {
    await db.query(`UPDATE users SET status = 'bloqueado' WHERE id = $1`, [ana.id]);
    expect(await postChatMessage(db, ana, 'hola')).toEqual({ ok: false, code: 'blocked' });
  });
});

describe('límites de frecuencia', () => {
  it('como mucho un mensaje cada 2 segundos', async () => {
    expect((await postChatMessage(db, ana, 'uno')).ok).toBe(true);
    expect(await postChatMessage(db, ana, 'dos')).toMatchObject({ ok: false, code: 'too_fast' });
    // Otra persona no se ve afectada.
    expect((await postChatMessage(db, beto, 'hola')).ok).toBe(true);
    await age(3);
    expect((await postChatMessage(db, ana, 'dos')).ok).toBe(true);
  });

  it('como mucho 20 por minuto', async () => {
    for (let i = 0; i < config.chat.maxPorMinuto; i += 1) {
      await db.query(`INSERT INTO chat_messages (user_id, cuerpo, created_at) VALUES ($1, $2, now() - interval '30 seconds')`, [ana.id, `m${i}`]);
    }
    expect(await postChatMessage(db, ana, 'uno más')).toMatchObject({ ok: false, code: 'too_many' });
    await db.query(`UPDATE chat_messages SET created_at = now() - interval '61 seconds'`);
    expect((await postChatMessage(db, ana, 'ya puedo')).ok).toBe(true);
  });

  it('dos envíos simultáneos no se saltan el límite', async () => {
    const results = await Promise.all([postChatMessage(db, ana, 'a'), postChatMessage(db, ana, 'b')]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe('borrar y moderar', () => {
  it('cada persona borra los suyos, no los de otras; el texto desaparece', async () => {
    const id = await say(ana, 'me he equivocado');
    expect(await deleteChatMessage(db, beto, id)).toEqual({ ok: false, code: 'forbidden' });
    expect(await deleteChatMessage(db, ana, id)).toEqual({ ok: true });
    const [message] = (await listMessages(db)).messages;
    expect(message).toMatchObject({ id, deleted: true, deletedByAdmin: false, cuerpo: null });
    const { rows } = await db.query<{ cuerpo: string | null }>('SELECT cuerpo FROM chat_messages WHERE id = $1', [id]);
    expect(rows[0]?.cuerpo).toBeNull();
    expect(await deleteChatMessage(db, ana, id)).toEqual({ ok: false, code: 'not_found' });
  });

  it('la administración borra cualquier mensaje y queda auditado (sin el texto)', async () => {
    const id = await say(beto, 'mensaje inapropiado');
    expect(await deleteChatMessage(db, admin, id)).toEqual({ ok: true });
    expect((await listMessages(db)).messages[0]).toMatchObject({ deleted: true, deletedByAdmin: true });
    const { rows } = await db.query<{ accion: string; objetivo: string; payload: Record<string, unknown> }>('SELECT accion, objetivo, payload FROM admin_audit');
    expect(rows).toEqual([{ accion: 'plaza_mensaje_borrado', objetivo: 'Cigarrón', payload: { mensajeId: id } }]);
  });

  it('el sondeo informa de los borrados para quitarlos de la pantalla', async () => {
    const id = await say(ana, 'uno');
    const before = await listMessages(db);
    await deleteChatMessage(db, ana, id);
    const next = await listMessages(db, { since: id, deletedSince: before.now });
    expect(next.deletedIds).toEqual([id]);
  });
});

describe('retención', () => {
  it('borra lo anterior a 90 días, al publicar y al limpiar', async () => {
    await db.query(`INSERT INTO chat_messages (user_id, cuerpo, created_at) VALUES ($1, 'viejo', now() - interval '91 days')`, [ana.id]);
    await db.query(`INSERT INTO chat_messages (user_id, cuerpo, created_at) VALUES ($1, 'reciente', now() - interval '89 days')`, [ana.id]);
    // Aunque no se haya limpiado todavía, lo caducado ya no se muestra.
    expect((await listMessages(db)).messages.map((m) => m.cuerpo)).toEqual(['reciente']);
    await say(beto, 'nuevo'); // limpieza oportunista
    const { rows } = await db.query<{ cuerpo: string }>('SELECT cuerpo FROM chat_messages ORDER BY id');
    expect(rows.map((r) => r.cuerpo)).toEqual(['reciente', 'nuevo']);
    expect(await purgeOldMessages(db)).toBe(0);
  });
});

describe('sondeo solo con la pestaña visible', () => {
  function fakeEnv(visible: boolean) {
    const state = { visible, handlers: [] as (() => void)[], timers: new Set<number>(), next: 1 };
    const env: PollerEnv = {
      isVisible: () => state.visible,
      onVisibilityChange(handler) {
        state.handlers.push(handler);
        return () => (state.handlers = state.handlers.filter((h) => h !== handler));
      },
      setInterval() {
        const id = state.next++;
        state.timers.add(id);
        return id;
      },
      clearInterval(handle) {
        state.timers.delete(handle as number);
      },
    };
    const setVisible = (v: boolean) => {
      state.visible = v;
      state.handlers.forEach((h) => h());
    };
    return { env, state, setVisible };
  }

  it('se detiene al ocultar la pestaña y se reanuda (consultando en el acto) al volver', () => {
    const { env, state, setVisible } = fakeEnv(true);
    let runs = 0;
    const stop = startVisiblePolling(() => (runs += 1), 12_000, env);
    expect(state.timers.size).toBe(1);
    setVisible(false);
    expect(state.timers.size).toBe(0);
    setVisible(true);
    expect(runs).toBe(1);
    expect(state.timers.size).toBe(1);
    stop();
    expect(state.timers.size).toBe(0);
    expect(state.handlers).toHaveLength(0);
  });

  it('si la pestaña empieza oculta, no sondea hasta que se vea', () => {
    const { env, state, setVisible } = fakeEnv(false);
    startVisiblePolling(() => {}, 12_000, env);
    expect(state.timers.size).toBe(0);
    setVisible(true);
    expect(state.timers.size).toBe(1);
  });
});
