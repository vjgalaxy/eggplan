import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../../../lib/server.ts';
import { json, jsonError, parseBody } from '../../../../lib/http.ts';
import { updateCatalogItem } from '../../../../lib/catalog/catalog.ts';
import { domainError } from '../../../../lib/stock/messages.ts';
import { cb, optionalText, routeId, singleLine, tipo } from '../../../../lib/stock/schemas.ts';

const schema = z.object({
  nombre: singleLine(2, 120).optional(),
  categoria: z.string().min(1).max(60).optional(),
  tipo: tipo.optional(),
  unidad: singleLine(1, 40).optional(),
  refCb: cb.optional(),
  perecedero: z.boolean().optional(),
  activo: z.boolean().optional(),
  nota: optionalText(300),
});

export const POST: APIRoute = async ({ request, locals, params }) => {
  if (locals.user?.role !== 'admin') return jsonError(403, 'forbidden', 'No tienes permiso para esto.');
  const id = routeId(params['id']);
  if (id === null) return domainError('not_found');
  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;
  const { nombre, categoria, tipo: tipoItem, unidad, refCb, perecedero, activo, nota } = body.data;
  const result = await updateCatalogItem(await db(), locals.user.id, id, {
    ...(nombre === undefined ? {} : { nombre }),
    ...(categoria === undefined ? {} : { categoria }),
    ...(tipoItem === undefined ? {} : { tipo: tipoItem }),
    ...(unidad === undefined ? {} : { unidad }),
    ...(refCb === undefined ? {} : { refCb }),
    ...(perecedero === undefined ? {} : { perecedero }),
    ...(activo === undefined ? {} : { activo }),
    ...(nota === undefined ? {} : { nota }),
  });
  return result.ok ? json({ ok: true }) : domainError(result.code);
};
