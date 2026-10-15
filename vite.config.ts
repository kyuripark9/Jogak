import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  // GitHub Pages 같은 하위 경로에도 그대로 올릴 수 있게 상대 경로로 빌드
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
