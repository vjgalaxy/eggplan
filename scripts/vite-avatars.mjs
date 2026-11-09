// Plugin de Vite: expone la lista de archivos de public/avatars/ como el módulo virtual
// `virtual:eggplan-avatars`. Se calcula al compilar (y al arrancar el servidor de desarrollo),
// de modo que añadir un archivo a la carpeta añade una opción sin tocar código.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const VIRTUAL_ID = 'virtual:eggplan-avatars';
const RESOLVED_ID = '\0' + VIRTUAL_ID;
const EXTENSIONS = /\.(svg|webp|png)$/i;

export function avatarsPlugin() {
  const dir = resolve(process.cwd(), 'public/avatars');
  return {
    name: 'eggplan-avatars',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      let files = [];
      try {
        files = readdirSync(dir).filter((f) => EXTENSIONS.test(f)).sort((a, b) => a.localeCompare(b, 'es'));
      } catch {
        files = [];
      }
      return `export default ${JSON.stringify(files)};`;
    },
  };
}
