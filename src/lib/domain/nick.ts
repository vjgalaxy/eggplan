import { config } from '../../data/config.ts';
import { fold } from './password-policy.ts';

/** Nick: una sola palabra, 3–20 letras (se admiten tildes, ñ y ü). Devuelve el nick limpio o un motivo. */
export function validateNick(input: string): { ok: true; nick: string } | { ok: false; reason: 'formato' | 'reservado' } {
  const nick = input.trim();
  if (!/^\p{L}{3,20}$/u.test(nick)) return { ok: false, reason: 'formato' };
  if (fold(nick) === fold(config.acceso.nickAdmin)) return { ok: false, reason: 'reservado' };
  return { ok: true, nick };
}
