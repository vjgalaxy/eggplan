/**
 * Sondeo (polling) que SOLO corre con la pestaña visible: al ocultarse se detiene, y al volver a
 * verse consulta en el acto y reanuda el intervalo. Las dependencias del navegador se inyectan
 * para poder probarlo sin navegador.
 */
export interface PollerEnv {
  isVisible(): boolean;
  onVisibilityChange(handler: () => void): () => void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
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
  };
}

/** Arranca el sondeo. Devuelve la función para pararlo del todo. */
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
