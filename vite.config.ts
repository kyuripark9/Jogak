import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // GitHub Pages 같은 하위 경로에도 그대로 올릴 수 있게 상대 경로로 빌드
  base: './',
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        debug: resolve(import.meta.dirname, 'debug.html'),
      },
    },
  },
});
