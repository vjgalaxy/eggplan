import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMON_HEADERS, CSP_HEADER, applySecurityHeaders } from '../src/lib/security/headers.ts';

const root = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const sourceFiles = walk(join(root, 'src')).filter((f) => /\.(vue|astro|ts)$/.test(f));
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('XSS: nada de HTML en bruto', () => {
  it('no hay v-html, set:html, innerHTML ni similares en src/', () => {
    const offenders = sourceFiles.filter((file) => /v-html|set:html|\.innerHTML|\.outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('no indexación en tres capas', () => {
  it('meta robots en el layout base', () => {
    expect(read('src/layouts/Base.astro')).toMatch(/<meta name="robots" content="noindex, nofollow, noarchive"/);
  });
  it('cabecera X-Robots-Tag en respuestas dinámicas y en netlify.toml', () => {
    expect(COMMON_HEADERS['X-Robots-Tag']).toBe('noindex, nofollow, noarchive, nosnippet');
    expect(read('netlify.toml')).toContain('X-Robots-Tag = "noindex, nofollow, noarchive, nosnippet"');
  });
  it('robots.txt con Disallow: /', () => {
    expect(read('public/robots.txt')).toMatch(/Disallow: \/\s*$/m);
  });
  it('no hay sitemap ni canonical', () => {
    expect(sourceFiles.filter((f) => /rel="canonical"|sitemap/i.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});

describe('cabeceras de seguridad', () => {
  it('netlify.toml (estático) y el middleware (dinámico) llevan las mismas cabeceras', () => {
    const toml = read('netlify.toml');
    for (const [name, value] of Object.entries(COMMON_HEADERS)) {
      expect(toml, name).toContain(`${name} = "${value}"`);
    }
    expect(toml).toContain(`Content-Security-Policy = "${CSP_HEADER}"`);
  });

  it('se aplican a la respuesta, con no-store y fusionando con una CSP previa', () => {
    const response = applySecurityHeaders(new Response('ok', { headers: { 'Content-Security-Policy': "default-src 'self'" } }), { noStore: true });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Strict-Transport-Security')).toMatch(/max-age=\d+/);
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe('secretos', () => {
  it('.env está en .gitignore y existe .env.example', () => {
    expect(read('.gitignore')).toMatch(/^\.env$/m);
    expect(read('.env.example')).toContain('APP_SECRET');
  });
  it('el código no escribe claves ni cuerpos en logs', () => {
    const offenders = sourceFiles.filter((f) => /console\.(log|info|debug)/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('el admin no tiene rutas hacia datos privados', () => {
  it('ningún endpoint de admin toca sesiones, avisos, mensajes ni hashes', () => {
    const adminFiles = sourceFiles.filter(
      (f) => /[\\/]api[\\/]admin[\\/]/.test(f) || /lib[\\/]auth[\\/]admin\.ts$/.test(f) || /lib[\\/]trades[\\/]metadata\.ts$/.test(f),
    );
    expect(adminFiles.length).toBeGreaterThan(0);
    for (const file of adminFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/FROM\s+(sessions|notifications|trade_messages)\b/i);
      expect(source, file).not.toMatch(/JOIN\s+(sessions|notifications|trade_messages)\b/i);
      // Ni siquiera pueden importar el módulo del hilo de mensajes ni el del buzón de avisos.
      expect(source, file).not.toMatch(/from\s+['"][^'"]*(trades[\\/]trades|avisos)(\.ts)?['"]/);
      // Los hashes solo se usan para saber si existe credencial (IS NULL / IS NOT NULL), nunca se seleccionan.
      expect(source, file).not.toMatch(/SELECT[^;]*\bpassword_hash\b(?!\s+IS)/is);
    }
  });
});
