-- Fase 2: trueques (propuestas), líneas con copia congelada, hilo privado y avisos.
-- Las migraciones aplicadas no se editan nunca: los cambios van en una migración nueva.

CREATE TABLE trades (
  id                    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proposer_id           integer NOT NULL REFERENCES users (id),
  receiver_id           integer NOT NULL REFERENCES users (id),
  estado                text NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente', 'aceptada', 'rechazada', 'cancelada', 'caducada', 'contraofertada', 'completada')),
  -- La contraoferta es una propuesta nueva enlazada con la que sustituye.
  parent_trade_id       integer REFERENCES trades (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  responded_at          timestamptz,
  proposer_delivered_at timestamptz,
  receiver_delivered_at timestamptz,
  completed_at          timestamptz,
  CHECK (proposer_id <> receiver_id)
);
CREATE INDEX trades_proposer_idx ON trades (proposer_id, estado);
CREATE INDEX trades_receiver_idx ON trades (receiver_id, estado);
CREATE INDEX trades_expiry_idx ON trades (expires_at) WHERE estado = 'pendiente';
CREATE INDEX trades_parent_idx ON trades (parent_trade_id);

-- Cada línea guarda una COPIA CONGELADA del artículo (nombre, unidad, valor, estado) en el momento
-- de crear la propuesta: aunque cambie después la referencia del catálogo, la propuesta no cambia.
CREATE TABLE trade_lines (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trade_id          integer NOT NULL REFERENCES trades (id) ON DELETE CASCADE,
  -- Quién DA esta línea: la parte que propone o la que recibe la propuesta.
  lado              text NOT NULL CHECK (lado IN ('proposer', 'receiver')),
  stock_item_id     integer REFERENCES stock_items (id) ON DELETE SET NULL,
  tipo              text NOT NULL CHECK (tipo IN ('bien', 'servicio', 'prestamo')),
  nombre            text NOT NULL,
  unidad            text NOT NULL,
  valor_unit_cb     integer NOT NULL CHECK (valor_unit_cb >= 0),
  condicion         text CHECK (condicion IS NULL OR condicion IN ('nuevo', 'bueno', 'usado', 'para_reparar')),
  cantidad          numeric(10, 2) NOT NULL CHECK (cantidad > 0),
  valor_sin_verificar boolean NOT NULL DEFAULT false,
  -- true mientras esta línea tiene su cantidad reservada en el stock (propuesta aceptada, o préstamo sin devolver).
  reservado_activo  boolean NOT NULL DEFAULT false,
  -- Préstamos: cuándo lo marcó como devuelto quien lo prestó.
  returned_at       timestamptz
);
CREATE INDEX trade_lines_trade_idx ON trade_lines (trade_id);
CREATE INDEX trade_lines_stock_idx ON trade_lines (stock_item_id);

-- PRIVADO: solo lo ven las dos partes. Ninguna consulta ni pantalla de administración lo lee.
CREATE TABLE trade_messages (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trade_id   integer NOT NULL REFERENCES trades (id) ON DELETE CASCADE,
  user_id    integer NOT NULL REFERENCES users (id),
  cuerpo     text NOT NULL CHECK (char_length(cuerpo) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trade_messages_trade_idx ON trade_messages (trade_id, id);

-- Avisos sin leer de cada familia (contador por polling).
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
