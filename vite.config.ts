import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  // Build with relative paths so it deploys as-is under a subpath like GitHub Pages
  base: './',
  test: { include: ['tests/**/*.test.ts'] },
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        debug: resolve(import.meta.dirname, 'debug.html'),
        quilt: resolve(import.meta.dirname, 'quilt.html'),
      },
    },
  },
});
