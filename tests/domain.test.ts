import { describe, expect, it } from 'vitest';
import { checkPassword, passwordStrength } from '../src/lib/domain/password-policy.ts';
import { validateNick } from '../src/lib/domain/nick.ts';
import { assignAvatars, isValidAvatar } from '../src/lib/domain/avatars.ts';
import { nicks } from '../src/data/nicks.ts';
import { config } from '../src/data/config.ts';
import { checkUnsafeRequest } from '../src/lib/security/request.ts';
import { hashPassword, verifyPassword } from '../src/lib/security/password.ts';
import { newInitialCode, normalizeCode } from '../src/lib/security/tokens.ts';

describe('política de claves', () => {
  it('rechaza claves cortas, el nick, claves débiles y repetitivas', () => {
    expect(checkPassword({ password: 'abc', nick: 'Meco' })).toContain('corta');
    expect(checkPassword({ password: 'Peliqueiro', nick: 'Peliqueiro' })).toContain('es_el_nick');
    expect(checkPassword({ password: 'peliqueiro', nick: 'Peliqueiro' })).toContain('es_el_nick');
    expect(checkPassword({ password: 'Contraseña', nick: 'Meco' })).toContain('debil');
    expect(checkPassword({ password: 'BERENJENA', nick: 'Meco' })).toContain('debil');
    expect(checkPassword({ password: '12345678', nick: 'Meco' })).toContain('debil');
    expect(checkPassword({ password: 'aaaaaaaaaa', nick: 'Meco' })).toContain('repetitiva');
    expect(checkPassword({ password: '987654321', nick: 'Meco' })).toContain('repetitiva');
  });

  it('admite frases largas con espacios', () => {
    expect(checkPassword({ password: 'mi huerta da tomates en agosto', nick: 'Meco' })).toEqual([]);
  });

  it('rechaza repetir la clave actual', () => {
    expect(checkPassword({ password: 'una frase larga', nick: 'Meco', currentPassword: 'una frase larga' })).toContain(
      'igual_actual',
    );
  });

  it('el indicador de fortaleza crece con la longitud', () => {
    expect(passwordStrength('abc')).toBe('muy_debil');
    expect(passwordStrength('mi huerta da tomates en agosto')).toBe('buena');
  });
});

describe('nicks', () => {
  it('una palabra de 3–20 letras, con tildes', () => {
    expect(validateNick('Cigarrón')).toEqual({ ok: true, nick: 'Cigarrón' });
    expect(validateNick('Dos palabras').ok).toBe(false);
    expect(validateNick('ab').ok).toBe(false);
    expect(validateNick('Peli1').ok).toBe(false);
    expect(validateNick('Admin')).toEqual({ ok: false, reason: 'reservado' });
  });

  it('hay tantos nicks como plazas y no se repiten', () => {
    expect(nicks).toHaveLength(config.plazas);
    expect(new Set(nicks.map((n) => n.toLowerCase())).size).toBe(nicks.length);
    for (const nick of nicks) expect(validateNick(nick).ok).toBe(true);
  });
});

describe('avatares', () => {
  const files = ['a.webp', 'b.webp', 'c.webp', 'peliqueiro.svg'];

  it('usa el archivo con el nombre del nick si existe y reparte el resto sin repetir', () => {
    const result = assignAvatars(['Peliqueiro', 'Meco', 'Mula'], files);
    expect(result[0]).toBe('peliqueiro.svg');
    expect(new Set(result).size).toBe(3);
  });

  it('permite repetir si hay menos avatares que plazas', () => {
    const result = assignAvatars(['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'], ['a.webp', 'b.webp']);
    expect(result.every((r) => r !== null)).toBe(true);
    expect(result).toHaveLength(5);
  });

  it('sin avatares devuelve null', () => {
    expect(assignAvatars(['Meco'], [])).toEqual([null]);
  });

  it('solo acepta identificadores de la lista (nunca rutas libres)', () => {
    expect(isValidAvatar('a.webp', files)).toBe(true);
    expect(isValidAvatar('../../etc/passwd', files)).toBe(false);
    expect(isValidAvatar('https://evil.example/x.svg', files)).toBe(false);
    expect(isValidAvatar(42, files)).toBe(false);
  });
});

describe('CSRF: origen y content-type', () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
  const url = 'https://eggplan.example/api/me/password';

  it('GET siempre pasa', () => {
    expect(checkUnsafeRequest('GET', h({}), url).ok).toBe(true);
  });
  it('POST del mismo origen con JSON pasa', () => {
    expect(checkUnsafeRequest('POST', h({ origin: 'https://eggplan.example', 'content-type': 'application/json; charset=utf-8' }), url).ok).toBe(true);
  });
  it('POST sin Origin o de otro origen se rechaza', () => {
    expect(checkUnsafeRequest('POST', h({ 'content-type': 'application/json' }), url)).toEqual({ ok: false, reason: 'origin' });
    expect(checkUnsafeRequest('POST', h({ origin: 'https://evil.example', 'content-type': 'application/json' }), url)).toEqual({ ok: false, reason: 'origin' });
  });
  it('solo application/json', () => {
    expect(checkUnsafeRequest('POST', h({ origin: 'https://eggplan.example', 'content-type': 'text/plain' }), url)).toEqual({ ok: false, reason: 'content-type' });
    expect(checkUnsafeRequest('DELETE', h({ origin: 'https://eggplan.example' }), url)).toEqual({ ok: false, reason: 'content-type' });
  });
});

describe('hash de claves (scrypt)', () => {
  it('verifica la clave correcta y rechaza la incorrecta o un hash manipulado', async () => {
    const hash = await hashPassword('una clave larga y rara');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('una clave larga y rara', hash)).toBe(true);
    expect(await verifyPassword('otra clave', hash)).toBe(false);
    expect(await verifyPassword('una clave larga y rara', hash.replace('scrypt$', 'scrypt$9'))).toBe(false);
    expect(await verifyPassword('x', 'basura')).toBe(false);
  });

  it('dos hashes de la misma clave son distintos (sal aleatoria)', async () => {
    expect(await hashPassword('misma clave 123')).not.toBe(await hashPassword('misma clave 123'));
  });
});

describe('códigos iniciales', () => {
  it('tienen el formato palabra-4dígitos y se normalizan', () => {
    for (let i = 0; i < 50; i++) expect(newInitialCode()).toMatch(/^[a-z]+-\d{4}$/);
    expect(normalizeCode('  Berenjena-4821 ')).toBe('berenjena-4821');
    expect(normalizeCode('Berenjena - 4821')).toBe('berenjena-4821');
  });
});
