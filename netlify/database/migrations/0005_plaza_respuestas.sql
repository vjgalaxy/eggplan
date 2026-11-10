-- Respuestas en la Plaza: a qué mensaje responde cada uno (NULL = mensaje normal).
-- Columna opcional: los mensajes que ya existían quedan como «no responden a nada».
ALTER TABLE chat_messages
  ADD COLUMN respuesta_a integer REFERENCES chat_messages (id) ON DELETE SET NULL;
CREATE INDEX chat_messages_respuesta_idx ON chat_messages (respuesta_a);
