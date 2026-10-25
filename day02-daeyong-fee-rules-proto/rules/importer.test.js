import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectHeaderRow, guessMapping, buildPreview, applyPreview, extractOrgNames, periodRange, parsePeriodCell, normalizeName } from './importer.js';

const items = [{ id: 's', name: '압류건수' }, { id: 'c', name: '추심건수' }, { id: 'r', name: '해제건수' }];
const orgs = [{ id: 'a', name: 'A기관', active: true }, { id: 'b', name: 'B기관', active: true }, { id: 'c', name: 'C기관', active: true }, { id: 'p', name: '우체국', active: true }];
const aoa = [
  ['2026년 실적'],
  ['기준년월', '기관명', '압류', '추심', '해제', '기타건수', '합계'],
  ['2026-01', 'A기관', 1000, 500, 300, 5, 1800],
  ['2026-02', 'A 기관', 10, 0, 0, 0, 10],
  ['2026-04', 'A기관', 999, 0, 0, 0, 999],
  ['2026-01', '모르는기관', 1, 1, 1, 0, 3],
  ['2026-01', 'B기관', 'abc', 700, 400, 0, 3100],
  ['2026-01', 'C기관', '1,500', 800, 500, 0, 2900],
  ['', '합계', 0, 0, 0, 0, 0],
];

test('R-10.3 기간 값 읽기', () => {
  const q1 = { from: '2026-01-01', to: '2026-03-31' };
  assert.deepEqual(periodRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(periodRange('2026년 1분기'), q1);
  assert.deepEqual(periodRange(20260315), { from: '2026-03-15', to: '2026-03-15' });
  assert.deepEqual(periodRange(new Date(2026, 0, 5)), { from: '2026-01-05', to: '2026-01-05' });
  assert.equal(periodRange('미정'), null);
  // 분기 표기 여러 가지, 기간 범위, 2자리 연도
  for (const v of ['2026년도 1/4분기', '2026년 제1분기', '2026 1사분기', 'Q1 2026', '2026 1Q', '2026-Q1', '26년 1분기', '2026.01.01 ~ 2026.03.31', '2026-01 - 2026-03']) assert.deepEqual(periodRange(v), q1, v);
  assert.deepEqual(periodRange('2026년'), { from: '2026-01-01', to: '2026-12-31' });
  // 연도 없는 값은 연도 열·산출 연도로
  assert.deepEqual(parsePeriodCell('1분기', { year: '2026년' }), q1);
  assert.deepEqual(parsePeriodCell('Q1', { year: 2026 }), q1);
  assert.deepEqual(parsePeriodCell('3월', { year: 2026 }), { from: '2026-03-01', to: '2026-03-31' });
  assert.deepEqual(parsePeriodCell(1, { year: 2026, unitHint: 'quarter' }), q1);
  assert.deepEqual(parsePeriodCell('1분기', {}), { needYear: true });
  assert.equal(parsePeriodCell('이상한값', { year: 2026 }), null);
});

test('R-10.4 기간 열: 셀 병합(빈 칸)·연도 열·연도 없는 분기·못 읽는 값', () => {
  const aoa2 = [
    ['연도', '분기', '기관명', '압류'],
    [2026, '1/4분기', 'A기관', 10],
    ['', '', 'B기관', 20],
    ['', '2분기', 'C기관', 30],
    [2026, '언제', 'D기관', 40],
  ];
  const m = guessMapping(aoa2[0], items);
  assert.deepEqual(Object.values(m), ['year', 'period', 'org', 'item:s']);
  const p = buildPreview({ aoa: aoa2, headerIdx: 0, mapping: m, items, recognized: ['s'], orgs: [], period: { start: '2026-01-01', end: '2026-03-31' }, autoAddOrgs: true });
  const text = p.issues.map((i) => `${i.level}:${i.message}`).join('\n');
  assert.match(text, /info:기간 칸이 비어 있는 1개 행/);
  assert.match(text, /error:5행 'D기관': 기간 '언제'/);
  assert.deepEqual(p.rows.map((r) => r.name), ['A기관', 'B기관']); // C기관은 2분기라 제외
  const noYear = buildPreview({ aoa: [['분기', '기관명', '압류'], ['1분기', 'A기관', 1]], headerIdx: 0, mapping: { 0: 'period', 1: 'org', 2: 'item:s' }, items, recognized: ['s'], orgs: [], autoAddOrgs: true });
  assert.match(noYear.issues.map((i) => i.message).join(), /연도가 없어/);
  const withYear = buildPreview({ aoa: [['분기', '기관명', '압류'], ['1분기', 'A기관', 1]], headerIdx: 0, mapping: { 0: 'period', 1: 'org', 2: 'item:s' }, items, recognized: ['s'], orgs: [], autoAddOrgs: true, defaultYear: 2026 });
  assert.match(withYear.issues.map((i) => i.message).join(), /산출 연도\(2026년\)로 보았습니다/);
  assert.equal(withYear.canApply, true);
});

test('D-15 기관명 동일성', () => {
  assert.equal(normalizeName(' 가나 은행 '), normalizeName('가나은행'));
  assert.notEqual(normalizeName('가나 은행', 'exact'), normalizeName('가나은행', 'exact'));
});

test('R-10.2 머리글 찾기와 열 매핑 추정', () => {
  const h = detectHeaderRow(aoa);
  assert.equal(h, 1);
  const m = guessMapping(aoa[h], items);
  assert.deepEqual(Object.values(m), ['period', 'org', 'item:s', 'item:c', 'item:r', 'new', 'total']);
  const saved = guessMapping(aoa[h], items, { 기타건수: 'ignore' });
  assert.equal(saved[5], 'ignore');
  // 등록 항목이 없을 때: 숫자 열은 모두 새 항목, 글자 열은 사용 안 함
  const rows = [['A기관', 10, 'API', 3, '메모'], ['B기관', 20, 'API', 4, '']];
  const m2 = guessMapping(['기관명', '호출건수', '구분코드', '처리건수', '메모'], [], {}, rows);
  assert.deepEqual(Object.values(m2), ['org', 'new', 'ignore', 'new', 'ignore']);
});

test('엑셀 건수 열 → 실적 항목 자동 등록 (적용할 때)', () => {
  const h = 1;
  const mapping = guessMapping(aoa[h], items); // 기타건수 = new
  const p = buildPreview({ aoa, headerIdx: h, mapping, items, recognized: ['s', 'c', 'r'], orgs, period: { start: '2026-01-01', end: '2026-03-31' }, edits: { B기관: { s: '2000' } }, autoAddOrgs: true });
  assert.deepEqual(p.newItems.map((x) => x.name), ['기타건수']);
  assert.ok(p.itemCols.some((c) => c.isNew && c.name === '기타건수'));
  assert.equal(p.rows.find((r) => r.name === 'A기관').recognizedSum, 1010 + 500 + 300 + 5); // 새 항목도 인정 실적에 포함
  assert.ok(p.issues.some((i) => i.level === 'info' && /'기타건수' 열은 적용할 때 새 실적 항목/.test(i.message)));
  assert.equal(p.canApply, true);
  let k = 0;
  const applied = applyPreview(p, () => 'o_new', () => `it_${++k}`);
  assert.deepEqual(applied.newItems.map((x) => ({ id: x.id, name: x.name })), [{ id: 'it_1', name: '기타건수' }]);
  assert.deepEqual(applied.perf.a, { s: 1010, c: 500, r: 300, it_1: 5 });
  // 등록 항목이 하나도 없는 새 업무: 열 전부가 새 항목
  const bare = buildPreview({ aoa, headerIdx: h, mapping: { 0: 'period', 1: 'org', 2: 'new', 3: 'new', 4: 'new', 5: 'ignore', 6: 'total' }, items: [], recognized: [], orgs: [], edits: { B기관: { 'new:2': '2000' } }, autoAddOrgs: true });
  assert.deepEqual(bare.newItems.map((x) => x.name), ['압류', '추심', '해제']);
  assert.equal(bare.canApply, true);
  const ap = applyPreview(bare, () => `o${Math.random()}`, () => `i${++k}`);
  assert.equal(ap.newItems.length, 3);
  assert.equal(Object.values(ap.perf).length, 4); // A기관(합산)·모르는기관·B기관·C기관
  // 건수 열이 하나도 없으면 오류
  assert.ok(buildPreview({ aoa, headerIdx: h, mapping: { 1: 'org' }, items: [], recognized: [], orgs: [] }).issues.some((i) => /건수 열이 하나도 없습니다/.test(i.message)));
});

test('R-10.4 검증, R-10.5 합계 열, R-10.6 수정, R-10.7 자동 등록', () => {
  const h = 1;
  const mapping = { ...guessMapping(aoa[h], items), 5: 'ignore' };
  const args = { aoa, headerIdx: h, mapping, items, recognized: ['s', 'c', 'r'], orgs, period: { start: '2026-01-01', end: '2026-03-31' }, autoAddOrgs: false };
  const p = buildPreview(args);
  const text = p.issues.map((i) => `${i.level}:${i.message}`).join('\n');
  assert.match(text, /error:.*B기관.*숫자가 아닌 값 'abc'/);
  assert.match(text, /warn:등록되지 않은 기관 '모르는기관'/);
  assert.match(text, /info:'A기관' 2개 행/); // 'A 기관'은 띄어쓰기만 달라 같은 기관 (D-15)
  assert.match(text, /warn:'C기관'.*2,900건 ≠ 항목 합 2,800건/);
  assert.match(text, /warn:파일에 없는 분담 대상 기관 1곳: 우체국/);
  assert.match(text, /1개 행은 제외/);
  assert.equal(p.canApply, false);

  const fixed = buildPreview({ ...args, edits: { B기관: { s: '2000' } } });
  assert.equal(fixed.canApply, true);
  const { perf, newOrgs } = applyPreview(fixed);
  assert.deepEqual(perf.a, { s: 1010, c: 500, r: 300 });
  assert.deepEqual(perf.b, { s: 2000, c: 700, r: 400 });
  assert.deepEqual(perf.c, { s: 1500, c: 800, r: 500 });
  assert.equal(perf['모르는기관'], undefined);
  assert.equal(newOrgs.length, 0);

  // 인정 항목 열 누락
  const missingItem = buildPreview({ ...args, mapping: { ...mapping, 4: 'ignore' } });
  assert.match(missingItem.issues.map((i) => i.message).join(), /인정 실적 항목 '해제건수'/);

  // R-10.7 자동 등록
  const auto = buildPreview({ ...args, edits: { B기관: { s: '2000' } }, autoAddOrgs: true });
  assert.equal(auto.stats.newOrgCount, 1);
  let n = 0;
  const applied = applyPreview(auto, () => `new_${++n}`);
  assert.deepEqual(applied.newOrgs, [{ id: 'new_1', name: '모르는기관', active: true, postOffice: false }]);
  assert.deepEqual(applied.perf.new_1, { s: 1, c: 1, r: 1 });
  // 담당자가 기존 기관에 연결하거나 제외
  const linked = buildPreview({ ...args, edits: { B기관: { s: '2000' } }, autoAddOrgs: true, nameMap: { 모르는기관: 'p' } });
  assert.deepEqual(applyPreview(linked).perf.p, { s: 1, c: 1, r: 1 });
  const excluded = buildPreview({ ...args, edits: { B기관: { s: '2000' } }, autoAddOrgs: true, nameMap: { 모르는기관: '' } });
  assert.equal(applyPreview(excluded).newOrgs.length, 0);
  // D-12 오류, D-11 오류
  assert.ok(buildPreview({ ...args, d: { 'D-12': 'error' } }).issues.some((i) => /여러 행/.test(i.message) && i.level === 'error'));
  assert.ok(buildPreview({ ...args, d: { 'D-11': 'error' } }).issues.some((i) => /우체국.*오류/.test(i.message) && i.level === 'error'));
});

test('기관명만 뽑기', () => {
  assert.deepEqual(extractOrgNames(aoa), ['A기관', '모르는기관', 'B기관', 'C기관']);
  const roster = [['참가기관 명단'], [], ['순번', '기관명', '비고'], [1, 'A기관', ''], [2, '가나 은행', ''], [3, '가나은행', '중복'], ['', '합계', '']];
  assert.deepEqual(extractOrgNames(roster), ['A기관', '가나 은행']);
  assert.deepEqual(extractOrgNames([['가나은행'], ['다라증권'], ['가나은행']]), ['가나은행', '다라증권']);
});
