import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate } from '../server/engine/allocate.js';
import { calculateFees } from '../server/engine/calculate.js';
import { parseCriteriaText } from '../server/engine/learn.js';
import { validateRule } from '../server/engine/rules.js';

const rec = (institution, month, count, item = '건수') => ({ institution, month, item, count });

test('안분 합계는 항상 총액과 같다', () => {
  for (const amount of [0n, 1n, 7n, 999n, 123456789n, 10n ** 15n + 3n]) {
    for (const unit of [1n, 10n, 100n, 1000n]) {
      const r = allocate(amount, [{ key: 'a', weight: 3n }, { key: 'b', weight: 3n }, { key: 'c', weight: 1n }], unit);
      assert.equal([...r.values()].reduce((s, v) => s + v, 0n), amount, `${amount}/${unit}`);
    }
  }
});

test('가중치 0인 기관은 비례분을 받지 않는다', () => {
  const r = allocate(100n, [{ key: 'a', weight: 1n }, { key: 'b', weight: 0n }]);
  assert.equal(r.get('b'), 0n);
  assert.equal(r.get('a'), 100n);
});

test('25% 균등 + 75% 건수 비례를 손으로 계산한 값과 맞춘다', () => {
  const rule = parseCriteriaText('25% 균등, 75% 건수 비례');
  const records = [rec('A', '2026-07', 100), rec('A', '2026-08', 200), rec('B', '2026-07', 100), rec('C', '2026-09', 600)];
  const r = calculateFees({ rule, records, year: 2026, quarter: 3, totalFee: '1,000,000' });
  // 균등 250,000 / 3 = 83,333.33 → 83,334, 83,333, 83,333 (최대잔여, 동률 이름순)
  // 비례 750,000 × 300/1000, 100/1000, 600/1000 = 225,000, 75,000, 450,000
  assert.deepEqual(r.rows.map((x) => x.fee), [83334 + 225000, 83333 + 75000, 83333 + 450000]);
  assert.deepEqual(r.rows[0].monthly, [100, 200, 0]);
  assert.equal(r.totals.fee, 1000000);
});

test('항목 가중치와 분기 밖 실적 처리', () => {
  const rule = parseCriteriaText('100% 실적 비례\n실적 항목: 송금 1, 조회 0.5');
  const records = [
    rec('A', '2026-07', 100, '송금'), rec('A', '2026-07', 200, '조회'),
    rec('B', '2026-08', 200, '송금'),
    rec('B', '2026-10', 999, '송금'),
    rec('B', '2026-08', 50, '기타'),
  ];
  const r = calculateFees({ rule, records, year: 2026, quarter: 3, totalFee: 400 });
  assert.deepEqual(r.rows.map((x) => x.metric), [200, 200]);
  assert.deepEqual(r.rows.map((x) => x.fee), [200, 200]);
  assert.ok(r.warnings.some((w) => w.includes('2026-10')));
  assert.ok(r.warnings.some((w) => w.includes('기타')));
});

test('구간(등급) 방식', () => {
  const rule = parseCriteriaText('100% 구간별 가중치 - 0건 이상 1, 1,000건 이상 3');
  const records = [rec('A', '2026-01', 5000), rec('B', '2026-02', 10), rec('C', '2026-03', 999)];
  const r = calculateFees({ rule, records, year: 2026, quarter: 1, totalFee: 500 });
  assert.deepEqual(r.rows.map((x) => x.fee), [300, 100, 100]);
});

test('10원 단위 절사: 기관 몫은 10원 단위, 1원 단위 자투리는 한 곳에만', () => {
  const rule = parseCriteriaText('100% 균등\n10원 미만 절사');
  const records = ['A', 'B', 'C'].map((n) => rec(n, '2026-04', 1));
  const r = calculateFees({ rule, records, year: 2026, quarter: 2, totalFee: 1007 });
  assert.deepEqual(r.rows.map((x) => x.fee), [347, 330, 330]);
});

test('비율 합계가 100%가 아니면 거부', () => {
  const { errors } = validateRule(parseCriteriaText('30% 균등, 60% 비례'));
  assert.ok(errors.some((e) => e.includes('90%')));
  assert.throws(() => calculateFees({ rule: parseCriteriaText('30% 균등'), records: [rec('A', '2026-07', 1)], year: 2026, quarter: 3, totalFee: 1 }));
});

test('총회비 입력 검증', () => {
  const rule = parseCriteriaText('100% 균등');
  const records = [rec('A', '2026-07', 1)];
  assert.throws(() => calculateFees({ rule, records, year: 2026, quarter: 3, totalFee: '-5' }), /정수/);
  assert.throws(() => calculateFees({ rule, records, year: 2026, quarter: 3, totalFee: '12.5' }), /정수/);
});

test('실적 기준 기간: 직전 2분기 / 최근 2개 분기', () => {
  const records = [
    rec('A', '2026-03', 100), rec('A', '2026-05', 100), rec('A', '2026-08', 1000),
    rec('B', '2026-06', 300), rec('B', '2026-09', 0),
  ];
  const prev = parseCriteriaText('100% 실적 비례, 실적은 직전 2분기 실적');
  assert.deepEqual(prev.basis, { lag: 1, count: 2 });
  const r1 = calculateFees({ rule: prev, records, year: 2026, quarter: 3, totalFee: 500 });
  assert.deepEqual(r1.period.months, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
  assert.deepEqual(r1.rows.map((x) => x.fee), [200, 300]);
  assert.ok(r1.warnings.some((w) => w.includes('2026-08')));

  const recent = parseCriteriaText('100% 실적 비례, 최근 2개 분기 실적');
  const r2 = calculateFees({ rule: recent, records, year: 2026, quarter: 3, totalFee: 1400 });
  assert.deepEqual(r2.period.months.slice(0, 1), ['2026-04']);
  assert.deepEqual(r2.rows.map((x) => x.fee), [1100, 300]);
});

test('실적 기준 기간이 해를 넘어간다', () => {
  const rule = parseCriteriaText('100% 균등, 직전 분기 실적');
  const r = calculateFees({ rule, records: [rec('A', '2025-11', 1)], year: 2026, quarter: 1, totalFee: 10 });
  assert.deepEqual(r.period.months, ['2025-10', '2025-11', '2025-12']);
});
