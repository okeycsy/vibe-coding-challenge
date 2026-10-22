// 병행검증 기준이 되는 v4 엔진(day01-daeyong-fee-calculator/src/engine)을 reference/v4-engine/ 으로 복사하고 기준 커밋을 적는다.
import { copyFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const src = new URL('../../day01-daeyong-fee-calculator/src/engine/', import.meta.url);
const dst = new URL('../reference/v4-engine/', import.meta.url);
mkdirSync(dst, { recursive: true });
for (const f of ['money.js', 'quarters.js', 'fee.js', 'model.js', 'pipeline.js', 'perfImport.js', 'period.js']) copyFileSync(new URL(f, src), new URL(f, dst));
const commit = execSync('git rev-parse --short HEAD', { cwd: new URL('..', import.meta.url) }).toString().trim();
writeFileSync(new URL('COMMIT.txt', dst), `${commit}\n`);
console.log(`reference/v4-engine ← day01-daeyong-fee-calculator/src/engine (${commit})`);
