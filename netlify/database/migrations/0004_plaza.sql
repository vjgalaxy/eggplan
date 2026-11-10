-- Fase 3 (parte): la Plaza, chat comunitario de sala única.
-- Las migraciones aplicadas no se editan nunca: los cambios van en una migración nueva.

CREATE TABLE chat_messages (
  -- integer basta para el piloto (2.000 millones de mensajes) y llega a JS como número.
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- anuncio: mensaje de la administración, con estilo diferenciado.
  kind       text NOT NULL DEFAULT 'mensaje' CHECK (kind IN ('mensaje', 'anuncio')),
  -- NULL cuando el mensaje se ha borrado: el texto no se conserva.
  cuerpo     text CHECK (cuerpo IS NULL OR char_length(cuerpo) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by integer REFERENCES users (id) ON DELETE SET NULL,
  CHECK ((deleted_at IS NULL) = (cuerpo IS NOT NULL))
);
CREATE INDEX chat_messages_created_idx ON chat_messages (created_at);
CREATE INDEX chat_messages_user_idx ON chat_messages (user_id, created_at DESC);
CREATE INDEX chat_messages_deleted_idx ON chat_messages (deleted_at) WHERE deleted_at IS NOT NULL;
