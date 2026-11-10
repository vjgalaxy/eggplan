import { t } from '../i18n/es.ts';
import type { AvisoView } from '../lib/avisos.ts';

/** Texto en lenguaje claro de un aviso y a dónde lleva. Todo se muestra siempre como texto. */
export function avisoInfo(aviso: AvisoView): { texto: string; href: string | null } {
  const p = aviso.payload;
  const nick = typeof p['nick'] === 'string' ? p['nick'] : '';
  const articulo = typeof p['articulo'] === 'string' ? p['articulo'] : '';
  const tradeLink = typeof p['tradeId'] === 'number' ? `/app/trueques/${p['tradeId']}` : '/app/trueques';

  const tipos = t.avisos.tipo as Record<string, (nick: string) => string>;
  const tipoFn = tipos[aviso.tipo];
  if (tipoFn) return { texto: tipoFn(nick), href: tradeLink };

  switch (aviso.tipo) {
    case 'clave_cambiada':
      return { texto: t.avisos.claveCambiada, href: '/app/ajustes' };
    case 'clave_restablecida':
      return { texto: t.avisos.claveRestablecida, href: '/app/ajustes' };
    case 'producto_propio_verificado':
      return { texto: t.avisos.productoVerificado(articulo), href: '/app/mi-stock' };
    case 'producto_propio_ajustado':
      return { texto: t.avisos.productoAjustado(articulo), href: '/app/mi-stock' };
    case 'producto_propio_vinculado':
      return { texto: t.avisos.productoVinculado(articulo, typeof p['producto'] === 'string' ? p['producto'] : ''), href: '/app/mi-stock' };
    case 'producto_propio_oculto':
      return { texto: t.avisos.productoOculto(articulo, typeof p['motivo'] === 'string' ? p['motivo'] : ''), href: '/app/mi-stock' };
    default:
      return { texto: t.avisos.generico, href: null };
  }
}
