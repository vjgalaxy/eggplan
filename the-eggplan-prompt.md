# The Eggplan — Prompt para Claude Code

Eres Claude Code. Vas a construir desde cero **The Eggplan**, una aplicación web privada para un grupo pequeño de familias de un entorno rural (piloto en Ourense, Galicia) que permite que cada familia mantenga su propio **stock** de recursos (bienes, servicios, préstamos) y que **todas las demás familias puedan ver ese stock**, proponer trueques usando una unidad de cuenta virtual llamada **Berenjena**, y charlar en un chat comunitario de estilo clásico.

Está diseñada por Identidad Rural, pero se despliega en **otra cuenta de Netlify**, en un repositorio aislado (sin monorepo). Si el piloto funciona, se replicará en otras comunidades: cada comunidad será otro repo/sitio/base de datos con sus propios archivos de datos. Por eso nada específico de Ourense debe estar escrito en el código: va en archivos de datos y de configuración (sección 9).

---

## 0. Cómo quiero que trabajes

- Trabaja **por fases** (sección 11). Al terminar cada fase: ejecuta tests y build, haz un commit con mensaje claro y **detente** para que yo revise. No hagas `git push` (el push a `main` despliega automáticamente).
- Antes de usar APIs de Astro, Netlify o Netlify Database, **consulta la documentación actual**. No te fíes de la memoria: estas herramientas cambian rápido.
- Si una regla de negocio no está cubierta aquí, **pregúntame**; no inventes reglas.
- Mantén las dependencias al mínimo y justifica cada una nueva en una línea.
- TypeScript estricto. Toda la interfaz en **español** (con textos centralizados para añadir gallego más adelante).
- Nunca registres en logs claves, tokens de sesión ni el cuerpo de mensajes. Nunca subas secretos al repo.

---

## 1. Stack y despliegue

- **Astro** con renderizado bajo demanda (SSR) mediante el adaptador oficial de Netlify (`npx astro add netlify`).
- **Vue 3** como islas de Astro. Recomendación de arquitectura (puedes desviarte si lo justificas): páginas Astro para el esqueleto y el login, una isla Vue para el área de miembros bajo `/app`, otra para `/admin`, y una API JSON en endpoints de Astro bajo `/api`.
- **Tailwind CSS v4** con el plugin `@tailwindcss/vite` en `astro.config.mjs` (no el patrón antiguo de v3).
- **Base de datos: Netlify Database** (Postgres gestionado). Usa el paquete `@netlify/database` y la variable `NETLIFY_DB_URL`; inicialízalo con `netlify database init`. **No uses** la extensión antigua deprecada (`@netlify/neon`, `NETLIFY_DATABASE_URL`). Migraciones SQL numeradas y versionadas en el repo. Usa SQL plano con helpers tipados salvo que la guía oficial recomiende otra cosa; evita versiones beta de ORMs si puedes. Las operaciones que afectan a stock o estados van en **transacciones** (en Netlify Database, mediante el pool, de modo que BEGIN/COMMIT usen la misma conexión).
- Validación de entradas con `zod` (o `valibot`) en todos los endpoints.
- Tests con `vitest` para la lógica de dominio.
- Desarrollo local con `netlify dev` o el equivalente que la documentación actual recomiende.
- El proyecto no usa servicios de terceros en tiempo de ejecución: sin analítica, sin fuentes externas (autoalojadas), sin CDNs de scripts.

---

## 2. Qué es y qué no es

- El concepto central es el **stock**: cada familia construye y mantiene el suyo ("Mi stock"), y **cualquier familia puede consultar el stock de las demás** ("Stocks"). Sobre eso se apoyan las búsquedas, las propuestas de trueque y un chat comunitario.
- Vocabulario único en toda la app y en el código: **stock** = el conjunto de recursos de una familia; **artículo** = cada línea de ese stock (un producto del catálogo, o un *producto propio* que no está en la lista, con su cantidad y su valor).
- La Berenjena es **solo una unidad de cuenta**: sirve para comparar valores. **No hay saldos, ni carteras, ni crédito, ni emisión de moneda.** Una propuesta puede quedar desequilibrada o ser un regalo; la app lo muestra pero no lo impide.
- No hay registro público. Existen **20 plazas fijas** (una por familia), creadas por migración, más **una cuenta de administración** separada.

---

## 3. Reglas de negocio (ya decididas)

### 3.1 Moneda
- Nombre: Berenjena (plural Berenjenas, símbolo `B`). Configurable en `config.ts`.
- Guarda los valores como **enteros en centésimas** (`cB`; 1 B = 100 cB). Nunca uses `float`. En pantalla se muestran con hasta dos decimales, sin ceros sobrantes (por ejemplo `0,25 B`, `4 B`).
- Criterio interno de calibración del catálogo: 1 B ≈ 1 € de valor real. **No muestres equivalencias en euros en la interfaz.**

### 3.2 Catálogo y valor de referencia
- Existe un catálogo de productos y servicios con: nombre, categoría, tipo (`bien` | `servicio` | `prestamo`), unidad (docena, kg, litro, unidad, saco, hora, día…), **valor de referencia** por unidad y si es perecedero.
- El catálogo se siembra desde `src/data/catalogo.ts` (sección 9) y se gestiona luego desde el panel de administración.
- El **valor de referencia lo puede subir o bajar el administrador** libremente. Registra cada cambio en un historial (valor anterior, nuevo, quién, cuándo).
- La siembra inicial **nunca debe sobrescribir** un valor que el administrador haya editado (marca la procedencia del valor: `seed` | `admin`).

### 3.3 Stock ("Mi stock" y "Stocks")
- Cada familia crea su stock añadiendo **artículos**, normalmente a partir de un producto del catálogo y, si no está en la lista, como **producto propio** (ver más abajo): cantidad disponible, unidad, estado del bien, caducidad opcional (alimentos), nota libre (máx. 200 caracteres), y estado `activo` | `pausado` | `borrado` (borrado lógico con posibilidad de deshacer unos segundos).
- **Estado del bien** (solo para `bien`): `nuevo` 1,00 · `bueno` 0,75 · `usado` 0,50 · `para_reparar` 0,25. Los factores van en `config.ts`.
- **Valor efectivo por unidad** = si el artículo no tiene valor propio: `referencia × factor_estado`. Si tiene valor propio: `min(valor_propio, referencia × factor_estado)`.
- Una familia **puede bajar el valor de sus artículos pero nunca subirlo por encima del valor recomendado** (`referencia × factor`). Esto se valida **en el servidor**, no solo en el formulario.
- Consecuencias a respetar y probar con tests:
  - Si el admin **baja** la referencia, los artículos se ajustan solos (por el `min`).
  - Si el admin **sube** la referencia, los artículos **sin valor propio** suben con ella; los que tienen valor propio **mantienen** el suyo (no suben solos).
  - Las líneas de propuestas ya creadas conservan una **copia congelada** del valor (sección 3.5).
- **Servicios**: unidad típica hora o jornada; sin factor de estado.
- **Préstamos**: el valor es un "valor de uso" opcional por día o por uso (puede ser 0). Tienen estados adicionales: `prestado` y `devuelto`.

**Producto propio (un artículo que no está en la lista):**
- **Cualquier familia puede añadir a su stock un artículo que no figura en el catálogo**, sin esperar a nadie: se publica al instante.
- Flujo al añadir un artículo: primero un **buscador del catálogo** (sin distinguir mayúsculas ni tildes, con sinónimos básicos). Si no aparece lo que busca, un botón bien visible **"No está en la lista: añadir el mío"** abre el formulario de producto propio. Así se evitan duplicados sin bloquear a nadie.
- Campos del producto propio: nombre (3–60 caracteres), tipo (`bien` | `servicio` | `prestamo`), categoría (de la lista del catálogo; si ninguna encaja, `otros`), unidad (lista de unidades habituales + "otra" con texto libre), cantidad, caducidad opcional, nota y **valor por unidad en Berenjenas** (obligatorio).
- **Ayuda para poner el valor (prealimentación):** al elegir categoría y tipo, el formulario muestra 3–5 productos parecidos del catálogo con su valor de referencia ("Para orientarte: huevos camperos, 4 B la docena…"). Si el valor supera el umbral `confirmarValorMayorQue` (por defecto 100 B) pide confirmación; hay un tope duro `valorMaximoPropio` (por defecto 1000 B por unidad) para evitar erratas.
- La categoría `otros` ("Otros") existe siempre: la crea la migración, no el archivo del catálogo.
- En un producto propio el **estado del bien es informativo** (no multiplica el valor): la familia ya pone el valor del artículo tal como está.
- **Etiquetado**: mientras no esté verificado, el artículo muestra a todas las familias la etiqueta **"Producto propio · valor sin verificar"** (`value_status = sin_verificar`). En una propuesta, el resumen añade "incluye valores sin verificar" si procede.
- **Mientras está sin verificar**, la familia puede cambiar el valor libremente (arriba o abajo, dentro del tope duro).
- **Revisión del admin** (cola "Artículos propios por revisar", ordenada por antigüedad; no bloquea nada, es solo supervisión). Acciones:
  1. *Verificar*: marca `verificado` y guarda `verified_value_cb` = el valor actual. A partir de ahí rige la regla de siempre: la familia solo puede **bajar** su valor, nunca superar el verificado (`valor efectivo = min(own_value_cb, verified_value_cb)`).
  2. *Ajustar el valor*: el admin fija `verified_value_cb` en otro valor (sube o baja) y queda `verificado`.
  3. *Vincular a un producto del catálogo existente*: el artículo pasa a ser un artículo normal de ese producto (rigen referencia × factor de estado y la regla "solo a la baja").
  4. *Crear producto en el catálogo a partir del artículo*: se crea un producto nuevo (nombre, categoría, tipo, unidad y referencia = valor propuesto, editable) para que las demás familias puedan elegirlo; el artículo se vincula a él.
  5. *Ocultar con motivo*: pasa a `pausado` y se avisa a la familia.
- La familia recibe un aviso cuando su producto propio es verificado, ajustado, vinculado u oculto.
- Las líneas de propuestas ya creadas conservan su copia congelada aunque el admin cambie después el valor.

**Visibilidad del stock (requisito clave):**
- El stock de cada familia es **visible para todas las familias con sesión iniciada** (y para el admin). No hay stocks privados en el piloto.
- Vistas obligatorias:
  - **Mi stock**: gestión de mis artículos (añadir desde el catálogo o como producto propio, editar cantidad, estado y valor propio, pausar, borrar con deshacer).
  - **Stocks**: explorar lo que tienen las demás familias, con dos entradas: *por familia* (la ficha de cada nick con su stock completo, su avatar y sus trueques completados) y *por producto* ("¿quién tiene huevos?", con filtros por categoría, tipo y búsqueda de texto).
  - Cada artículo ajeno tiene un botón claro **"Proponer trueque"** que abre la propuesta con ese artículo ya añadido.
- Qué se muestra de cada artículo: producto, cantidad disponible, unidad, estado del bien, valor efectivo por unidad en Berenjenas, caducidad (si es perecedero) y nota. Si hay cantidad reservada en trueques aceptados, se muestra como "N reservadas" y no cuenta como disponible.
- Qué **no** se muestra a otras familias: artículos `pausados` o `borrados` (solo los ve su dueño; el admin ve todos). Los productos propios sí se muestran, con su etiqueta de valor sin verificar.
- Un stock vacío muestra un estado vacío con explicación y botón "Añadir mi primer artículo".

### 3.4 Búsquedas ("Se busca")
- Las familias pueden publicar lo que necesitan: producto del catálogo o texto libre, cantidad, nota. Se muestran en un tablón y también en la ficha del producto en el catálogo. Sin emparejamiento automático en el piloto.

### 3.5 Trueques (propuestas)
- Una familia A crea una propuesta a una familia B: elige líneas de B (artículos del stock de B con cantidad) y líneas propias (artículos del stock de A con cantidad). Puede incluir bienes, servicios y préstamos. Puede ser un **regalo** (una de las dos partes sin líneas).
- Cada línea guarda una **copia congelada** (nombre, unidad, valor efectivo por unidad, estado del bien) en el momento de crear la propuesta.
- La pantalla de la propuesta muestra siempre: **"Tú das X B · Recibes Y B · Diferencia Z B"**. Es informativo: no bloquea.
- Estados: `pendiente` → `aceptada` | `rechazada` | `cancelada` | `caducada` | `contraofertada` (la contraoferta es una propuesta nueva enlazada con `parent_trade_id`).
- Disponibilidad: al crear se comprueba que hay stock; **al aceptar** se vuelve a comprobar dentro de una transacción con bloqueo de filas y se **reserva** el stock de ambas partes. Si ya no hay stock suficiente, no se acepta y se explica por qué.
- Cada parte marca "entregado". Cuando ambas lo han hecho → `completada`: se descuenta el stock y se libera la reserva. Si se cancela después de aceptar, se libera la reserva.
- Para préstamos: tras completarse queda `prestado` hasta que quien presta marca `devuelto`.
- Límites configurables: máximo de propuestas pendientes por familia (por defecto 5) y caducidad automática de las pendientes (por defecto 7 días).
- Cada propuesta tiene un **hilo de mensajes cortos** (máx. 300 caracteres) visible solo para las dos partes.
- El perfil de cada familia muestra un contador de **trueques completados**. Sin valoraciones ni puntuaciones.

### 3.6 Chat comunitario
- Una sala única, nombre configurable (por defecto "A Praza"). Estilo **clásico tipo IRC/BBS**: líneas con hora, avatar pequeño, nick coloreado, tipografía monoespaciada, sin reacciones ni hilos.
- Netlify Functions **no admite WebSockets**: usa *polling* (`GET /api/chat?since=<id>`) cada ~12 s, **solo con la pestaña visible**, y refresca de inmediato tras enviar. Intervalo en `config.ts`.
- Límites: 500 caracteres por mensaje, máximo 1 mensaje cada 2 s y 20 por minuto por usuario. Se muestran los últimos 100 con "cargar anteriores".
- El autor puede borrar sus mensajes; el admin puede borrar cualquiera (moderación). Retención configurable (por defecto 90 días) con limpieza automática (función programada o limpieza oportunista; comprueba qué ofrece Netlify).
- El admin puede publicar anuncios con un estilo diferenciado.

### 3.7 Avisos dentro de la app
- No hay email ni notificaciones push. Hay un **buzón de avisos** con contador visible en la navegación: propuesta recibida, aceptada, rechazada, contraoferta, mensaje en una propuesta, la otra parte marcó "entregado", clave restablecida por el admin, y revisión de un producto propio (verificado, ajustado, vinculado u oculto).
- Contador consultado por *polling* ligero cada ~30 s con la pestaña visible.

---

## 4. Usuarios, avatares, acceso y claves

### 4.1 Plazas y nicks
- 20 plazas creadas por migración, cada una con un **nick de una sola palabra**. Los nicks viven en `src/data/nicks.ts`. Lista inicial (figuras del Entroido gallego):

  `Peliqueiro, Cigarrón, Pantalla, Boteiro, Felos, Vellarrón, Tarrón, Charlois, Gargallón, Labradeiro, Foloión, Beloira, Capuchón, Correuto, Merdeiro, Volante, Maragato, Farrangón, Meco, Mula`

- Reserva (no se siembran; disponibles para que el admin renombre una plaza): `Mázcara, Foleiro, Correo`.
- El admin puede renombrar un nick (único, una palabra, 3–20 letras).

### 4.2 Avatares
- Cada plaza tiene un **avatar asignado** y la familia puede **cambiarlo** por otro de los disponibles. Los avatares son los archivos de una carpeta del repo: `public/avatars/` (SVG o WebP pequeños).
- La lista de avatares disponibles se obtiene **escaneando la carpeta en build** (por ejemplo con `import.meta.glob`), de modo que añadir un archivo añade una opción sin tocar código.
- La base de datos guarda solo el **identificador del archivo**. El servidor valida que ese identificador exista en la lista; nunca aceptes rutas libres ni subidas de imágenes de usuarios.
- Asignación inicial: si existe un archivo con el nombre del nick (`peliqueiro.svg`), se usa; si no, se reparte por orden entre los disponibles evitando repetir mientras sea posible. Si hay menos avatares que plazas, se permite repetir.
- Selector de avatar en Ajustes: cuadrícula grande con el actual marcado, y el cambio se aplica al instante.
- Se muestra en: tarjetas de login, chat (pequeño), fichas de stock, propuestas y perfil. Siempre con `alt` = nick.
- Los archivos de `public/` se sirven sin autenticación: son **solo ilustraciones genéricas**, nunca fotos de personas. Incluye 4–6 avatares de ejemplo (puedes generar SVG simples y originales) para que la funcionalidad se pueda probar; yo pondré los definitivos.

### 4.3 Estados de una plaza
`sin_activar` (sin clave; no se puede entrar) · `activo` · `bloqueado` (por el admin o por intentos fallidos, temporal).

### 4.4 Clave inicial (sin clave por defecto)
- **No existe ninguna clave por defecto compartida.** Las plazas empiezan `sin_activar`.
- El admin pulsa en su panel **"Generar códigos iniciales"**. Se crea para cada plaza un **código inicial aleatorio y fácil de dictar por teléfono** (por ejemplo `berenjena-4821`, palabra común + 4 dígitos), se guarda solo su hash y se muestra **una única vez** en pantalla con una vista imprimible de **tarjetas** (una por familia: avatar, nick, código, dirección de la web e instrucciones de tres pasos). El código se puede regenerar por plaza.
- Con el código inicial, la persona entra por primera vez y **debe elegir su propia clave** antes de acceder a nada más (el middleware bloquea todo lo demás hasta que lo haga).

### 4.5 Cambiar la clave (y olvidos)
- Desde Ajustes → **"Cambiar mi clave"**: clave actual, clave nueva y repetir clave. Reglas: mínimo configurable (por defecto 8 caracteres), no puede ser el nick, ni estar en una lista de claves débiles (`123`, `1234`, `password`, `contraseña`, `berenjena`, etc.). Admite frases largas. Indicador de fortaleza sencillo y mensajes de error en lenguaje claro.
- Al cambiar la clave: se cierran **todas las demás sesiones** de esa persona y se crea un aviso.
- Si alguien **olvida su clave**: avisa al admin, que le **regenera un código inicial** (nueva tarjeta); la plaza vuelve a `sin_activar` hasta que lo use y elija una clave nueva.

### 4.6 Login
- Pantalla con una **cuadrícula de tarjetas** (avatar + nick) de las plazas; se toca la propia y se pide solo la clave. Las plazas `sin_activar` se ven atenuadas con el texto "Pide tu código a la administración".
- Mensajes de error claros. Tras 5 fallos en 15 min para un nick, bloqueo temporal de 15 min; límite adicional por IP.

---

## 5. Administración

- Cuenta **separada** (`admin`), con login propio en `/admin/login`, que **no participa en trueques**. El admin inicial se crea con la variable de entorno `ADMIN_BOOTSTRAP_PASSWORD` (configurada en Netlify) y debe cambiarla en el primer acceso.
- **El admin puede ver y gestionar todo lo que no es privado:**
  - Catálogo (crear/editar/desactivar, cambiar valores de referencia con historial) y la cola de **artículos propios por revisar** (sección 3.3).
  - El stock completo de todas las familias y las búsquedas (pausar o retirar un artículo con motivo).
  - Lista de plazas: nick, avatar, estado, último acceso, si falta cambiar la clave. Renombrar, bloquear/desbloquear, generar/regenerar códigos iniciales.
  - Trueques: partes, estado, fechas, líneas y valores (los **metadatos**), para métricas y resolver conflictos.
  - Chat comunitario completo, con moderación y anuncios.
  - Métricas simples: familias activas esta semana, artículos activos en stock, productos propios sin revisar, propuestas y trueques completados por semana.
  - Exportación de datos no privados (JSON/CSV).
  - Registro de auditoría de todas sus acciones.
- **Es privado y el admin NO puede ver:** claves y hashes, sesiones, **los mensajes dentro de las propuestas**, y los avisos personales de cada familia. Estos datos no deben tener ningún endpoint ni pantalla de admin.
- La interfaz de admin lleva `noindex` igual que el resto.

---

## 6. Seguridad

Es una herramienta entre amigos, pero está en internet. Implementa:

- **Claves**: `scrypt` de `node:crypto` (sin dependencias nativas), sal aleatoria por clave, parámetros guardados junto al hash, comparación con `timingSafeEqual`. Verifica que el coste cabe en el tiempo de ejecución de las funciones de Netlify.
- **Sesiones** en base de datos (se guarda solo el hash del token), cookie `__Host-` con `HttpOnly; Secure; SameSite=Lax; Path=/`, caducidad deslizante de 14 días, revocables.
- **CSRF**: SameSite + comprobación de `Origin` en toda petición que no sea GET, y solo `Content-Type: application/json`.
- **Autorización** en el servidor en cada endpoint (middleware de Astro + comprobación de propiedad del recurso en cada handler). Protege contra IDOR.
- **Limitación de intentos** de login guardada en Postgres (las funciones no comparten memoria). Las IP se guardan solo como HMAC con un secreto y se purgan a las 24 h.
- **XSS**: nada de `v-html`; añade una regla de lint que lo prohíba. Los textos de usuario siempre como texto.
- **Cabeceras** en `netlify.toml` (y/o middleware): CSP lo más estricta que permitan Astro y Vue (documenta cualquier excepción), `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` restrictiva, HSTS, y `Cache-Control: no-store` en `/api` y en páginas autenticadas.
- **No indexación, en tres capas**: `<meta name="robots" content="noindex, nofollow, noarchive">` en el layout base; cabecera `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`; y `robots.txt` con `Disallow: /`. Sin sitemap, sin canonical, sin enlaces desde otros sitios. Todo el contenido está tras el login, así que lo único público es la pantalla de acceso.
- **Secretos** solo en variables de entorno de Netlify. Incluye `.env.example` documentado y `.env` en `.gitignore`.
- Las vistas previas de despliegue **no deben apuntar a la base de datos de producción**: usa ramas/bases separadas si Netlify Database lo permite, o documenta el procedimiento.
- Documenta cómo hacer una **copia de seguridad y restaurar** la base de datos, y comprueba el export del admin.
- Ejecuta `npm audit` y fija versiones.

---

## 7. Diseño de uso (criterio de Don Norman)

Aplica este criterio a todas las pantallas. Si algo es difícil de usar, el fallo es del diseño.

- **Quién lo usa**: personas del medio rural, muchas mayores, casi siempre desde el móvil. Diseño **móvil primero**, texto base de **18 px o más**, contraste WCAG AA, objetivos táctiles de **44 px o más**, etiquetas con palabras (nunca solo iconos), una acción principal por pantalla.
- **Navegación** de 5 elementos: Inicio · Stocks (explorar el stock de todas las familias y el tablón de "se busca") · Mi stock · Trueques (con contador de avisos) · Plaza (chat). Ajustes en el menú del avatar.
- **Prealimentación**: antes de actuar, la persona ve qué va a pasar. Ejemplo: al fijar un valor propio se muestra "Valor recomendado: 4 B. Puedes bajarlo, no subirlo" con controles −/+ cuyo máximo es ese valor; no un error después de equivocarse.
- **Retroalimentación**: confirmaciones visibles tras cada acción ("Artículo añadido a tu stock", "Propuesta enviada a Boteiro"); estados de carga; errores en lenguaje claro con cómo solucionarlos.
- **Propuestas**: composición en pasos con el resumen "Tú das · Recibes · Diferencia" siempre visible y actualizado en vivo.
- **Errores**: prevenir (límites, máximos), detectar (validación en el momento) y recuperar (deshacer en borrados, cancelar propuestas, regenerar código). Ninguna acción destructiva sin confirmación o sin poder deshacerla.
- **Modelo conceptual coherente**: usa siempre las mismas palabras (stock, artículo, se busca, propuesta, trueque, Berenjena) y explica la unidad de cuenta en una pantalla de bienvenida corta ("La Berenjena sirve para comparar valores; no es dinero y no se acumula").
- **Añadir un artículo**: empieza por un buscador; si no hay resultados, el botón "No está en la lista: añadir el mío" aparece justo ahí, en el mismo lugar donde la persona se ha quedado atascada (nunca escondido en un menú). Formulario corto, con ayuda para el valor y vista previa de cómo lo verán las demás familias.
- **Estados vacíos** con una explicación y un botón claro de qué hacer.
- **Identidad visual**: paleta inspirada en la berenjena (morado profundo, crema, verde hoja), logotipo de texto "The Eggplan" y favicon SVG simple. Propón los tokens de diseño en `src/styles` y úsalos de forma consistente.

---

## 8. Modelo de datos (orientativo; ajusta y justifica)

- `users` (id, nick único, rol `member`|`admin`, avatar, password_hash nullable, must_change_password, status, created_at, last_login_at)
- `sessions` (token_hash, user_id, created_at, last_seen_at, expires_at)
- `login_attempts` (key_hash, kind, at)
- `catalog_items` (id, slug único, nombre, categoría, tipo, unidad, ref_value_cb, ref_value_source, perecedero, activo, nota)
- `catalog_value_history` (item_id, old_cb, new_cb, by, at)
- `stock_items` (id, user_id, `catalog_item_id` **nullable**, tipo, cantidad, reservado, unidad, condición, own_value_cb nullable, caduca_el nullable, nota, estado `activo`|`pausado`|`borrado`, y para productos propios: `custom_name`, `custom_category`, `value_status` `catalogo`|`sin_verificar`|`verificado`, `verified_value_cb` nullable, `reviewed_by`, `reviewed_at`, timestamps) — **visible para todas las familias salvo `pausado` y `borrado`**. Restricción: `catalog_item_id` no nulo, **o bien** `custom_name` y `own_value_cb` no nulos.
- `wants` (id, user_id, catalog_item_id nullable, texto_libre, cantidad, nota, estado)
- `trades` (id, proposer_id, receiver_id, estado, parent_trade_id, created_at, updated_at, expires_at, proposer_delivered_at, receiver_delivered_at, completed_at)
- `trade_lines` (id, trade_id, lado, stock_item_id, copia congelada: nombre, unidad, valor_unit_cb, condición, cantidad, valor_sin_verificar bool)
- `trade_messages` (id, trade_id, user_id, cuerpo, created_at) — **privado**
- `notifications` (id, user_id, tipo, payload jsonb, read_at, created_at) — **privado**
- `chat_messages` (id bigserial, user_id, cuerpo, created_at, deleted_at, deleted_by)
- `admin_audit` (id, admin_id, acción, objetivo, payload, at)

Índices y restricciones (claves foráneas, `CHECK` de cantidades y valores no negativos) donde corresponda.

---

## 9. Archivos de datos y configuración (replicabilidad)

- `src/data/config.ts`: nombre de la comunidad, nombre y símbolo de la moneda, número de plazas, nombre del chat, factores de estado, longitud mínima de clave, límites de propuestas y caducidad, retención del chat, intervalos de *polling*, `valorMaximoPropio` y `confirmarValorMayorQue` (productos propios), texto del responsable del tratamiento de datos.
- `src/data/nicks.ts`: la lista de nicks (sección 4.1).
- `src/data/catalogo.ts`: catálogo inicial, **ya elaborado y entregado junto a este prompt** (con su tipo TypeScript, la lista de categorías y todos los productos). Cópialo tal cual al repo y no lo regeneres ni lo recortes. Los valores están en **Berenjenas con decimales** (por ejemplo `0.25`); el cargador los convierte a céntimos enteros (`Math.round(valor * 100)`). El cargador debe ser idempotente (*upsert* por `slug`), respetar los valores editados por el admin (sección 3.2) y no tocar los artículos de stock ya creados. Los productos con `activo: false` se cargan desactivados para que el admin decida si los habilita.
- `public/avatars/`: carpeta de avatares (sección 4.2).

---

## 10. Estructura sugerida

```
src/
  data/            config.ts · nicks.ts · catalogo.ts
  i18n/            es.ts
  lib/             auth/ · db/ · domain/ (valores, estados, reservas) · security/
  middleware.ts
  pages/           index (login) · app/[...] · admin/[...] · normas · api/**
  components/      (islas Vue) · layouts/
  styles/
migrations/        0001_… .sql
scripts/           utilidades (export, comprobaciones)
public/            avatars/ · robots.txt
tests/
netlify.toml
.env.example
README.md
```

---

## 11. Fases y criterios de aceptación

**Fase 0 — Base, acceso y seguridad.** Proyecto, adaptador de Netlify, Tailwind v4, migraciones, plazas y nicks, avatares (carpeta, escaneo, asignación y selector), login por tarjetas, sesiones, middleware, activación con código inicial, cambio de clave obligatorio y voluntario, admin con arranque por variable de entorno, generación de tarjetas imprimibles, limitación de intentos, cabeceras, `noindex`, `robots.txt`.
*Aceptación:* nadie accede sin sesión; una plaza `sin_activar` no puede entrar; el código inicial obliga a elegir clave y la bloquea todo lo demás hasta hacerlo; claves débiles rechazadas; 5 fallos bloquean 15 min; las cabeceras de `noindex` están presentes en todas las respuestas; el admin no tiene ninguna ruta hacia datos privados.

**Fase 1 — Catálogo, stock y Se busca.** Carga del catálogo, CRUD admin con historial, "Mi stock" y "Stocks" (vista por familia y por producto) con la regla del valor, estados de bien, servicios, préstamos, **productos propios** (buscador primero, "No está en la lista", ayuda de valor, etiqueta "valor sin verificar") y su **cola de revisión del admin**, búsquedas.
*Aceptación (con tests):* no se puede fijar un valor propio por encima de `referencia × factor`; bajar la referencia ajusta los artículos; subir la referencia sube los artículos sin valor propio y no los que lo tienen; una familia ve el stock de otra pero no sus artículos pausados ni borrados; un producto propio se publica al instante con la etiqueta de valor sin verificar; tras *verificar*, la familia ya no puede subir su valor por encima del verificado; vincular un producto propio a uno del catálogo aplica referencia × factor y la regla "solo a la baja"; el valor máximo duro se valida en el servidor; la importación del catálogo no pisa valores editados por el admin.

**Fase 2 — Trueques y avisos.** Propuestas, contraofertas, reservas transaccionales, entrega y finalización, préstamos con devolución, hilo privado, caducidad, buzón de avisos.
*Aceptación (con tests):* dos aceptaciones simultáneas sobre el mismo stock no pueden sobrevender; la copia congelada no cambia si cambia la referencia; cancelar después de aceptar libera la reserva; el admin ve metadatos pero no mensajes del hilo.

**Fase 3 — Chat y administración completa.** Chat con *polling*, límites y moderación; panel de métricas; exportación; auditoría; limpieza por retención.
*Aceptación:* el *polling* se detiene con la pestaña oculta; los límites de frecuencia funcionan; los mensajes se escapan correctamente.

**Fase 4 — Pulido.** Página `/normas` con normas de la comunidad y aviso de privacidad breve (como **borrador** que el grupo debe revisar; no es asesoramiento legal), revisión de accesibilidad y de uso en móvil, `README.md` con puesta en marcha, despliegue, copia de seguridad y **lista de pasos para replicar en otra comunidad**.

---

## 12. Fuera de alcance del piloto

Registro público, saldos o crédito, pagos, valoraciones, email o notificaciones push, fotos de artículos (fase futura: una foto reducida en el navegador y guardada en Netlify Blobs), WebSockets, multiempresa en un único despliegue, interfaz en gallego (solo dejar los textos preparados).

---

## 13. Entrega final

Al terminar la Fase 4: `README.md`, `.env.example`, migraciones, tests en verde, y un resumen breve con lo que has decidido por tu cuenta, lo que queda pendiente y los riesgos que ves.
