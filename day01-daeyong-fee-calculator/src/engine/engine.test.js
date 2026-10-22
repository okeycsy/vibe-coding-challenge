import { test } from 'node:test';
import assert from 'node:assert/strict';
import { divRound, fraction, percentToBp } from './money.js';
import { computeQuarterSchedule } from './quarters.js';
import { computeFees } from './fee.js';
import { sampleBusinesses } from './model.js';
import { runBusiness } from './pipeline.js';
import { buildPreview, guessMapping, detectHeaderRow, previewToPerf } from './perfImport.js';
import { toDateRange } from './period.js';

const sumOf = (rows, k) => rows.reduce((a, r) => a + r[k], 0);

test('BigInt 나눗셈과 원 단위 처리', () => {
  assert.equal(divRound(10n, 3n, 'floor'), 3n);
  assert.equal(divRound(10n, 3n, 'ceil'), 4n);
  assert.equal(divRound(10n, 4n, 'round'), 3n); // 2.5 → 3
  assert.equal(divRound(-10n, 4n, 'floor'), -3n);
  assert.equal(fraction(750000n * 1200n, 12000n, 2), '75,000.00'.replace('75,000', '75,000'));
  assert.equal(percentToBp('25'), 2500);
  assert.equal(percentToBp('12.5'), 1250);
  assert.ok(Number.isNaN(percentToBp('1.234')));
  // 부동소수점이면 틀리는 큰 수
  assert.equal(divRound(9007199254740993n * 3n, 3n), 9007199254740993n);
});

test('분기 배분: 요구사항 3-4 예시 그대로', () => {
  const base = { annualFee: 100_000_000, surplus: 12_000_000, q1Billed: 25_000_000 };
  const a = computeQuarterSchedule({ ...base, method: 'A' });
  assert.deepEqual(a.quarters.map((q) => q.amount), [25_000_000, 19_000_000, 22_000_000, 22_000_000]);
  assert.equal(a.D, 88_000_000);
  const b = computeQuarterSchedule({ ...base, method: 'B' });
  assert.deepEqual(b.quarters.map((q) => q.amount), [25_000_000, 21_000_000, 21_000_000, 21_000_000]);
  assert.ok(a.balanced && b.balanced);
});

test('분기 배분: 나누어떨어지지 않으면 차액을 표시하고, 고른 분기에 반영', () => {
  const s = { annualFee: 40_000_000, surplus: 3_500_002, q1Billed: 10_000_000, method: 'B' };
  const pending = computeQuarterSchedule(s);
  assert.equal(pending.diff, 2);
  assert.equal(pending.balanced, false);
  const done = computeQuarterSchedule({ ...s, diffQuarter: 4 });
  assert.deepEqual(done.quarters.map((q) => q.amount), [10_000_000, 8_833_332, 8_833_332, 8_833_334]);
  assert.equal(done.sum, done.D);
});

test('분기 배분: 1분기 기청구액을 비우면 당초 연간 회비 ÷ 4', () => {
  const r = computeQuarterSchedule({ annualFee: 100_000_002, surplus: 0, method: 'A', rounding: 'floor', diffQuarter: 2 });
  assert.equal(r.C, 25_000_000);
  assert.equal(r.sum, 100_000_002);
});

const orgs = [
  { id: 'a', name: 'A기관' },
  { id: 'b', name: 'B기관' },
  { id: 'c', name: 'C기관' },
  { id: 'p', name: '우체국' },
];
const items = [{ id: 's', name: '압류건수' }, { id: 'c', name: '추심건수' }, { id: 'r', name: '해제건수' }];
const perf = {
  a: { s: 1000, c: 500, r: 300 },
  b: { s: 2000, c: 700, r: 400 },
  c: { s: 1500, c: 800, r: 500 },
  p: { s: 700, c: 300, r: 200 },
};
const base = {
  orgs, items, perf, recognizedItemIds: ['s', 'c', 'r'], equalRateBp: 2500, perfRateBp: 7500,
  equal: { method: 'A', poolRounding: 'round', unitRounding: 'floor', targetMode: 'auto', targetOrgIds: [] },
  perfRemainder: { mode: 'largestRemainder', orgIds: [] },
  postOffice: { enabled: false },
};

test('균등 방식 A: 균등회비 총액을 정확히 맞추고 차액 기관을 기록', () => {
  const r = computeFees({ ...base, total: 10_000_001 }); // 균등 2,500,000.25 → 2,500,000 / 4 = 625,000
  assert.equal(r.equal.pool, 2_500_000);
  assert.equal(sumOf(r.rows, 'equalFinal'), 2_500_000);
  assert.equal(sumOf(r.rows, 'final'), 10_000_001);
  const r2 = computeFees({ ...base, total: 10_000_006 }); // 균등 2,500,001.5 → 반올림 2,500,002 / 4 → 625,000 + 2원
  assert.equal(r2.equal.diff, 2);
  assert.deepEqual(r2.rows.map((x) => x.equalAdj), [1, 1, 0, 0]);
  const r3 = computeFees({ ...base, total: 10_000_006, equal: { ...base.equal, targetMode: 'manual', targetOrgIds: ['c', 'p'] } });
  assert.deepEqual(r3.rows.map((x) => x.equalAdj), [0, 0, 1, 1]);
  assert.ok(r3.checks.every((c) => c.status === 'ok'));
  const r4 = computeFees({ ...base, total: 10_000_006, equal: { ...base.equal, targetMode: 'manual', targetOrgIds: ['c'] } });
  assert.equal(r4.checks.find((c) => c.id === 'equalPool').status, 'fail');
});

test('균등 방식 B: 기관별 금액 동일, 실제 비율과 차이 표시, 총액은 실적회비로 맞춤', () => {
  const r = computeFees({ ...base, total: 10_000_000, equal: { method: 'B', bMode: 'auto', bRounding: 'floor', bUnit: 1000 } });
  assert.ok(r.rows.every((x) => x.equalFinal === 625_000));
  assert.equal(r.perf.pool, 7_500_000);
  const r2 = computeFees({ ...base, total: 10_000_000, equal: { method: 'B', bMode: 'manual', bAmount: 600_000, bRounding: 'floor', bUnit: 1 } });
  assert.equal(r2.equal.actualPercent, '24.0000%');
  assert.equal(r2.perf.pool, 7_600_000);
  assert.equal(sumOf(r2.rows, 'final'), 10_000_000);
});

test('실적회비: 요구사항 9-2 예시 (7,500,000 × 1,200/12,000 = 750,000)', () => {
  const r = computeFees({
    ...base,
    total: 10_000_000,
    orgs: [{ id: 'a', name: 'A기관' }, { id: 'z', name: '나머지' }],
    perf: { a: { s: 1200, c: 0, r: 0 }, z: { s: 10800, c: 0, r: 0 } },
    recognizedItemIds: ['s'],
  });
  const a = r.rows[0];
  assert.equal(a.perfFinal, 750_000);
  assert.equal(a.sharePercent, '10.0000%');
  assert.ok(a.trace.perf.some((l) => l.formula === '7,500,000원 × (1,200 ÷ 12,000)'));
});

test('실적 인정 항목 선택에 따라 인정 실적이 바뀐다 (10-3 예시)', () => {
  const pick = (ids) => computeFees({ ...base, total: 1_000_000, recognizedItemIds: ids }).rows[0].recognized;
  assert.equal(pick(['s']), 1000);
  assert.equal(pick(['s', 'c']), 1500);
  assert.equal(pick(['s', 'c', 'r']), 1800);
});

test('인정 실적 합계 0이면 오류', () => {
  const r = computeFees({ ...base, total: 1_000_000, perf: {} });
  assert.ok(r.issues.some((i) => i.level === 'error' && /0건/.test(i.message)));
});

test('우체국: 10원 단위로 올림·내림하고 차액은 지정 기관 실적회비에서 반대로', () => {
  const po = { enabled: true, orgId: 'p', direction: 'up', counterpartMode: 'manual', counterpartOrgId: 'b' };
  const before = computeFees({ ...base, total: 10_000_007 });
  const pBefore = before.rows.find((x) => x.id === 'p').final;
  const up = computeFees({ ...base, total: 10_000_007, postOffice: po });
  const p = up.rows.find((x) => x.id === 'p');
  const b = up.rows.find((x) => x.id === 'b');
  assert.equal(p.final % 10, 0);
  assert.equal(p.final, Math.ceil(pBefore / 10) * 10);
  assert.equal(b.perfPostOfficeAdj, -(p.final - pBefore));
  assert.equal(p.equalFinal, before.rows.find((x) => x.id === 'p').equalFinal); // 균등회비는 그대로
  assert.equal(sumOf(up.rows, 'final'), 10_000_007);
  assert.ok(b.trace.adjust.some((x) => /우체국/.test(x.reason)));
  const down = computeFees({ ...base, total: 10_000_007, postOffice: { ...po, direction: 'down' } });
  assert.equal(down.rows.find((x) => x.id === 'p').final, Math.floor(pBefore / 10) * 10);
  assert.equal(sumOf(down.rows, 'final'), 10_000_007);
  assert.ok(down.checks.every((c) => c.status === 'ok'));
});

test('예시 업무 두 개 모두 검증 통과 (총액 일치)', () => {
  for (const b of sampleBusinesses()) {
    const run = runBusiness(b);
    assert.ok(run.checks.every((c) => c.status !== 'fail'), JSON.stringify(run.checks.filter((c) => c.status === 'fail')));
    assert.equal(sumOf(run.fee.rows, 'final'), run.total);
  }
  const [a] = sampleBusinesses();
  assert.equal(runBusiness(a).total, 19_000_000);
});

test('같은 입력이면 같은 결과', () => {
  const [a] = sampleBusinesses();
  assert.deepEqual(runBusiness(a).fee.rows.map((r) => r.final), runBusiness(a).fee.rows.map((r) => r.final));
});

test('기간 값 → 날짜 범위', () => {
  assert.deepEqual(toDateRange('2026-02'), { from: '2026-02-01', to: '2026-02-28', unit: 'month' });
  assert.deepEqual(toDateRange('2026년 1분기'), { from: '2026-01-01', to: '2026-03-31', unit: 'quarter' });
  assert.deepEqual(toDateRange(20260315), { from: '2026-03-15', to: '2026-03-15', unit: 'day' });
  assert.equal(toDateRange('미정'), null);
});

test('엑셀 업로드: 열 매핑 추측, 검증, 기간 필터, 수정값, 적용', () => {
  const aoa = [
    ['2026년 실적'],
    ['기준년월', '기관명', '압류', '추심', '해제', '기타건수', '합계'],
    ['2026-01', 'A기관', 1000, 500, 300, 5, 1800],
    ['2026-02', 'A기관', 10, 0, 0, 0, 10],
    ['2026-04', 'A기관', 999, 0, 0, 0, 999],
    ['2026-01', '모르는기관', 1, 1, 1, 0, 3],
    ['2026-01', 'B기관', 'abc', 700, 400, 0, 3100],
    ['2026-01', 'C기관', 1500, 800, 500, 0, 2900],
    ['', '합계', 0, 0, 0, 0, 0],
  ];
  const h = detectHeaderRow(aoa);
  assert.equal(h, 1);
  const mapping = guessMapping(aoa[h], items);
  assert.deepEqual(Object.values(mapping), ['period', 'org', 'item:s', 'item:c', 'item:r', 'new', 'total']);
  mapping[5] = 'ignore';
  const regs = [...orgs.map((o) => ({ ...o, active: true }))];
  const args = { aoa, headerIdx: h, mapping, items, recognizedItemIds: ['s', 'c', 'r'], orgs: regs, period: { start: '2026-01-01', end: '2026-03-31' } };
  const p = buildPreview(args);
  const msgs = p.issues.map((i) => `${i.level}:${i.message}`).join('\n');
  assert.match(msgs, /error:.*B기관.*숫자가 아닌 값 'abc'/);
  assert.match(msgs, /warn:등록되지 않은 기관 '모르는기관'/);
  assert.match(msgs, /info:'A기관' 2개 행/);
  assert.match(msgs, /warn:.*C기관.*2,900건 ≠ 항목 합 2,800건/);
  assert.match(msgs, /warn:파일에 없는 분담 대상 기관 1곳: 우체국/);
  assert.match(msgs, /1개 행은 제외/);
  assert.equal(p.canApply, false);
  const fixed = buildPreview({ ...args, edits: { B기관: { s: '2000' } } });
  assert.equal(fixed.canApply, true);
  const perf2 = previewToPerf(fixed);
  assert.deepEqual(perf2.a, { s: 1010, c: 500, r: 300 });
  assert.deepEqual(perf2.b, { s: 2000, c: 700, r: 400 });
  assert.equal(perf2['모르는기관'], undefined);
  const missingItem = buildPreview({ ...args, mapping: { ...mapping, 4: 'ignore' } });
  assert.match(missingItem.issues.map((i) => i.message).join(), /필수 실적 항목 '해제건수'/);
});
