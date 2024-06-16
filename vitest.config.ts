import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    typecheck: {
      enabled: true,
      include: ['src/**/*.{test,spec}-d.ts'],
    },
  },
});
