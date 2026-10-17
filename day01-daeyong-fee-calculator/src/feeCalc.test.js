import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, calculateFees } from './feeCalc.js';
import { parseRows } from './excel.js';

const orgs = [
  { name: 'A', seizure: 10, collection: 5, release: 5 }, // 20
  { name: 'B', seizure: 30, collection: 0, release: 10 }, // 40
  { name: 'C', seizure: 20, collection: 10, release: 10 }, // 40
];

test('25%는 균등, 75%는 건수 비율로 나눈다', () => {
  const r = calculateFees(1_000_000, orgs);
  assert.equal(r.equalPool, 250_000);
  assert.equal(r.ratioPool, 750_000);
  assert.deepEqual(r.rows.map((x) => x.ratioShare), [150_000, 300_000, 300_000]);
  // 250,000 / 3 = 83,333.33 → 단수 1원은 첫 기관
  assert.deepEqual(r.rows.map((x) => x.equalShare), [83_334, 83_333, 83_333]);
  assert.deepEqual(r.rows.map((x) => x.fee), [233_334, 383_333, 383_333]);
});

test('기관별 회비 합계는 항상 총액과 같다', () => {
  for (const total of [1, 7, 999_999, 12_345_679, 100_000_003]) {
    const r = calculateFees(total, orgs);
    assert.equal(r.rows.reduce((a, x) => a + x.fee, 0), total);
  }
});

test('최대잔여법 단수 보정', () => {
  assert.deepEqual(allocate(10, [1, 1, 1]), [4, 3, 3]);
  assert.deepEqual(allocate(100, [1, 2]), [33, 67]);
  assert.deepEqual(allocate(5, [0, 0]), [3, 2]);
});

test('전체 건수가 0이면 건수분도 균등 분배하고 경고', () => {
  const r = calculateFees(100, [{ name: 'A', seizure: 0, collection: 0, release: 0 }, { name: 'B', seizure: 0, collection: 0, release: 0 }]);
  // 균등분 25 → 13·12, 건수분 75 → 38·37
  assert.deepEqual(r.rows.map((x) => x.fee), [51, 49]);
  assert.equal(r.warnings.length, 1);
});

test('잘못된 총액은 거부', () => {
  assert.throws(() => calculateFees(0, orgs));
  assert.throws(() => calculateFees(100.5, orgs));
});

test('엑셀 행 파싱: 제목 행, 합계 행, 콤마 숫자, 합계 불일치 경고', () => {
  const { orgs: parsed, warnings } = parseRows([
    ['2026년 3분기 건수 현황'],
    [],
    ['기관명', '압류 건수', '추심 건수', '해제 건수', '합계 건수'],
    ['가', '1,000', 200, 300, 1500],
    ['나', 10, 20, 30, 99],
    ['', '', '', '', ''],
    ['합계', 1010, 220, 330, 1599],
  ]);
  assert.deepEqual(parsed, [
    { name: '가', seizure: 1000, collection: 200, release: 300 },
    { name: '나', seizure: 10, collection: 20, release: 30 },
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /나/);
});

test('압류·추심·해제 열이 없으면 오류', () => {
  assert.throws(() => parseRows([['기관명', '건수'], ['가', 1]]), /압류/);
});
