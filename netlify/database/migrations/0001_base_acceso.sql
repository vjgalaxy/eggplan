-- Fase 0: usuarios (plazas + admin), sesiones, intentos de acceso, avisos y auditoría.
-- Las migraciones aplicadas no se editan nunca: los cambios van en una migración nueva.
-- (Ubicación exigida por Netlify Database: netlify/database/migrations/.)

CREATE TABLE users (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Número de plaza (1..N). NULL para la cuenta de administración.
  seat                 integer UNIQUE CHECK (seat IS NULL OR seat > 0),
  nick                 text    NOT NULL CHECK (char_length(nick) BETWEEN 3 AND 20),
  role                 text    NOT NULL CHECK (role IN ('member', 'admin')),
  -- Nombre del archivo en public/avatars/ (se valida contra la lista en el servidor).
  avatar               text,
  -- Hash scrypt de la clave, o del código inicial mientras must_change_password = true.
  password_hash        text,
  must_change_password boolean NOT NULL DEFAULT false,
  -- sin_activar: sin código aún, o con código emitido pero todavía no usado.
  -- bloqueado: por el administrador. (El bloqueo temporal por intentos se calcula en login_attempts.)
  status               text    NOT NULL DEFAULT 'sin_activar'
                               CHECK (status IN ('sin_activar', 'activo', 'bloqueado')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  last_login_at        timestamptz,
  password_changed_at  timestamptz,
  CHECK ((role = 'admin') = (seat IS NULL))
);
CREATE UNIQUE INDEX users_nick_lower_idx ON users (lower(nick));
CREATE UNIQUE INDEX users_single_admin_idx ON users (role) WHERE role = 'admin';

CREATE TABLE sessions (
  -- Solo se guarda el hash (SHA-256) del token; el token solo existe en la cookie.
  token_hash   text PRIMARY KEY,
  user_id      integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Fallos de acceso (kind nick/ip) y bloqueos temporales (kind lock). key_hash es siempre un HMAC (del nick o de la IP), nunca el dato en claro.
CREATE TABLE login_attempts (
  id       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key_hash text NOT NULL,
  kind     text NOT NULL CHECK (kind IN ('nick', 'ip', 'lock')),
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_key_idx ON login_attempts (key_hash, at);
CREATE INDEX login_attempts_at_idx ON login_attempts (at);

-- Avisos personales de cada familia. PRIVADO: ningún endpoint ni pantalla de admin los lee.
CREATE TABLE notifications (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tipo       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE admin_audit (
  id        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id  integer NOT NULL REFERENCES users (id),
  accion    text NOT NULL,
  objetivo  text,
  payload   jsonb NOT NULL DEFAULT '{}'::jsonb,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_at_idx ON admin_audit (at DESC);
