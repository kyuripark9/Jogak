/**
 * 첫 화면 데모용 샘플 사진 (public/demo). 나중에 Mason의 사진으로 바꾸려면
 * 이 폴더에 사진을 넣고 manifest.json의 목록(오래된 순, 찍은 날짜)을 고치면 된다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scenePhoto } from '../src/synth/profile.ts';
import { png } from './png.ts';

const out = join(import.meta.dirname, '..', 'public', 'demo');
mkdirSync(out, { recursive: true });

// 같은 날 같은 장면을 여러 장 찍은 앨범처럼: [장면, 그날 사진 수, 날짜]
const days: [number, number, string][] = [
  [4, 3, '2024-04-06'], [0, 2, '2024-05-18'], [2, 1, '2024-06-02'], [1, 4, '2024-07-21'],
  [7, 2, '2024-08-15'], [3, 3, '2024-09-14'], [6, 2, '2024-10-27'], [2, 1, '2024-11-09'],
  [5, 3, '2025-01-12'], [4, 2, '2025-04-03'], [0, 1, '2025-06-28'],
];
const manifest: { src: string; date: string }[] = [];
let n = 0;
for (const [scene, count, date] of days) {
  for (let k = 0; k < count; k++) {
    const name = `${String(++n).padStart(2, '0')}.png`;
    writeFileSync(join(out, name), png(scenePhoto(320, 400, scene, n * 13 + 1)));
    manifest.push({ src: name, date });
  }
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`demo → ${out} (${n}장)`);
