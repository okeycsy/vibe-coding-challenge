// 공통 규칙 초안의 예시와 불변 조건을 그대로 테스트로 둔다. node --test rules/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { divide, toUnit, percentToBp, decimal } from './money.js';
import { schedule } from './schedule.js';
import { allocate } from './allocate.js';
import { runBusiness } from './run.js';
import { sampleBusinesses, newBusiness } from './model.js';
import { defaultDecisions } from './decisions.js';

const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0n);

test('R-1.1 정수 나눗셈과 원 미만 처리', () => {
  assert.equal(divide(10, 3, 'floor'), 3n);
  assert.equal(divide(10, 3, 'ceil'), 4n);
  assert.equal(divide(10, 4, 'round'), 3n);
  assert.equal(divide(-10, 4, 'floor'), -3n);
  assert.equal(divide(-10, 4, 'ceil'), -2n);
  assert.equal(toUnit(1_234_567n, 10n, 'ceil'), 1_234_570n); // R-7.2 예시
  assert.equal(toUnit(1_234_567n, 10n, 'floor'), 1_234_560n);
  assert.equal(percentToBp('25'), 2500);
  assert.equal(percentToBp('12.5'), 1250);
  assert.equal(decimal(7_500_000n * 1200n, 12000n, 2), '750,000.00');
  assert.equal(divide(9007199254740993n * 3n, 3n), 9007199254740993n); // 부동소수점이면 틀리는 수
});

test('R-4 분기 배분 예시 (A 1억, B 1,200만, C 2,500만)', () => {
  const base = { A: 100_000_000, B: 12_000_000, C: 25_000_000 };
  const a = schedule({ ...base, method: 'A' });
  assert.deepEqual(a.quarters.map((q) => Number(q.amount)), [25_000_000, 19_000_000, 22_000_000, 22_000_000]);
  const b = schedule({ ...base, method: 'B' });
  assert.deepEqual(b.quarters.map((q) => Number(q.amount)), [25_000_000, 21_000_000, 21_000_000, 21_000_000]);
  assert.ok(a.balanced && b.balanced);
  assert.equal(a.D, 88_000_000n);
});

test('R-4.4 나누어떨어지지 않으면 차액 표시, D-3 분기에 반영', () => {
  const s = { A: 40_000_000, B: 3_500_002, C: 10_000_000, method: 'B', rounding: 'floor' };
  const pending = schedule(s);
  assert.equal(pending.diff, 2n);
  assert.equal(pending.balanced, false);
  const done = schedule({ ...s, diffQuarter: 4 });
  assert.deepEqual(done.quarters.map((q) => Number(q.amount)), [10_000_000, 8_833_332, 8_833_332, 8_833_334]);
  assert.ok(done.balanced);
});

test('R-4.1 C를 비우면 A ÷ 4', () => {
  const r = schedule({ A: 100_000_002, B: 0, method: 'A', diffQuarter: 2 });
  assert.equal(r.C, 25_000_000n);
  assert.ok(r.cAuto && r.balanced);
});

test('R-4.2 B > A 는 오류', () => {
  assert.ok(schedule({ A: 100, B: 200 }).issues.some((i) => i.level === 'error'));
});

const orgs = [{ id: 'a', name: 'A기관' }, { id: 'b', name: 'B기관' }, { id: 'c', name: 'C기관' }, { id: 'p', name: '우체국' }];
const items = [{ id: 's', name: '압류건수' }, { id: 'c', name: '추심건수' }, { id: 'r', name: '해제건수' }];
const perf = { a: { s: 1000, c: 500, r: 300 }, b: { s: 2000, c: 700, r: 400 }, c: { s: 1500, c: 800, r: 500 }, p: { s: 700, c: 300, r: 200 } };
const d = defaultDecisions();
const base = { orgs, items, perf, recognized: ['s', 'c', 'r'], equalBp: 2500, perfBp: 7500, equalMethod: 'A', d, postOffice: { enabled: false } };

test('R-5.1 방식 A: 균등회비 총액을 정확히 맞추고 ±1원 기관 기록', () => {
  const r = allocate({ ...base, T: 10_000_001 }); // 2,500,000.25 → 반올림 2,500,000 → 625,000씩
  assert.equal(r.equal.pool, 2_500_000n);
  assert.equal(sum(r.rows, 'equalFinal'), 2_500_000n);
  assert.equal(sum(r.rows, 'final'), 10_000_001n);
  const r2 = allocate({ ...base, T: 10_000_006 }); // 2,500,001.5 → 2,500,002 → 625,000 + 2원
  assert.equal(r2.equal.diff, 2n);
  assert.deepEqual(r2.rows.map((x) => Number(x.equalAdj)), [1, 1, 0, 0]);
  const d6 = { ...d, 'D-6': { value: 'manual', orgIds: ['c', 'p'] } };
  const r3 = allocate({ ...base, T: 10_000_006, d: d6 });
  assert.deepEqual(r3.rows.map((x) => Number(x.equalAdj)), [0, 0, 1, 1]);
  const bad = allocate({ ...base, T: 10_000_006, d: { ...d, 'D-6': { value: 'manual', orgIds: ['c'] } } });
  assert.ok(bad.issues.some((i) => i.rule === 'R-5.1'));
});

test('R-5.2 방식 B: 모든 기관 동일, 실제 비율 표시, 총액은 실적회비로 맞춤', () => {
  const r = allocate({ ...base, T: 10_000_000, equalMethod: 'B', d: { ...d, 'D-7': { value: 'auto', unit: 1000, rounding: 'floor' } } });
  assert.ok(r.rows.every((x) => x.equalFinal === 625_000n));
  assert.equal(r.perf.pool, 7_500_000n);
  const r2 = allocate({ ...base, T: 10_000_000, equalMethod: 'B', d: { ...d, 'D-7': { value: 'manual', amount: 600_000 } } });
  assert.equal(r2.equal.actualPercent, '24.0000%');
  assert.equal(r2.perf.pool, 7_600_000n);
  assert.equal(sum(r2.rows, 'final'), 10_000_000n);
});

test('R-6.1 실적회비 예시: 7,500,000 × (1,200 / 12,000) = 750,000', () => {
  const r = allocate({ ...base, T: 10_000_000, orgs: [{ id: 'a', name: 'A기관' }, { id: 'z', name: '나머지' }], perf: { a: { s: 1200 }, z: { s: 10800 } }, recognized: ['s'] });
  const a = r.rows[0];
  assert.equal(a.perfFinal, 750_000n);
  assert.equal(a.share, '10.0000%');
  assert.ok(a.trace.perf.some((l) => l.formula === '7,500,000원 × (1,200 ÷ 12,000)'));
});

test('R-6.2 인정 항목 선택에 따라 인정 실적 (1,000 / 1,500 / 1,800)', () => {
  const pick = (ids) => Number(allocate({ ...base, T: 1_000_000, recognized: ids }).rows[0].recognized);
  assert.equal(pick(['s']), 1000);
  assert.equal(pick(['s', 'c']), 1500);
  assert.equal(pick(['s', 'c', 'r']), 1800);
});

test('R-6.4 인정 실적 합계 0이면 오류', () => {
  assert.ok(allocate({ ...base, T: 1_000_000, perf: {} }).issues.some((i) => i.rule === 'R-6.4'));
});

test('R-6.5 잔액 배정: 합계 = 실적회비 총액 (세 가지 D-8 모두)', () => {
  for (const mode of ['largestFraction', 'largestPerf', 'order']) {
    const r = allocate({ ...base, T: 10_000_007, d: { ...d, 'D-8': { value: mode, orgIds: [] } } });
    assert.equal(sum(r.rows, 'perfFinal'), r.perf.pool, mode);
    assert.equal(sum(r.rows, 'final'), 10_000_007n, mode);
  }
});

test('R-7 우체국: 10원 단위 올림·내림, 차액은 지정 기관 실적회비에서 반대로, 균등회비는 그대로', () => {
  const before = allocate({ ...base, T: 10_000_007 });
  const pBefore = before.rows.find((x) => x.id === 'p');
  for (const direction of ['up', 'down']) {
    const r = allocate({ ...base, T: 10_000_007, postOffice: { enabled: true, orgId: 'p' }, d: { ...d, 'D-9': { value: direction }, 'D-10': { value: 'manual', orgId: 'b' } } });
    const p = r.rows.find((x) => x.id === 'p');
    const b = r.rows.find((x) => x.id === 'b');
    assert.equal(p.final % 10n, 0n);
    assert.equal(p.final, toUnit(pBefore.final, 10n, direction === 'up' ? 'ceil' : 'floor'));
    assert.equal(p.equalFinal, pBefore.equalFinal);
    assert.equal(b.perfPoAdj, -(p.final - pBefore.final));
    assert.equal(sum(r.rows, 'final'), 10_000_007n);
    assert.ok(b.trace.adjust.some((x) => x.rule === 'R-7.4'));
  }
  // D-10 자동: 우체국을 뺀 기관 중 실적회비가 가장 큰 기관 (B기관 3,100건)
  const auto = allocate({ ...base, T: 10_000_007, postOffice: { enabled: true, orgId: 'p' } });
  assert.equal(auto.po.counterpartId, 'b');
});

test('R-12 예시 업무 두 개 모두 불일치 없음, 합계 = T', () => {
  for (const b of sampleBusinesses()) {
    const run = runBusiness(b);
    assert.deepEqual(run.checks.filter((c) => c.status === 'fail'), []);
    assert.equal(sum(run.alloc.rows, 'final'), run.T);
  }
  assert.equal(runBusiness(sampleBusinesses()[0]).T, 19_000_000n);
});

test('R-1.4 같은 입력이면 같은 결과', () => {
  const [a] = sampleBusinesses();
  const x = runBusiness(a).alloc.rows.map((r) => r.final);
  const y = runBusiness(a).alloc.rows.map((r) => r.final);
  assert.deepEqual(x, y);
});

test('빈 업무도 터지지 않고 오류로 안내', () => {
  const run = runBusiness(newBusiness('빈 업무'));
  assert.equal(run.status, 'fail');
  assert.ok(run.issues.some((i) => i.rule === 'R-11.1'));
});
