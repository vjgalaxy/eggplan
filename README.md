# The Eggplan

Aplicación web privada para un grupo pequeño de familias rurales: cada familia mantiene su **stock**, todas lo ven, se proponen trueques en **Berenjenas** (unidad de cuenta, no dinero) y se charla en un chat comunitario. Diseñada por Identidad Rural. Especificación completa: [the-eggplan-prompt.md](the-eggplan-prompt.md).

> **Estado: Fase 0 (base, acceso y seguridad).** Faltan catálogo y stock (Fase 1), trueques (Fase 2), chat y administración completa (Fase 3) y pulido (Fase 4). Este README se completará en la Fase 4.

## Stack

Astro 6 (SSR con `@astrojs/netlify`) · Vue 3 (islas) · Tailwind CSS v4 (`@tailwindcss/vite`) · Netlify Database (Postgres, `@netlify/database`) · `zod` · `vitest`.

## Puesta en marcha local

Requisitos: Node ≥ 22.12 y Netlify CLI ≥ 26 (`npm i -g netlify-cli`).

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

`npm audit` marca `astro@6.4.8` (RCE en la optimización de imágenes AVIF, XSS en transiciones/JSX, bypass con `base`): las correcciones están en **Astro ≥ 7.3.8**, que exige **Node ≥ 22.23.4**. La app no usa optimización de imágenes de Astro, transiciones, MDX ni `base`, pero conviene migrar en cuanto se actualice Node: `npm i astro@7.4.8 @astrojs/netlify@8.2.12 @astrojs/vue@7.1.2` (y fijar `NODE_VERSION` en Netlify). El resto de avisos viene de dependencias de `@astrojs/netlify` (herramientas de empaquetado en tiempo de build, no del código que se ejecuta en producción).
