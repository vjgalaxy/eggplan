/**
 * Emojis de los productos (datos de la comunidad, no del código). Son solo decoración: ayudan a
 * reconocer un artículo de un vistazo y los lectores de pantalla los ignoran.
 *
 * Cómo se elige el emoji de un artículo (ver src/lib/domain/emoji.ts):
 *  1. `frases`: expresiones de varias palabras (se buscan en todo el nombre).
 *  2. `palabras`: se mira el nombre palabra a palabra, de izquierda a derecha, y gana la primera que
 *     coincida (así «Zumo de manzana» es 🧃 y no 🍎: la primera palabra es el producto). Una clave de
 *     4 letras o más vale también como comienzo de palabra (plural: «patata» → «patatas»); las cortas,
 *     solo palabra exacta («pan» no es «pandeireta»).
 *  3. `categorias`: si el nombre no dice nada, el de su categoría.
 *  4. `tipos`: y si no, el de su tipo (bien, servicio o préstamo).
 * Las claves van en minúsculas y sin tildes. Para cambiar o añadir un emoji, se edita este archivo.
 */
export const emojis = {
  frases: [
    ['cocina por encargo', '🍲'],
    ['mano de obra', '💪'],
    ['hierba luisa', '🌿'],
    ['hierba seca', '🌾'],
    ['tabla de cortar', '🔪'],
    ['ropa infantil', '👕'],
  ],

  palabras: [
    // Huerta
    ['patata', '🥔'], ['cebolleta', '🧅'], ['cebolla', '🧅'], ['ajo', '🧄'], ['ajos', '🧄'], ['puerro', '🥬'],
    ['zanahoria', '🥕'], ['berza', '🥬'], ['repollo', '🥬'], ['coliflor', '🥦'], ['brocoli', '🥦'], ['grelos', '🥬'],
    ['nabizas', '🥬'], ['nabo', '🍠'], ['acelga', '🥬'], ['espinaca', '🥬'], ['lechuga', '🥬'], ['tomate', '🍅'],
    ['pimiento', '🫑'], ['pepino', '🥒'], ['calabacin', '🥒'], ['calabaza', '🎃'], ['judia', '🫛'], ['habas', '🫛'],
    ['guisante', '🫛'], ['remolacha', '🍠'], ['rabano', '🍠'], ['perejil', '🌿'], ['apio', '🥬'], ['maiz', '🌽'],
    ['alubia', '🫘'], ['seta', '🍄'],
    // Frutas y frutos secos
    ['manzana', '🍎'], ['pera', '🍐'], ['peras', '🍐'], ['membrillo', '🍐'], ['ciruela', '🍑'], ['cereza', '🍒'],
    ['melocoton', '🍑'], ['higo', '🫐'], ['uva', '🍇'], ['uvas', '🍇'], ['kiwi', '🥝'], ['caqui', '🍊'],
    ['naranja', '🍊'], ['limon', '🍋'], ['fresa', '🍓'], ['frambueso', '🌱'], ['frambuesa', '🍓'], ['moras', '🫐'],
    ['arandano', '🫐'], ['castano', '🌳'], ['castana', '🌰'], ['nuez', '🌰'], ['nueces', '🌰'], ['avellana', '🌰'],
    // Huevos, lácteos y miel
    ['huevo', '🥚'], ['queso', '🧀'], ['requeson', '🧀'], ['mantequilla', '🧈'], ['leche', '🥛'], ['yogur', '🥛'],
    ['miel', '🍯'], ['vela', '🕯️'], ['cera', '🐝'], ['nucleo', '🐝'], ['abeja', '🐝'], ['colmena', '🐝'],
    // Pan, dulces y despensa
    ['pan', '🍞'], ['hogaza', '🍞'], ['bica', '🍰'], ['tarta', '🍰'], ['bizcocho', '🍰'], ['empanada', '🥧'],
    ['rosquilla', '🍩'], ['filloa', '🥞'], ['orelleta', '🍪'], ['galleta', '🍪'], ['mermelada', '🫙'], ['dulce', '🫙'],
    ['compota', '🍎'], ['conserva', '🫙'], ['pimenton', '🌶️'], ['harina', '🌾'], ['aceite', '🫒'], ['vinagre', '🍶'],
    // Bebidas
    ['vino', '🍷'], ['mosto', '🍇'], ['zumo', '🧃'], ['orujo', '🥃'], ['aguardiente', '🥃'], ['licor', '🥃'],
    ['cafe', '☕'], ['infusion', '🍵'],
    // Cereales, forraje y abono
    ['trigo', '🌾'], ['centeno', '🌾'], ['avena', '🌾'], ['paja', '🌾'], ['forraje', '🌾'], ['estiercol', '🌱'],
    ['compost', '🌱'], ['humus', '🪱'], ['cenizas', '🔥'],
    // Plantas y semillas
    ['plantel', '🌱'], ['semilla', '🌱'], ['frutal', '🌳'], ['nogal', '🌳'], ['vid', '🍇'], ['planta', '🪴'],
    ['flores', '💐'], ['injertado', '🌳'],
    // Hierbas
    ['manzanilla', '🌼'], ['menta', '🌿'], ['romero', '🌿'], ['laurel', '🌿'], ['oregano', '🌿'], ['tomillo', '🌿'],
    // Madera y leña
    ['lena', '🪵'], ['astillas', '🪵'], ['pellets', '🪵'], ['carbon', '🔥'], ['poste', '🪵'], ['tutores', '🪵'],
    ['tabla', '🪵'], ['viga', '🪵'], ['tablon', '🪵'], ['madera', '🪵'], ['pale', '🪵'],
    // Construcción y ferretería
    ['alambre', '🚧'], ['malla', '🚧'], ['grapas', '📎'], ['clavos', '🔩'], ['tornillos', '🔩'], ['cemento', '🪣'],
    ['arena', '🪨'], ['grava', '🪨'], ['cal', '🪨'], ['yeso', '🪨'], ['ladrillo', '🧱'], ['bloque', '🧱'],
    ['teja', '🏠'], ['piedra', '🪨'], ['tubo', '🚰'], ['cable', '🔌'], ['pintura', '🎨'], ['chapa', '🏠'],
    ['puerta', '🚪'], ['ventana', '🪟'], ['radiador', '♨️'], ['deposito', '🛢️'], ['bidon', '🛢️'], ['manguera', '💧'],
    ['riego', '💧'],
    // Herramientas y maquinaria
    ['motosierra', '🪚'], ['desbrozadora', '🌿'], ['cortacesped', '🚜'], ['cortasetos', '✂️'], ['motocultor', '🚜'],
    ['rotovator', '🚜'], ['segadora', '🚜'], ['hormigonera', '🏗️'], ['remolque', '🚛'], ['tractor', '🚜'],
    ['furgoneta', '🚐'], ['miniexcavadora', '🏗️'], ['escalera', '🪜'], ['andamio', '🏗️'], ['carretilla', '🛒'],
    ['taladro', '🔧'], ['amoladora', '⚙️'], ['sierra', '🪚'], ['soldadora', '⚙️'], ['compresor', '⚙️'],
    ['hidrolimpiadora', '💦'], ['sulfatadora', '💦'], ['generador', '🔋'], ['biotrituradora', '⚙️'],
    ['podadora', '✂️'], ['bomba', '💧'], ['gato', '🚗'], ['herramientas', '🧰'],
    // Servicios
    ['albanileria', '🧱'], ['carpinteria', '🪚'], ['fontaneria', '🔧'], ['electricidad', '💡'], ['soldadura', '🔥'],
    ['poda', '✂️'], ['tala', '🪓'], ['desbroce', '🌿'], ['siega', '🌾'], ['labrado', '🚜'], ['arado', '🚜'],
    ['injertos', '🌳'], ['vendimia', '🍇'], ['esquilado', '🐑'], ['animales', '🐾'],
    ['transporte', '🚐'], ['ninos', '🧒'], ['mayores', '🤝'], ['idiomas', '🗣️'], ['musica', '🎵'],
    ['informatico', '💻'], ['diseno', '🎨'], ['fotografia', '📷'], ['costura', '🧵'], ['electrodomesticos', '🔧'],
    ['bicicleta', '🚲'], ['mecanica', '🚗'], ['tramites', '📄'], ['traduccion', '🗣️'], ['peluqueria', '✂️'],
    // Artesanía
    ['cesto', '🧺'], ['cesta', '🧺'], ['escoba', '🧹'], ['cuenco', '🥣'], ['cuchara', '🥄'], ['zuecos', '👞'],
    ['taburete', '🪑'], ['caja', '📦'], ['juguete', '🧸'], ['pandeireta', '🪘'], ['jabon', '🧼'],
    ['ceramica', '🏺'], ['cuchillo', '🔪'], ['forja', '⚒️'], ['bordado', '🪡'], ['ganchillo', '🧶'],
    // Lana y textil
    ['lana', '🧶'], ['calcetines', '🧦'], ['gorro', '🧣'], ['bufanda', '🧣'], ['jersey', '🧥'], ['manta', '🧶'],
    ['piel', '🐑'], ['retales', '🧵'], ['tela', '🧵'],
    // Hogar y segunda mano
    ['libro', '📚'], ['ropa', '👕'], ['cocina', '🔥'], ['estufa', '🔥'], ['mesa', '🪑'], ['silla', '🪑'],
    ['armario', '🚪'], ['cama', '🛏️'], ['frigorifico', '🧊'], ['lavadora', '🧺'], ['vajilla', '🍽️'],
    ['tarros', '🫙'], ['garrafas', '🫙'],
  ],

  categorias: {
    huerta: '🥬',
    frutas: '🍎',
    'huevos-lacteos': '🥚',
    'miel-apicultura': '🍯',
    'pan-despensa': '🍞',
    bebidas: '🍷',
    'cereales-forraje': '🌾',
    'plantas-semillas': '🌱',
    hierbas: '🌿',
    'madera-lena': '🪵',
    construccion: '🧱',
    herramientas: '🧰',
    servicios: '🛠️',
    artesania: '🧺',
    'lana-textil': '🧶',
    hogar: '🏠',
    otros: '📦',
  },

  tipos: { bien: '📦', servicio: '🛠️', prestamo: '🔁' },
} as const satisfies {
  frases: readonly (readonly [string, string])[];
  palabras: readonly (readonly [string, string])[];
  categorias: Record<string, string>;
  tipos: Record<'bien' | 'servicio' | 'prestamo', string>;
};
