/**
 * Configuración de la comunidad. Nada específico de una comunidad debe estar en el código:
 * para replicar The Eggplan en otro sitio se cambian este archivo, `nicks.ts`, `catalogo.ts`
 * y la carpeta `public/avatars/`.
 *
 * Importes en centésimas de Berenjena (cB): 1 B = 100 cB.
 */
export const config = {
  comunidad: {
    nombre: 'Ourense (piloto)',
    /** Texto del responsable del tratamiento de datos (borrador, se usa en /normas en la Fase 4). */
    responsableDatos: 'Identidad Rural (por confirmar)',
  },

  moneda: {
    nombre: 'Berenjena',
    nombrePlural: 'Berenjenas',
    simbolo: 'B',
    /** Céntimos por unidad: 1 B = 100 cB. */
    centesimas: 100,
  },

  /** Número de plazas fijas (una por familia). Debe coincidir con la longitud de `nicks.ts`. */
  plazas: 20,

  chat: {
    nombre: 'A Praza',
    retencionDias: 90,
    pollingMs: 12_000,
    maxCaracteres: 500,
    maxPorMinuto: 20,
    minMsEntreMensajes: 2_000,
  },

  avisos: { pollingMs: 30_000 },

  /** Factor de valor por estado del bien (Fase 1). */
  factoresEstado: { nuevo: 1, bueno: 0.75, usado: 0.5, para_reparar: 0.25 },

  propuestas: {
    maxPendientesPorFamilia: 5,
    caducidadDias: 7,
    maxCaracteresMensaje: 300,
  },

  productosPropios: {
    valorMaximoPropio: 1000,
    confirmarValorMayorQue: 100,
  },

  acceso: {
    /** Longitud mínima de la clave elegida por la persona. */
    claveMinLongitud: 8,
    /** Número de fallos por nick que provocan el bloqueo temporal. */
    maxFallosPorNick: 5,
    /** Número de fallos por IP en la ventana (más alto: varias familias pueden compartir IP). */
    maxFallosPorIp: 30,
    ventanaFallosMin: 15,
    bloqueoMin: 15,
    /** Duración deslizante de la sesión. */
    sesionDias: 14,
    /** Las IP (siempre como HMAC) se purgan pasadas estas horas. */
    retencionIpHoras: 24,
    /** Nick de la cuenta de administración (reservado: no puede usarlo ninguna familia). */
    nickAdmin: 'admin',
    adminClaveMinLongitud: 12,
  },

  /** Palabras sencillas, sin tildes ni eñes, para dictar los códigos iniciales por teléfono. */
  palabrasCodigo: [
    'berenjena', 'huerta', 'tomate', 'patata', 'cebolla', 'manzana', 'cereza', 'nogal',
    'roble', 'pimiento', 'calabaza', 'centeno', 'trigo', 'maiz', 'uva', 'miel',
    'queso', 'pan', 'huevo', 'lechuga', 'judia', 'pera', 'higo', 'ciruela',
    'castana', 'cesta', 'arado', 'granja', 'prado', 'aldea', 'molino', 'fuente',
  ],
} as const;

export type Config = typeof config;
