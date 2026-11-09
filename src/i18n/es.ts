/**
 * Textos de la interfaz (español). Centralizados para poder añadir gallego más adelante:
 * bastará con crear `gl.ts` con la misma forma y elegir el idioma en un único sitio.
 * Vocabulario único: stock · artículo · se busca · propuesta · trueque · Berenjena.
 */
import type { PasswordProblem, Strength } from '../lib/domain/password-policy.ts';
import { config } from '../data/config.ts';

const { nombre: moneda, simbolo } = config.moneda;

export const t = {
  app: { nombre: 'The Eggplan', lema: 'El stock de las familias, a la vista de todas.' },

  nav: {
    inicio: 'Inicio',
    stocks: 'Stocks',
    miStock: 'Mi stock',
    trueques: 'Trueques',
    plaza: 'Plaza',
    ajustes: 'Ajustes',
    salir: 'Salir',
    menuUsuario: 'Menú de tu cuenta',
    principal: 'Navegación principal',
  },

  comun: {
    cargando: 'Cargando…',
    cancelar: 'Cancelar',
    volver: 'Volver',
    guardar: 'Guardar',
    continuar: 'Continuar',
    errorRed: 'No hemos podido conectar. Comprueba tu conexión e inténtalo de nuevo.',
    errorGenerico: 'Algo no ha ido bien. Inténtalo de nuevo en unos minutos.',
    proximamente: 'Esta parte estará disponible próximamente.',
  },

  login: {
    titulo: 'Entrar',
    elige: 'Toca tu nombre para entrar',
    clave: 'Tu clave',
    claveAyuda: 'La clave que elegiste. Si es tu primera vez, escribe el código de tu tarjeta.',
    entrar: 'Entrar',
    entrando: 'Entrando…',
    otraPlaza: 'Elegir otra plaza',
    mostrar: 'Mostrar',
    ocultar: 'Ocultar',
    pideCodigo: 'Pide tu código a la administración',
    bloqueada: 'Plaza bloqueada',
    entrandoComo: (nick: string) => `Entras como ${nick}`,
    plazaAria: (nick: string) => `Entrar como ${nick}`,
    soyAdmin: 'Administración',
    sinPlazas: 'Todavía no hay plazas creadas.',
  },

  admin: {
    loginTitulo: 'Administración',
    loginAyuda: 'Acceso solo para la administración de la comunidad.',
    clave: 'Clave de administración',
    entrar: 'Entrar',
    plazas: 'Plazas',
    plazasAyuda: 'Una plaza por familia. Aquí no se ven claves, sesiones, mensajes ni avisos de nadie.',
    generarCodigos: 'Generar códigos iniciales',
    generarCodigosAyuda: 'Crea un código para cada plaza que todavía no tiene código ni clave.',
    regenerar: 'Nuevo código',
    regenerarConfirmar: (nick: string) =>
      `¿Generar un código nuevo para ${nick}? Su clave actual dejará de valer y tendrá que elegir otra al entrar.`,
    bloquear: 'Bloquear',
    desbloquear: 'Desbloquear',
    bloquearConfirmar: (nick: string) => `¿Bloquear la plaza de ${nick}? No podrá entrar hasta que la desbloquees.`,
    renombrar: 'Cambiar nick',
    nuevoNick: 'Nuevo nick (una palabra, 3–20 letras)',
    ultimoAcceso: 'Último acceso',
    nunca: 'Nunca',
    estado: { sin_activar: 'Sin activar', activo: 'Activa', bloqueado: 'Bloqueada' },
    pendienteClave: 'Pendiente de elegir clave',
    sinCodigo: 'Sin código',
    codigosTitulo: 'Códigos iniciales',
    codigosAviso:
      'Estos códigos se muestran una sola vez. Imprime las tarjetas ahora: al salir de esta pantalla no se podrán volver a ver (si se pierde uno, se genera otro).',
    imprimir: 'Imprimir tarjetas',
    cerrarCodigos: 'He impreso o apuntado los códigos',
    cerrarCodigosConfirmar: 'Si cierras, los códigos no se podrán volver a ver. ¿Seguro?',
    nadaPendiente: 'No hay plazas pendientes de código.',
    tarjetaPasos: [
      'Entra en la dirección de esta tarjeta.',
      'Toca tu nombre y escribe el código.',
      'Elige tu propia clave (la que tú quieras recordar).',
    ] as readonly string[],
    tarjetaDireccion: 'Dirección de la web',
    tarjetaCodigo: 'Tu código',
    tarjetaCodigoAviso: 'Sirve solo para la primera vez.',
  },

  clave: {
    tituloObligatorio: 'Elige tu propia clave',
    introObligatorio:
      'Es la primera vez que entras. Elige una clave que solo conozcas tú. Puede ser una frase larga, es más fácil de recordar.',
    tituloVoluntario: 'Cambiar mi clave',
    actual: 'Clave actual',
    nueva: 'Clave nueva',
    repetir: 'Repite la clave nueva',
    guardar: 'Guardar mi clave',
    guardando: 'Guardando…',
    guardada: 'Clave guardada. Hemos cerrado tus otras sesiones.',
    reglas: (min: number) => `Mínimo ${min} caracteres. No puede ser tu nick ni una clave fácil como «123456» o «contraseña».`,
    fortaleza: {
      muy_debil: 'Muy floja',
      debil: 'Floja',
      aceptable: 'Aceptable',
      buena: 'Buena',
    } satisfies Record<Strength, string>,
    fortalezaEtiqueta: 'Fortaleza',
    claveActualIncorrecta: 'La clave actual no es correcta.',
    problemas: (min: number): Record<PasswordProblem, string> => ({
      corta: `Es demasiado corta: usa al menos ${min} caracteres.`,
      es_el_nick: 'No puede ser igual que tu nick.',
      debil: 'Es una clave muy conocida. Prueba con una frase tuya.',
      repetitiva: 'Es demasiado repetitiva o seguida (como «aaaa» o «1234»).',
      igual_actual: 'Tiene que ser distinta de la que ya tienes.',
      no_coincide: 'Las dos claves no coinciden.',
    }),
  },

  inicio: {
    bienvenida: (nick: string) => `Te damos la bienvenida, ${nick}`,
    queEs: 'The Eggplan es el stock de las familias: cada una apunta lo que tiene y todas pueden verlo.',
    berenjenaTitulo: `Qué es la ${moneda}`,
    berenjenaTexto: `La ${moneda} sirve para comparar valores; no es dinero y no se acumula. Si un trueque queda desequilibrado, la aplicación te lo muestra, pero no te lo impide.`,
    ejemplo: `Ejemplo: una docena de huevos puede valer 4 ${simbolo}; así sabes cuánto vale cada cosa al proponer un trueque.`,
    proximosPasos: 'Lo que vendrá',
    pasos: [
      'Mi stock: apuntar lo que tienes.',
      'Stocks: ver lo que tienen las demás familias.',
      'Trueques: proponer un intercambio.',
      'Plaza: charlar con la comunidad.',
    ] as readonly string[],
  },

  ajustes: {
    titulo: 'Ajustes',
    avatarTitulo: 'Tu avatar',
    avatarAyuda: 'Toca el que más te guste. Se cambia al instante.',
    avatarActual: 'Avatar actual',
    avatarCambiado: 'Avatar cambiado.',
    avatarError: 'No hemos podido cambiar el avatar.',
    avatarOpcion: (nombre: string) => `Elegir el avatar ${nombre}`,
  },

  errores: {
    paginaNoEncontrada: 'No encontramos esta página.',
    irInicio: 'Ir al inicio',
  },
} as const;

export type Texts = typeof t;
