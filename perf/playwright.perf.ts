import { fileURLToPath } from 'node:url';
import base from '../playwright.config.ts';

/** 성능 측정 전용 설정. `npm run perf` */
export default {
  ...base,
  testDir: '.',
  testMatch: /measure\.spec\.ts/,
  webServer: { ...(base.webServer as object), cwd: fileURLToPath(new URL('..', import.meta.url)) },
};
