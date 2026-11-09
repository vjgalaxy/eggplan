/**
 * Reglas de la clave elegida por la persona. Lógica pura: la usa el servidor (que manda) y los
 * formularios (para dar prealimentación en el momento).
 */
import { config } from '../../data/config.ts';

export type PasswordProblem = 'corta' | 'es_el_nick' | 'debil' | 'repetitiva' | 'igual_actual' | 'no_coincide';

/** Minúsculas y sin tildes, para comparar de forma tolerante. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

const WEAK = new Set(
  [
    '123', '1234', '12345', '123456', '1234567', '12345678', '123456789', '1234567890', '0000', '00000000',
    '11111111', 'password', 'password1', 'contrasena', 'contrasena1', 'clave', 'clave1234', 'berenjena',
    'berenjenas', 'eggplan', 'theeggplan', 'qwerty', 'qwertyui', 'qwerty123', 'abcd1234', 'abcdefgh',
    'iloveyou', 'admin', 'administrador', 'identidadrural',
  ].map(fold),
);

export interface PasswordCheckInput {
  password: string;
  nick: string;
  minLength?: number;
  currentPassword?: string | undefined;
}

export function checkPassword({ password, nick, minLength = config.acceso.claveMinLongitud, currentPassword }: PasswordCheckInput): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  const folded = fold(password);
  const compact = folded.replace(/[\s\-_.]/g, '');

  if ([...password].length < minLength) problems.push('corta');
  if (folded === fold(nick) || compact === fold(nick)) problems.push('es_el_nick');
  if (WEAK.has(folded) || WEAK.has(compact)) problems.push('debil');
  if (/^(.)\1+$/u.test(compact) || isSimpleSequence(compact)) problems.push('repetitiva');
  if (currentPassword !== undefined && password === currentPassword) problems.push('igual_actual');
  return problems;
}

function isSimpleSequence(text: string): boolean {
  if (text.length < 4) return false;
  const codes = [...text].map((c) => c.codePointAt(0) ?? 0);
  const step = (codes[1] ?? 0) - (codes[0] ?? 0);
  if (Math.abs(step) !== 1) return false;
  return codes.every((code, i) => i === 0 || code - (codes[i - 1] ?? 0) === step);
}

export type Strength = 'muy_debil' | 'debil' | 'aceptable' | 'buena';

/** Indicador de fortaleza sencillo para la interfaz (longitud y variedad; admite frases largas). */
export function passwordStrength(password: string): Strength {
  const length = [...password].length;
  if (length === 0) return 'muy_debil';
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\d/, /[^\p{L}\d]/u].filter((re) => re.test(password)).length;
  const unique = new Set(password).size;
  if (unique < 4) return 'muy_debil';
  if (length >= 16 || (length >= 12 && classes >= 2)) return 'buena';
  if (length >= 10 || (length >= 8 && classes >= 3)) return 'aceptable';
  return length >= 8 ? 'debil' : 'muy_debil';
}
