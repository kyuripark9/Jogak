import { fileURLToPath } from 'node:url';
import base from '../playwright.config.ts';

/** Config for performance measurement only. `npm run perf` */
export default {
  ...base,
  testDir: '.',
  testMatch: /measure\.spec\.ts/,
  webServer: { ...(base.webServer as object), cwd: fileURLToPath(new URL('..', import.meta.url)) },
};
