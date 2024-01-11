import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  splitting: false,
  dts: true,
  sourcemap: true,
  shims: true,
  clean: true,
});
