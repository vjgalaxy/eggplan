import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db/index.ts';
import { makeTestDb } from './helpers/test-db.ts';
import { ensureSeeded } from '../src/lib/auth/seed.ts';
import { changePassword, login, setAvatar } from '../src/lib/auth/service.ts';
import { resolveSession, revokeUserSessions, createSession } from '../src/lib/auth/sessions.ts';
import { issueInitialCodes, listSeats, renameSeat, setSeatBlocked } from '../src/lib/auth/admin.ts';
import { findUserByNick, listLoginCards } from '../src/lib/auth/users.ts';
import { nicks } from '../src/data/nicks.ts';
import { config } from '../src/data/config.ts';
import { hashToken } from '../src/lib/security/tokens.ts';

const SECRET = 'secreto-de-pruebas-1234567890';
const AVATARS = Array.from({ length: 20 }, (_, i) => `avatar-${i + 1}.webp`);
const ADMIN_PASSWORD = 'Clave Admin Inicial-1';

let db: Db;
let adminId: number;

const memberLogin = (nick: string, password: string, ip = '1.2.3.4') =>
  login(db, { nick, password, role: 'member', ip, secret: SECRET });

async function seatId(nick: string): Promise<number> {
  const user = await findUserByNick(db, nick, 'member');
  if (!user) throw new Error(`plaza ${nick} no existe`);
  return user.id;
}

/** Deja a una familia activa con su propia clave. */
async function activate(nick: string, password = 'mi huerta en agosto'): Promise<void> {
  const [issued] = await issueInitialCodes(db, adminId, { seatId: await seatId(nick) });
  const result = await memberLogin(nick, issued!.code);
  if (!result.ok) throw new Error('no se pudo entrar con el código');
  const changed = await changePassword(db, {
    userId: result.user.id,
    nick,
    role: 'member',
    mustChangePassword: true,
    currentTokenHash: hashToken(result.token),
    currentPassword: undefined,
    newPassword: password,
    repeatPassword: password,
  });
  expect(changed.ok).toBe(true);
}

beforeEach(async () => {
  db = await makeTestDb();
  await ensureSeeded(db, { nicks, avatars: AVATARS });
  adminId = (await findUserByNick(db, 'admin', 'admin'))!.id;
});

describe('plazas y administración iniciales', () => {
  it('crea las 20 plazas sin activar, con avatar, y es idempotente', async () => {
    const seats = await listSeats(db);
    expect(seats).toHaveLength(config.plazas);
    expect(seats.every((s) => s.status === 'sin_activar' && !s.hasCredential)).toBe(true);
    expect(new Set(seats.map((s) => s.avatar)).size).toBe(20);

    await ensureSeeded(db, { nicks, avatars: AVATARS });
    expect(await listSeats(db)).toHaveLength(config.plazas);
  });

  it('el admin existe sin clave en la base y entra con la variable de entorno, tal cual', async () => {
    const admin = await findUserByNick(db, 'admin', 'admin');
    expect(admin?.password_hash).toBeNull();
    expect(admin?.must_change_password).toBe(false);
    const adminLogin = (password: string, adminPassword: string | undefined = ADMIN_PASSWORD) =>
      login(db, { nick: 'admin', password, role: 'admin', ip: '9.9.9.9', secret: SECRET, adminPassword });
    const withoutEnv = (password: string) =>
      login(db, { nick: 'admin', password, role: 'admin', ip: '9.9.9.9', secret: SECRET, adminPassword: undefined });

    const result = await adminLogin(ADMIN_PASSWORD);
    expect(result.ok && !result.user.mustChangePassword).toBe(true);
    // Sin normalizar: mayúsculas y espacios cuentan.
    expect((await adminLogin(ADMIN_PASSWORD.toLowerCase())).ok).toBe(false);
    // Sin variable, o con una demasiado corta, nadie entra.
    expect((await adminLogin('', '')).ok).toBe(false);
    expect((await adminLogin('corta', 'corta')).ok).toBe(false);
    expect((await withoutEnv(ADMIN_PASSWORD)).ok).toBe(false);
  });

  it('limpia la clave guardada de un admin creado con el sistema anterior', async () => {
    await db.query(`UPDATE users SET password_hash = 'scrypt$x', must_change_password = true WHERE role = 'admin'`);
    await ensureSeeded(db, { nicks, avatars: AVATARS });
    const admin = await findUserByNick(db, 'admin', 'admin');
    expect(admin?.password_hash).toBeNull();
    expect(admin?.must_change_password).toBe(false);
  });

  it('un nick de familia no entra por el login del admin ni al revés', async () => {
    expect((await login(db, { nick: 'Meco', password: ADMIN_PASSWORD, role: 'admin', ip: '1.1.1.1', secret: SECRET, adminPassword: ADMIN_PASSWORD })).ok).toBe(false);
    expect((await memberLogin('admin', ADMIN_PASSWORD)).ok).toBe(false);
  });

  it('las tarjetas del login no exponen nada más que nick, avatar y si se puede entrar', async () => {
    const cards = await listLoginCards(db);
    expect(cards).toHaveLength(20);
    expect(Object.keys(cards[0]!).sort()).toEqual(['avatar', 'blocked', 'canLogin', 'nick']);
    expect(cards.every((c) => !c.canLogin)).toBe(true);
  });
});

describe('acceso con código inicial', () => {
  it('una plaza sin_activar (sin código) no puede entrar', async () => {
    const result = await memberLogin('Meco', 'cualquier-cosa-1234');
    expect(result).toEqual({ ok: false, code: 'not_activated' });
  });

  it('"Generar códigos iniciales" solo afecta a plazas sin código ni clave', async () => {
    await activate('Meco');
    const issued = await issueInitialCodes(db, adminId, { onlyMissing: true });
    expect(issued).toHaveLength(19);
    expect(issued.find((i) => i.nick === 'Meco')).toBeUndefined();
    for (const { code } of issued) expect(code).toMatch(/^[a-z]+-\d{4}$/);
    // La clave de Meco sigue valiendo.
    expect((await memberLogin('Meco', 'mi huerta en agosto')).ok).toBe(true);
  });

  it('en la base de datos solo queda el hash del código, nunca el código', async () => {
    const [issued] = await issueInitialCodes(db, adminId, { seatId: await seatId('Mula') });
    const { rows } = await db.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE nick = 'Mula'`);
    expect(rows[0]!.password_hash).not.toContain(issued!.code);
    expect(rows[0]!.password_hash.startsWith('scrypt$')).toBe(true);
  });

  it('con el código (aunque venga con mayúscula inicial) entra y debe elegir clave', async () => {
    const [issued] = await issueInitialCodes(db, adminId, { seatId: await seatId('Meco') });
    const typed = issued!.code[0]!.toUpperCase() + issued!.code.slice(1);
    const result = await memberLogin('Meco', typed);
    expect(result.ok && result.user.mustChangePassword).toBe(true);
  });

  it('claves débiles, el nick o el propio código inicial se rechazan al elegir clave', async () => {
    const [issued] = await issueInitialCodes(db, adminId, { seatId: await seatId('Meco') });
    const result = await memberLogin('Meco', issued!.code);
    if (!result.ok) throw new Error('login');
    const base = {
      userId: result.user.id, nick: 'Meco', role: 'member' as const, mustChangePassword: true,
      currentTokenHash: hashToken(result.token), currentPassword: undefined,
    };
    const weak = await changePassword(db, { ...base, newPassword: 'contraseña', repeatPassword: 'contraseña' });
    expect(weak).toMatchObject({ ok: false, code: 'problems' });
    const mismatch = await changePassword(db, { ...base, newPassword: 'una clave larga', repeatPassword: 'otra distinta' });
    expect(mismatch).toMatchObject({ ok: false, problems: ['no_coincide'] });
    const sameCode = await changePassword(db, { ...base, newPassword: issued!.code, repeatPassword: issued!.code });
    expect(sameCode).toMatchObject({ ok: false, problems: ['igual_actual'] });
    // Sigue pendiente de cambiar.
    expect((await findUserByNick(db, 'Meco', 'member'))?.must_change_password).toBe(true);
  });

  it('tras elegir clave: plaza activa, el código ya no vale y se crea un aviso', async () => {
    const [issued] = await issueInitialCodes(db, adminId, { seatId: await seatId('Meco') });
    await activate('Meco', 'mi huerta en agosto');
    const meco = await findUserByNick(db, 'Meco', 'member');
    expect(meco?.status).toBe('activo');
    expect(meco?.must_change_password).toBe(false);
    expect((await memberLogin('Meco', issued!.code)).ok).toBe(false);
    expect((await memberLogin('Meco', 'mi huerta en agosto')).ok).toBe(true);
    const { rows } = await db.query(`SELECT tipo FROM notifications WHERE user_id = $1`, [meco!.id]);
    expect(rows).toEqual([{ tipo: 'clave_cambiada' }]);
  });

  it('regenerar el código (olvido de clave) devuelve la plaza a sin_activar y cierra sesiones', async () => {
    await activate('Meco');
    const session = await memberLogin('Meco', 'mi huerta en agosto');
    if (!session.ok) throw new Error('login');
    await issueInitialCodes(db, adminId, { seatId: await seatId('Meco') });
    const meco = await findUserByNick(db, 'Meco', 'member');
    expect(meco?.status).toBe('sin_activar');
    expect(meco?.must_change_password).toBe(true);
    expect(await resolveSession(db, session.token)).toBeNull();
    expect((await memberLogin('Meco', 'mi huerta en agosto')).ok).toBe(false);
    // Como ya había elegido clave, queda un aviso de «clave restablecida» (y no por emitir un primer código).
    const { rows } = await db.query<{ tipo: string }>(`SELECT tipo FROM notifications WHERE user_id = $1 ORDER BY id`, [meco!.id]);
    expect(rows.map((r) => r.tipo)).toEqual(['clave_cambiada', 'clave_restablecida']);
  });
});

describe('cambio voluntario de clave', () => {
  it('exige la clave actual y cierra todas las demás sesiones', async () => {
    await activate('Meco', 'clave inicial buena');
    const a = await memberLogin('Meco', 'clave inicial buena');
    const b = await memberLogin('Meco', 'clave inicial buena');
    if (!a.ok || !b.ok) throw new Error('login');
    const input = {
      userId: a.user.id, nick: 'Meco', role: 'member' as const, mustChangePassword: false,
      currentTokenHash: hashToken(a.token), newPassword: 'otra clave todavía mejor', repeatPassword: 'otra clave todavía mejor',
    };
    expect(await changePassword(db, { ...input, currentPassword: 'mal' })).toEqual({ ok: false, code: 'wrong_current' });
    expect(await changePassword(db, { ...input, currentPassword: 'clave inicial buena' })).toEqual({ ok: true });
    expect(await resolveSession(db, a.token)).not.toBeNull(); // la actual se conserva
    expect(await resolveSession(db, b.token)).toBeNull(); // las demás se cierran
    expect((await memberLogin('Meco', 'otra clave todavía mejor')).ok).toBe(true);
  });
});

describe('bloqueo por intentos fallidos', () => {
  it('5 fallos bloquean 15 min; durante el bloqueo ni la clave correcta entra', async () => {
    await activate('Meco');
    for (let i = 0; i < 4; i++) {
      expect(await memberLogin('Meco', `mal-${i}`)).toMatchObject({ ok: false, code: 'invalid' });
    }
    const fifth = await memberLogin('Meco', 'mal-final');
    expect(fifth).toMatchObject({ ok: false, code: 'locked' });

    const correct = await memberLogin('Meco', 'mi huerta en agosto');
    expect(correct).toMatchObject({ ok: false, code: 'locked' });
    if (!correct.ok && correct.code === 'locked') {
      expect(correct.retryAfterSec).toBeGreaterThan(14 * 60);
      expect(correct.retryAfterSec).toBeLessThanOrEqual(15 * 60);
    }

    // Otra familia (y otra IP) no se ve afectada.
    await activate('Mula');
    expect((await memberLogin('Mula', 'mi huerta en agosto', '8.8.8.8')).ok).toBe(true);
  });

  it('pasados 15 min el bloqueo termina', async () => {
    await activate('Meco');
    for (let i = 0; i < 5; i++) await memberLogin('Meco', `mal-${i}`);
    await db.query(`UPDATE login_attempts SET at = now() - interval '16 minutes'`);
    expect((await memberLogin('Meco', 'mi huerta en agosto')).ok).toBe(true);
  });

  it('un acierto borra los fallos acumulados', async () => {
    await activate('Meco');
    for (let i = 0; i < 4; i++) await memberLogin('Meco', `mal-${i}`);
    expect((await memberLogin('Meco', 'mi huerta en agosto')).ok).toBe(true);
    for (let i = 0; i < 4; i++) expect(await memberLogin('Meco', `otra-${i}`)).toMatchObject({ code: 'invalid' });
  });

  it('el límite por IP bloquea a quien prueba muchos nicks desde la misma IP', async () => {
    for (let i = 0; i < config.acceso.maxFallosPorIp; i++) {
      await memberLogin(`Inventado${i}`, 'x', '7.7.7.7');
    }
    expect(await memberLogin('Meco', 'x', '7.7.7.7')).toMatchObject({ ok: false, code: 'locked' });
  });

  it('nick e IP se guardan solo como HMAC y las filas antiguas se purgan', async () => {
    await memberLogin('Meco', 'mal', '203.0.113.7');
    const { rows } = await db.query<{ key_hash: string }>('SELECT key_hash FROM login_attempts');
    for (const row of rows) {
      expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.key_hash).not.toContain('203');
    }
  });
});

describe('sesiones', () => {
  it('la sesión resuelve al usuario y caduca', async () => {
    await activate('Meco');
    const result = await memberLogin('Meco', 'mi huerta en agosto');
    if (!result.ok) throw new Error('login');
    expect((await resolveSession(db, result.token))?.user.nick).toBe('Meco');
    expect(await resolveSession(db, 'token-inventado')).toBeNull();
    await db.query(`UPDATE sessions SET expires_at = now() - interval '1 minute'`);
    expect(await resolveSession(db, result.token)).toBeNull();
  });

  it('en base de datos solo está el hash del token', async () => {
    await activate('Meco');
    const result = await memberLogin('Meco', 'mi huerta en agosto');
    if (!result.ok) throw new Error('login');
    const { rows } = await db.query<{ token_hash: string }>('SELECT token_hash FROM sessions');
    expect(rows.map((r) => r.token_hash)).toContain(hashToken(result.token));
    expect(rows.map((r) => r.token_hash)).not.toContain(result.token);
  });

  it('la caducidad es deslizante (se renueva al usarla pasado un rato)', async () => {
    await activate('Meco');
    const result = await memberLogin('Meco', 'mi huerta en agosto');
    if (!result.ok) throw new Error('login');
    await db.query(`UPDATE sessions SET last_seen_at = now() - interval '1 hour', expires_at = now() + interval '2 days'`);
    const resolved = await resolveSession(db, result.token);
    expect(resolved?.renewedUntil).not.toBeNull();
    const { rows } = await db.query<{ days: string }>(
      `SELECT round(extract(epoch FROM (expires_at - now())) / 86400)::text AS days FROM sessions WHERE token_hash = $1`,
      [hashToken(result.token)],
    );
    expect(Number(rows[0]!.days)).toBe(config.acceso.sesionDias);
  });

  it('bloquear una plaza cierra sus sesiones y le impide entrar; desbloquear la recupera', async () => {
    await activate('Meco');
    const result = await memberLogin('Meco', 'mi huerta en agosto');
    if (!result.ok) throw new Error('login');
    const id = await seatId('Meco');
    expect(await setSeatBlocked(db, adminId, id, true)).toEqual({ ok: true });
    expect(await resolveSession(db, result.token)).toBeNull();
    expect(await memberLogin('Meco', 'mi huerta en agosto')).toEqual({ ok: false, code: 'blocked' });
    expect(await setSeatBlocked(db, adminId, id, false)).toEqual({ ok: true });
    expect((await findUserByNick(db, 'Meco', 'member'))?.status).toBe('activo');
    expect((await memberLogin('Meco', 'mi huerta en agosto')).ok).toBe(true);
  });

  it('revocar todas las sesiones de un usuario', async () => {
    await activate('Meco');
    const { token } = await createSession(db, await seatId('Meco'));
    await revokeUserSessions(db, await seatId('Meco'));
    expect(await resolveSession(db, token)).toBeNull();
  });
});

describe('avatar', () => {
  it('solo acepta archivos de la lista', async () => {
    const id = await seatId('Meco');
    expect(await setAvatar(db, id, 'avatar-3.webp', AVATARS)).toEqual({ ok: true });
    expect((await findUserByNick(db, 'Meco', 'member'))?.avatar).toBe('avatar-3.webp');
    expect(await setAvatar(db, id, '../secreto.svg', AVATARS)).toEqual({ ok: false, code: 'invalid_avatar' });
    expect(await setAvatar(db, id, 'https://evil.example/a.svg', AVATARS)).toEqual({ ok: false, code: 'invalid_avatar' });
    expect((await findUserByNick(db, 'Meco', 'member'))?.avatar).toBe('avatar-3.webp');
  });
});

describe('administración: privacidad y auditoría', () => {
  it('la lista de plazas del admin no incluye claves ni hashes', async () => {
    await activate('Meco');
    const seats = await listSeats(db);
    const serialized = JSON.stringify(seats);
    expect(serialized).not.toContain('scrypt');
    expect(serialized).not.toMatch(/hash|token|secret/i);
    const keys = Object.keys(seats[0]!).sort();
    expect(keys).toEqual(['avatar', 'hasCredential', 'id', 'lastLoginAt', 'mustChangePassword', 'nick', 'seat', 'status']);
  });

  it('renombrar valida formato, reservado y unicidad, y queda auditado', async () => {
    const id = await seatId('Meco');
    expect(await renameSeat(db, adminId, id, 'Mázcara')).toEqual({ ok: true });
    expect(await renameSeat(db, adminId, id, 'dos palabras')).toEqual({ ok: false, code: 'nick_invalid' });
    expect(await renameSeat(db, adminId, id, 'admin')).toEqual({ ok: false, code: 'nick_reserved' });
    expect(await renameSeat(db, adminId, id, 'mula')).toEqual({ ok: false, code: 'nick_taken' });
    const { rows } = await db.query<{ accion: string }>('SELECT accion FROM admin_audit ORDER BY id');
    expect(rows.map((r) => r.accion)).toEqual(['plaza_renombrada']);
  });

  it('generar códigos queda auditado sin guardar el código', async () => {
    await issueInitialCodes(db, adminId, { seatId: await seatId('Meco') });
    const { rows } = await db.query<{ accion: string; payload: unknown }>('SELECT accion, payload FROM admin_audit');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.accion).toBe('codigo_inicial_generado');
    expect(JSON.stringify(rows[0]!.payload)).not.toMatch(/-\d{4}/);
  });
});
