// 병행검증: 같은 입력으로 이 프로토타입 엔진과 v4 엔진(reference/v4-engine, 복사본)을 돌려 기관별 금액을 비교한다.
// 예시 업무 2개 + 시드 고정 무작위 업무 N개. 차이가 있으면 어느 기관·어느 항목이 다른지 출력하고 종료 코드 1.
import { readFileSync } from 'node:fs';
import { runBusiness as runProto } from '../rules/run.js';
import { runBusiness as runV4 } from '../reference/v4-engine/pipeline.js';
import { sampleBusinesses, newBusiness } from '../rules/model.js';
import { toV4Business, compareRuns } from '../rules/compat.js';

const N = Number(process.argv[2] ?? 300);
let seed = Number(process.argv[3] ?? 20261022);
const rand = () => {
  // mulberry32
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

function randomBusiness(i) {
  const b = newBusiness(`무작위 ${i}`);
  const n = int(2, 15);
  b.orgs = Array.from({ length: n }, (_, k) => ({ id: `o${k}`, name: k === n - 1 && rand() < 0.7 ? '우체국' : `${String.fromCharCode(65 + (k % 26))}기관${k}`, active: rand() > 0.1, postOffice: false }));
  const po = b.orgs.find((o) => o.name === '우체국');
  if (po) po.postOffice = true;
  if (!b.orgs.some((o) => o.active)) b.orgs[0].active = true;
  b.perf = Object.fromEntries(b.orgs.filter(() => rand() > 0.05).map((o) => [o.id, { seizure: int(0, 5000), collection: int(0, 2000), release: int(0, 1000) }]));
  b.recognized = pick([['seizure'], ['seizure', 'collection'], ['seizure', 'collection', 'release']]);
  const equalBp = pick([2500, 3000, 2000, 1000, 5000, 3333]);
  const A = int(1, 3_000_000) * 100 + int(0, 99);
  Object.assign(b.cond, {
    quarter: int(1, 4), A, B: rand() < 0.3 ? 0 : int(0, Math.floor(A / 4)), bConfirmed: true,
    C: rand() < 0.5 ? null : Math.floor(A / 4) + int(-500, 500),
    quarterMethod: pick(['A', 'B']), equalBp, perfBp: 10000 - equalBp, equalMethod: pick(['A', 'B']), postOffice: Boolean(po) && rand() < 0.8,
  });
  b.decisions['D-1'].value = b.cond.C === null ? 'auto' : 'manual';
  b.decisions['D-2'].value = pick(['floor', 'round', 'ceil']);
  b.decisions['D-3'].value = pick([null, 2, 3, 4]);
  b.decisions['D-4'].value = pick(['floor', 'round', 'ceil']);
  b.decisions['D-5'].value = pick(['floor', 'round', 'ceil']);
  b.decisions['D-7'] = { value: 'auto', unit: pick([1, 10, 100, 1000]), rounding: pick(['floor', 'round', 'ceil']), amount: 0, confirmed: false };
  b.decisions['D-8'].value = pick(['largestFraction', 'largestPerf']);
  b.decisions['D-9'].value = pick(['up', 'down']);
  b.perfMeta = { fileName: 'random' };
  return b;
}

const cases = [...sampleBusinesses().map((b) => ({ label: b.name, b })), ...Array.from({ length: N }, (_, i) => ({ label: `무작위 ${i + 1}`, b: randomBusiness(i + 1) }))];
let same = 0;
let skipped = 0;
const stats = { poAdjusted: 0, equalAdjusted: 0, perfRemainder: 0, quarterDiff: 0, methodB: 0 };
const diffs = [];
for (const { label, b } of cases) {
  const mine = runProto(b);
  const ref = runV4(toV4Business(b));
  const cmp = compareRuns(mine, ref);
  // 두 엔진 모두 오류로 끝난 경우(인정 실적 0 등)는 금액 비교 대상이 아니다
  const bothErr = mine.issues.some((i) => i.level === 'error') && (ref.issues.some((i) => i.level === 'error') || !ref.fee);
  if (bothErr) skipped += 1;
  else if (cmp.same) {
    same += 1;
    if (mine.alloc.po.enabled && mine.alloc.po.delta !== 0n) stats.poAdjusted += 1;
    if (mine.alloc.rows.some((r) => r.equalAdj !== 0n)) stats.equalAdjusted += 1;
    if (mine.alloc.rows.some((r) => r.perfRemainderAdj !== 0n)) stats.perfRemainder += 1;
    if (mine.sch.diff !== 0n) stats.quarterDiff += 1;
    if (mine.alloc.equal.method === 'B') stats.methodB += 1;
  } else diffs.push({ label, b, cmp, mine, ref });
}

const v4Commit = readFileSync(new URL('../reference/v4-engine/COMMIT.txt', import.meta.url), 'utf8').trim();
console.log(`병행검증: 프로토타입 엔진 vs v4 엔진(${v4Commit}) — ${cases.length}건 중 일치 ${same}건, 차이 ${diffs.length}건, 양쪽 모두 오류로 비교 제외 ${skipped}건`);
console.log(`  일치한 건 중 우체국 보정 ${stats.poAdjusted}건 · 균등회비 ±1원 ${stats.equalAdjusted}건 · 실적 잔액 배정 ${stats.perfRemainder}건 · 분기 차액 ${stats.quarterDiff}건 · 균등 방식 B ${stats.methodB}건`);
for (const { label, cmp, mine, ref } of diffs.slice(0, 10)) {
  console.log(`\n■ ${label}`);
  for (const q of cmp.quarters.filter((x) => !x.same)) console.log(`  ${q.q}분기: 프로토 ${q.mine} / v4 ${q.ref}`);
  for (const [k, t] of Object.entries(cmp.totals)) if (!t.same) console.log(`  ${k}: 프로토 ${t.mine} / v4 ${t.ref}`);
  for (const r of cmp.rows.filter((x) => !x.same)) console.log(`  ${r.name}: ${r.diffs.map((k) => `${k} 프로토 ${r[k].mine} / v4 ${r[k].ref}`).join(', ')}`);
  if (cmp.missingInMine.length) console.log(`  프로토에 없는 기관: ${cmp.missingInMine.join(', ')}`);
  const errs = [...mine.issues.filter((i) => i.level === 'error').map((i) => `프로토: ${i.message}`), ...ref.issues.filter((i) => i.level === 'error').map((i) => `v4: ${i.message}`)];
  for (const e of errs) console.log(`  ${e}`);
}
if (diffs.length > 10) console.log(`\n… 그 외 ${diffs.length - 10}건`);
process.exit(diffs.length ? 1 : 0);
