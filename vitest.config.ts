import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // scrypt + Postgres en memoria: algunos tests tardan más que el valor por defecto.
    testTimeout: 30_000,
  },
});
