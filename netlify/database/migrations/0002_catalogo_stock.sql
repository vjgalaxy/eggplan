-- Fase 1: catálogo, stock (artículos, incluidos los productos propios) y "Se busca".
-- Las migraciones aplicadas no se editan nunca: los cambios van en una migración nueva.
-- Todos los valores en Berenjenas se guardan como enteros en centésimas (cB). Nunca float.

CREATE TABLE categories (
  slug   text PRIMARY KEY,
  nombre text NOT NULL,
  orden  integer NOT NULL
);
-- "Otros" existe siempre: la crea esta migración, no el archivo del catálogo.
INSERT INTO categories (slug, nombre, orden) VALUES ('otros', 'Otros', 9999);

CREATE TABLE catalog_items (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug             text NOT NULL UNIQUE,
  nombre           text NOT NULL CHECK (char_length(nombre) BETWEEN 2 AND 120),
  category_slug    text NOT NULL REFERENCES categories (slug),
  tipo             text NOT NULL CHECK (tipo IN ('bien', 'servicio', 'prestamo')),
  unidad           text NOT NULL CHECK (char_length(unidad) BETWEEN 1 AND 40),
  ref_value_cb     integer NOT NULL CHECK (ref_value_cb >= 0),
  -- Procedencia del valor de referencia: la carga inicial (seed) o el administrador (admin).
  ref_value_source text NOT NULL DEFAULT 'seed' CHECK (ref_value_source IN ('seed', 'admin')),
  perecedero       boolean NOT NULL DEFAULT false,
  activo           boolean NOT NULL DEFAULT true,
  nota             text,
  -- true en cuanto el administrador toca el producto: el cargador del catálogo ya no lo modifica.
  edited_by_admin  boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalog_items_category_idx ON catalog_items (category_slug);

CREATE TABLE catalog_value_history (
  id       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id  integer NOT NULL REFERENCES catalog_items (id) ON DELETE CASCADE,
  old_cb   integer,
  new_cb   integer NOT NULL,
  by_user  integer NOT NULL REFERENCES users (id),
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalog_value_history_item_idx ON catalog_value_history (item_id, at DESC);

-- Stock: un artículo = una línea del stock de una familia. Visible para todas las familias con
-- sesión salvo los pausados y borrados (los filtra siempre el servidor).
CREATE TABLE stock_items (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- NULL en los productos propios (los que no están en el catálogo).
  catalog_item_id   integer REFERENCES catalog_items (id),
  tipo              text NOT NULL CHECK (tipo IN ('bien', 'servicio', 'prestamo')),
  cantidad          numeric(10, 2) NOT NULL CHECK (cantidad >= 0),
  reservado         numeric(10, 2) NOT NULL DEFAULT 0 CHECK (reservado >= 0),
  unidad            text NOT NULL CHECK (char_length(unidad) BETWEEN 1 AND 40),
  -- Solo bienes: nuevo | bueno | usado | para_reparar. En productos propios es informativo.
  condicion         text CHECK (condicion IS NULL OR condicion IN ('nuevo', 'bueno', 'usado', 'para_reparar')),
  -- Valor propio por unidad (cB). En artículos del catálogo es opcional y solo puede bajar.
  own_value_cb      integer CHECK (own_value_cb IS NULL OR own_value_cb >= 0),
  caduca_el         date,
  nota              text CHECK (nota IS NULL OR char_length(nota) <= 200),
  estado            text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'pausado', 'borrado')),
  -- Para poder deshacer un borrado unos segundos (borrado lógico).
  estado_previo     text CHECK (estado_previo IS NULL OR estado_previo IN ('activo', 'pausado')),
  deleted_at        timestamptz,
  -- Productos propios
  custom_name       text CHECK (custom_name IS NULL OR char_length(custom_name) BETWEEN 3 AND 60),
  custom_category   text REFERENCES categories (slug),
  value_status      text NOT NULL DEFAULT 'catalogo' CHECK (value_status IN ('catalogo', 'sin_verificar', 'verificado')),
  verified_value_cb integer CHECK (verified_value_cb IS NULL OR verified_value_cb >= 0),
  reviewed_by       integer REFERENCES users (id),
  reviewed_at       timestamptz,
  -- Motivo si la administración ocultó el artículo (pausado por revisión).
  hidden_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (reservado <= cantidad),
  -- Catálogo, o bien producto propio con nombre y valor.
  CHECK (catalog_item_id IS NOT NULL OR (custom_name IS NOT NULL AND own_value_cb IS NOT NULL)),
  CHECK ((value_status = 'catalogo') = (catalog_item_id IS NOT NULL)),
  CHECK (value_status <> 'verificado' OR verified_value_cb IS NOT NULL)
);
CREATE INDEX stock_items_user_idx ON stock_items (user_id);
CREATE INDEX stock_items_catalog_idx ON stock_items (catalog_item_id);
-- Un mismo producto del catálogo no se repite en el stock de una familia (salvo con otro estado del bien).
CREATE UNIQUE INDEX stock_items_unique_catalog_idx
  ON stock_items (user_id, catalog_item_id, COALESCE(condicion, ''))
  WHERE catalog_item_id IS NOT NULL AND estado <> 'borrado';
-- Cola de revisión del administrador: productos propios sin verificar, por antigüedad.
CREATE INDEX stock_items_review_idx ON stock_items (created_at)
  WHERE catalog_item_id IS NULL AND value_status = 'sin_verificar' AND estado = 'activo';

-- "Se busca": lo que las familias necesitan.
CREATE TABLE wants (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  catalog_item_id integer REFERENCES catalog_items (id),
  texto_libre     text CHECK (texto_libre IS NULL OR char_length(texto_libre) BETWEEN 3 AND 80),
  cantidad        numeric(10, 2) CHECK (cantidad IS NULL OR cantidad > 0),
  unidad          text CHECK (unidad IS NULL OR char_length(unidad) BETWEEN 1 AND 40),
  nota            text CHECK (nota IS NULL OR char_length(nota) <= 200),
  estado          text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  CHECK (catalog_item_id IS NOT NULL OR texto_libre IS NOT NULL)
);
CREATE INDEX wants_open_idx ON wants (created_at DESC) WHERE estado = 'abierta';
CREATE INDEX wants_user_idx ON wants (user_id);
CREATE INDEX wants_catalog_idx ON wants (catalog_item_id);
