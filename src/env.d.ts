/// <reference types="astro/client" />

declare module 'virtual:eggplan-avatars' {
  /** Nombres de archivo de public/avatars/ (calculado al compilar). */
  const avatars: string[];
  export default avatars;
}

declare namespace App {
  interface Locals {
    /** Usuario con sesión válida (sin datos sensibles), o null. */
    user: import('./lib/auth/users.ts').PublicUser | null;
    /** Hash del token de la sesión actual (para cerrar "todas las demás"). */
    tokenHash: string | null;
  }
}
