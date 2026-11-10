/**
 * Sondeo (polling) que SOLO corre con la pestaña visible. Netlify Functions no admite WebSockets,
 * así que la «inmediatez» se consigue consultando a menudo, pero solo cuando tiene sentido:
 *
 *  - `startVisiblePolling`: intervalo fijo; se para al ocultar la pestaña y al volver consulta en el acto.
 *  - `startAdaptivePolling`: rápido mientras hay actividad (llegan cosas nuevas, la persona escribe,
 *    pulsa o vuelve a la pestaña) y más espaciado tras un rato de calma. `poke()` consulta en el acto
 *    (p. ej. justo después de enviar) y `active()` marca actividad sin consultar todavía.
 *
 * Las dependencias del navegador se inyectan para poder probarlo sin navegador.
 */
export interface PollerEnv {
  isVisible(): boolean;
  onVisibilityChange(handler: () => void): () => void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export function browserEnv(): PollerEnv {
  return {
    isVisible: () => document.visibilityState === 'visible',
    onVisibilityChange(handler) {
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    },
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (handle) => window.clearInterval(handle as number),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    now: () => Date.now(),
  };
}

/** Sondeo de intervalo fijo. Devuelve la función para pararlo del todo. */
export function startVisiblePolling(run: () => void, intervalMs: number, env: PollerEnv = browserEnv()): () => void {
  let handle: unknown = null;
  const start = () => {
    if (handle === null) handle = env.setInterval(run, intervalMs);
  };
  const stop = () => {
    if (handle !== null) env.clearInterval(handle);
    handle = null;
  };
  const unsubscribe = env.onVisibilityChange(() => {
    if (env.isVisible()) {
      run(); // al volver, se pone al día en el acto
      start();
    } else {
      stop();
    }
  });
  if (env.isVisible()) start();
  return () => {
    stop();
    unsubscribe();
  };
}

export interface AdaptiveOptions {
  /** Intervalo mientras hay actividad. */
  fastMs: number;
  /** Intervalo en calma. */
  slowMs: number;
  /** Tiempo sin actividad tras el que se pasa al intervalo de calma. */
  idleAfterMs: number;
}

export interface AdaptivePoller {
  stop(): void;
  /** Consulta ya (y marca actividad). */
  poke(): void;
  /** Marca actividad: si estaba en calma, vuelve al intervalo rápido. */
  active(): void;
}

/**
 * Sondeo adaptativo. `run` devuelve true si ha llegado algo nuevo (eso cuenta como actividad).
 * Nunca hay dos consultas a la vez: la siguiente se programa cuando termina la anterior.
 */
export function startAdaptivePolling(
  run: () => Promise<boolean> | boolean,
  options: AdaptiveOptions,
  env: PollerEnv = browserEnv(),
): AdaptivePoller {
  let lastActivity = env.now();
  let timer: unknown = null;
  let running = false;
  let stopped = false;
  let pendingPoke = false;

  const clear = () => {
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
  };
  const delay = () => (env.now() - lastActivity < options.idleAfterMs ? options.fastMs : options.slowMs);
  const schedule = () => {
    clear();
    if (stopped || !env.isVisible()) return;
    timer = env.setTimeout(() => void tick(), delay());
  };
  async function tick() {
    timer = null;
    if (stopped || !env.isVisible()) return;
    if (running) {
      pendingPoke = true;
      return;
    }
    running = true;
    try {
      if (await run()) lastActivity = env.now();
    } catch {
      // Un fallo de red no para el sondeo: se reintenta en el siguiente turno.
    } finally {
      running = false;
    }
    if (pendingPoke) {
      pendingPoke = false;
      void tick();
    } else {
      schedule();
    }
  }

  const unsubscribe = env.onVisibilityChange(() => {
    if (env.isVisible()) {
      lastActivity = env.now(); // volver a la pestaña es actividad: se pone al día en el acto
      clear();
      void tick();
    } else {
      clear();
    }
  });
  schedule();

  return {
    stop() {
      stopped = true;
      clear();
      unsubscribe();
    },
    poke() {
      lastActivity = env.now();
      clear();
      void tick();
    },
    active() {
      const wasIdle = env.now() - lastActivity >= options.idleAfterMs;
      lastActivity = env.now();
      if (wasIdle) schedule(); // de calma a rápido sin esperar al turno lento
    },
  };
}
