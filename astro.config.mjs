import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import vue from '@astrojs/vue';
import tailwindcss from '@tailwindcss/vite';
import { avatarsPlugin } from './scripts/vite-avatars.mjs';

// https://astro.build/config
export default defineConfig({
  // Todo se renderiza bajo demanda (SSR): la app es privada y siempre depende de la sesión.
  output: 'server',
  adapter: netlify(),
  integrations: [vue()],
  // Sin servicios de terceros: nada de analítica ni fuentes externas.
  devToolbar: { enabled: false },
  security: {
    // CSP por <meta> con hashes de los scripts/estilos en línea que genera Astro (islas, etc.).
    // Las directivas que no pueden ir en <meta> (frame-ancestors…) se envían por cabecera
    // desde src/middleware.ts. Ver docs en README.
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
    },
  },
  vite: {
    plugins: [tailwindcss(), avatarsPlugin()],
  },
});
