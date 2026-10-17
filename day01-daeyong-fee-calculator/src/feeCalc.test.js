import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, calculateFees } from './feeCalc.js';
import { parseRows } from './excel.js';
import { toQuarter, toQuarterFromParts, groupByQuarter } from './period.js';
import { sampleSheetRows } from './sampleData.js';

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
  const { records: parsed, warnings, periodFrom } = parseRows([
    ['2026년 3분기 건수 현황'],
    [],
    ['기관명', '압류 건수', '추심 건수', '해제 건수', '합계 건수'],
    ['가', '1,000', 200, 300, 1500],
    ['나', 10, 20, 30, 99],
    ['', '', '', '', ''],
    ['합계', 1010, 220, 330, 1599],
  ]);
  assert.deepEqual(parsed, [
    { name: '가', period: null, seizure: 1000, collection: 200, release: 300 },
    { name: '나', period: null, seizure: 10, collection: 20, release: 30 },
  ]);
  assert.equal(periodFrom, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /나/);
});

test('압류·추심·해제 열이 없으면 오류', () => {
  assert.throws(() => parseRows([['기관명', '건수'], ['가', 1]]), /압류/);
});

test('기간 값을 분기로 읽는다', () => {
  const q = (year, quarter) => ({ year, quarter });
  assert.deepEqual(toQuarter('2024-01'), q(2024, 1));
  assert.deepEqual(toQuarter('2024.06'), q(2024, 2));
  assert.deepEqual(toQuarter('2024년 7월'), q(2024, 3));
  assert.deepEqual(toQuarter('2024/12/31'), q(2024, 4));
  assert.deepEqual(toQuarter(202405), q(2024, 2));
  assert.deepEqual(toQuarter('20251103'), q(2025, 4));
  assert.deepEqual(toQuarter('2025년 3분기'), q(2025, 3));
  assert.deepEqual(toQuarter('2025Q2'), q(2025, 2));
  assert.deepEqual(toQuarter('1Q2026'), q(2026, 1));
  assert.deepEqual(toQuarter(new Date(2026, 8, 30)), q(2026, 3));
  assert.deepEqual(toQuarter(45337), q(2024, 1)); // 엑셀 날짜 일련번호 = 2024-02-15
  assert.equal(toQuarter('2024-13'), null);
  assert.equal(toQuarter('가나다'), null);
  assert.deepEqual(toQuarterFromParts(2024, 11), q(2024, 4));
  assert.deepEqual(toQuarterFromParts('2025년', undefined, '2분기'), q(2025, 2));
});

test('같은 분기 같은 기관명은 합산하고 분기 순으로 정렬', () => {
  const { records } = parseRows([
    ['기준년월', '기관명', '압류', '추심', '해제'],
    ['2024-04', '가', 1, 1, 1],
    ['2024-01', '가', 10, 0, 0],
    ['2024-02', '가', 5, 0, 0],
    ['2024-02', '나', 1, 0, 0],
  ]);
  const groups = groupByQuarter(records);
  assert.deepEqual(groups.map((g) => g.label), ['2024년 1분기', '2024년 2분기']);
  assert.deepEqual(groups[0].orgs.map((o) => [o.name, o.seizure, o.rows]), [['가', 15, 2], ['나', 1, 1]]);
  assert.deepEqual(groups[1].orgs.map((o) => o.name), ['가']);
});

test('기간 열이 없으면 시트 이름으로, 그것도 없으면 전체 한 묶음', () => {
  const aoa = [['기관명', '압류', '추심', '해제'], ['가', 1, 2, 3], ['가', 1, 0, 0]];
  assert.deepEqual(parseRows(aoa, { sheetName: '2025년 4분기' }).records[0].period, { year: 2025, quarter: 4 });
  const groups = groupByQuarter(parseRows(aoa).records);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, '전체');
  assert.deepEqual(groups[0].orgs, [{ name: '가', seizure: 2, collection: 2, release: 3, rows: 2 }]);
});

test('읽을 수 없는 기간 값은 행 번호와 함께 오류', () => {
  assert.throws(
    () => parseRows([['기준년월', '기관명', '압류', '추심', '해제'], ['미정', '가', 1, 1, 1]]),
    /2행\(가\)의 기간 '미정'/,
  );
});

test('3년치 예시 데이터는 12개 분기로 나뉘고 분기마다 합계가 총액과 같다', () => {
  const groups = groupByQuarter(parseRows(sampleSheetRows()).records);
  assert.equal(groups.length, 12);
  assert.equal(groups[0].label, '2024년 1분기');
  assert.equal(groups[0].orgs.length, 7);
  assert.equal(groups.at(-1).orgs.length, 8); // 예시상호금융H는 2025년 3분기부터
  for (const g of groups) {
    const r = calculateFees(25_000_000, g.orgs);
    assert.equal(r.rows.reduce((a, x) => a + x.fee, 0), 25_000_000);
  }
});
