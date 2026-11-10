# The Eggplan

Aplicación web privada para un grupo pequeño de familias rurales: cada familia mantiene su **stock**, todas lo ven, se proponen trueques en **Berenjenas** (unidad de cuenta, no dinero) y se charla en un chat comunitario. Diseñada por Identidad Rural. Especificación completa: [the-eggplan-prompt.md](the-eggplan-prompt.md).

> **Estado: Fase 1 (catálogo, stock y «Se busca»).** Hecho: acceso y seguridad (Fase 0), catálogo, Mi stock, Stocks, productos propios con cola de revisión y «Se busca» (Fase 1). Faltan trueques (Fase 2), chat y administración completa (Fase 3) y pulido (Fase 4). Este README se completará en la Fase 4.

## Stack

Astro 7 (SSR con `@astrojs/netlify`) · Vue 3 (islas) · Tailwind CSS v4 (`@tailwindcss/vite`) · Netlify Database (Postgres, `@netlify/database`) · `zod` · `vitest`.

## Puesta en marcha local

Requisitos: Node ≥ 22.23.4 (Astro 7; en Netlify se fija `NODE_VERSION = "24"` en `netlify.toml`) y Netlify CLI ≥ 26 (`npm i -g netlify-cli`).

```bash
npm install
cp .env.example .env        # y rellena ADMIN_BOOTSTRAP_PASSWORD y APP_SECRET
netlify database migrations apply   # aplica netlify/database/migrations/ a la base local
netlify dev                 # http://localhost:8888 (arranca Postgres local y Astro)
```

- Web de familias: `/` · administración: `/admin/login` (usuario fijo `admin`, clave = `ADMIN_BOOTSTRAP_PASSWORD`; se obliga a cambiarla al entrar).
- Las **20 plazas** se crean solas (idempotente) la primera vez que se visita `/` o `/admin/login`, a partir de `src/data/nicks.ts`.
- En el panel de admin, **«Generar códigos iniciales»** crea un código por plaza (p. ej. `berenjena-4821`), mostrado **una sola vez** con tarjetas imprimibles. La familia entra con él y elige su propia clave.

### Scripts

| Comando | Qué hace |
|---|---|
| `npm run verify` | typecheck (`astro check` + `vue-tsc`), lint, tests y build |
| `npm test` | tests (Postgres real en memoria con PGlite, sin necesidad de red) |
| `npm run lint` | ESLint (incluye `vue/no-v-html: error`) |

## Variables de entorno (Netlify → Site configuration → Environment variables)

| Variable | Uso |
|---|---|
| `ADMIN_BOOTSTRAP_PASSWORD` | Crea la cuenta `admin` la primera vez (≥ 12 caracteres). Se puede borrar después. |
| `APP_SECRET` | Secreto (≥ 32 caracteres) para firmar con HMAC nicks e IP de los intentos de acceso. Obligatorio en producción. |
| `NETLIFY_DB_URL` | La inyecta Netlify (producción, vistas previas y `netlify dev`). No se define a mano. |

## Datos de la comunidad (replicabilidad)

Nada específico de Ourense está en el código: `src/data/config.ts`, `src/data/nicks.ts`, `src/data/catalogo.ts` y `public/avatars/`. Añadir un archivo a `public/avatars/` añade una opción de avatar (se escanea al compilar).

## Catálogo y stock (Fase 1)

**Dónde vive el catálogo.** `src/data/catalogo.ts` es la *fuente inicial*; la verdad en funcionamiento está en Postgres (`catalog_items`), porque el administrador lo edita, hay historial de valores y los artículos de las familias apuntan a sus filas. Al arrancar, el servidor carga el archivo de forma idempotente (`src/lib/catalog/loader.ts`):

- Upsert por `slug`; ejecutarlo varias veces no cambia nada. Convierte los valores a céntimos enteros (`Math.round(valor × 100)`).
- **Nunca pisa lo que ha tocado el administrador**: en cuanto edita un producto (valor, nombre, activo…), queda marcado `edited_by_admin` y el cargador ya no lo modifica. Los productos sin editar sí se actualizan con lo que diga el archivo (así se corrigen erratas). No toca los artículos de stock ya creados.
- Los productos con `activo: false` se cargan desactivados. La categoría «Otros» la crea la migración.

**Reglas de valor** (`src/lib/domain/values.ts`, probadas en `tests/`; todo se valida en el servidor):

- Valor efectivo de un artículo del catálogo = `min(valor propio, referencia × factor de estado)`; sin valor propio, `referencia × factor`. Se calcula al leer, no se guarda: si el admin baja la referencia, los artículos se ajustan solos; si la sube, suben los que no tienen valor propio y no los que sí.
- La familia puede bajar el valor, nunca subirlo por encima de `referencia × factor`.
- Producto propio: se publica al instante con la etiqueta «Producto propio · valor sin verificar». Tope duro `valorMaximoPropio` (1000 B) y confirmación por encima de `confirmarValorMayorQue` (100 B), ambos en `config.ts`. Tras *verificar*, el valor efectivo es `min(propio, verificado)`. *Ajustar* fija también el valor del artículo; *vincular* aplica referencia × factor y «solo a la baja»; *crear en el catálogo* crea el producto y vincula el artículo; *ocultar* lo pausa con motivo. Cada acción avisa a la familia (tabla `notifications`, privada) y queda en `admin_audit`.
- Borrar es lógico y se puede deshacer `deshacerSegundos` (30 s). No se puede pausar, borrar ni bajar la cantidad por debajo de lo reservado en trueques (las reservas llegan en la Fase 2).
- Los artículos pausados y borrados nunca salen en el listado de las demás familias (lo filtra la consulta del servidor); tampoco el stock de plazas bloqueadas.

**Panel de administración.** Pestañas Plazas · Catálogo (crear, editar, activar/desactivar, historial de valor: anterior, nuevo, quién y cuándo) · Por revisar (cola de productos propios, los más antiguos primero). Los cambios de valor que hace la carga inicial no generan historial; solo los del administrador.

**Datos de la comunidad.** Los sinónimos del buscador están en `src/data/sinonimos.ts`; las unidades habituales y los límites, en `src/data/config.ts`.

## Seguridad (resumen de la Fase 0)

- Claves con `scrypt` (N=2¹⁵, r=8, p=1, sal aleatoria, parámetros junto al hash). Sin clave por defecto compartida.
- Sesiones en base de datos (solo el hash SHA-256 del token), cookie `__Host-eggplan_sid` (`HttpOnly; Secure; SameSite=Lax; Path=/`) con caducidad deslizante de 14 días. En `localhost` (http) se usa `eggplan_sid` sin `Secure`.
- CSRF: `SameSite` + comprobación de `Origin` + solo `application/json` en todo lo que no sea GET.
- Límite de intentos en Postgres: 5 fallos por nick → bloqueo de 15 min; 30 por IP (HMAC) → bloqueo; purga a las 24 h.
- No indexación en tres capas (meta, `X-Robots-Tag`, `robots.txt`).
- CSP: Astro añade por `<meta>` `default-src`/`script-src`/`style-src` con hashes; `frame-ancestors` y el resto van por cabecera (middleware y `netlify.toml`).
- El administrador no tiene ninguna ruta hacia claves, sesiones, mensajes de propuestas ni avisos personales (hay tests que lo vigilan).

## Copia de seguridad (provisional)

Pendiente de contrastar con la documentación oficial en la Fase 4. Según la guía de Netlify consultada, hay instantáneas (snapshots) por la API REST de Netlify (`POST /sites/{site_id}/database/snapshot`, `GET …/snapshots`, `POST …/snapshot/{id}/restore`) y exportación con `pg_dump` usando la cadena de conexión de `netlify database connect --json`. La exportación de datos no privados del admin llega en la Fase 3.

## Avisos de seguridad de dependencias (a revisar)

El proyecto está en **Astro 7.4.8** (`@astrojs/netlify` 8.2.12, `@astrojs/vue` 7.1.2), que corrige los avisos de `astro@6` (RCE en la optimización AVIF, XSS en transiciones/JSX, bypass con `base`). `npm audit --omit=dev` aún marca avisos moderados (`deepmerge`, `glob`, `minimatch`) en dependencias de `@astrojs/netlify` (empaquetado en tiempo de build, no código que se ejecute con peticiones de usuarios); se resolverán cuando el adaptador los actualice. Revisa `npm audit` de vez en cuando.
