import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildHwp, buildHwpx } from '../scripts/doc-writers.js';
import { parsePerformanceFile } from '../server/parsers/index.js';
import { tableToRecords } from '../server/parsers/table.js';
import { extractTablesFromXml } from '../server/parsers/hwpx.js';

const WIDE = [['금융기관명', '7월', '8월', '9월', '합계'], ['가온은행', '1,200', 1300, '1,400건', 3900], ['나래은행', 10, '-', 30, 40], ['합계', 1210, 1300, 1430, 3940]];

test('가로형 표: 합계 행·열은 건너뛴다', () => {
  const { records, layout } = tableToRecords(WIDE, { year: 2026 });
  assert.equal(layout, 'wide');
  assert.equal(records.length, 6);
  assert.deepEqual(records[0], { institution: '가온은행', month: '2026-07', item: '건수', count: 1200 });
  assert.equal(records.find((r) => r.institution === '나래은행' && r.month === '2026-08').count, 0);
});

test('세로형 표: 제목 줄 아래 머리글, 항목별 열', () => {
  const rows = [['타행환 실적'], [], ['기관명', '기준월', '송금(건)', '조회', '비고'], ['가온은행', '2026.07', 5, 7, ''], ['가온은행', '2026년 8월', 6, 8, 'x']];
  const { records, layout } = tableToRecords(rows);
  assert.equal(layout, 'long');
  assert.deepEqual(records.map((r) => `${r.month}/${r.item}/${r.count}`), ['2026-07/송금/5', '2026-07/조회/7', '2026-08/송금/6', '2026-08/조회/8']);
});

test('숫자가 아닌 건수는 문제로 알려준다', () => {
  const { problems } = tableToRecords([['금융기관명', '7월'], ['가온은행', '많음']], { year: 2026 });
  assert.equal(problems.length, 1);
});

test('xlsx 업로드', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('설명');
  ws.addRow(['이 시트에는 표가 없습니다']);
  const ws2 = wb.addWorksheet('실적');
  WIDE.forEach((r) => ws2.addRow(r));
  ws2.getCell('B3').value = { formula: '5+5', result: 10 };
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const out = await parsePerformanceFile('a.xlsx', buf, { year: 2026 });
  assert.equal(out.source, '실적');
  assert.equal(out.records.find((r) => r.institution === '나래은행' && r.month === '2026-07').count, 10);
});

test('CSV(CP949) 업로드', async () => {
  // '금융기관명,7월\n가온은행,5' 를 CP949로 인코딩한 바이트
  const cp949 = Buffer.from('b1ddc0b6b1e2b0fcb8ed2c37bff90ab0a1bfc2c0bac7e02c350a', 'hex');
  const out = await parsePerformanceFile('a.csv', cp949, { year: 2026 });
  assert.deepEqual(out.records, [{ institution: '가온은행', month: '2026-07', item: '건수', count: 5 }]);
});

test('HWP 5.0 문서 속 표', async () => {
  const buf = buildHwp({ title: '제목', rows: WIDE });
  const out = await parsePerformanceFile('a.hwp', buf, { year: 2026 });
  assert.equal(out.records.length, 6);
  assert.equal(out.records[2].count, 1400);
});

test('HWPX 문서 속 표', async () => {
  const out = await parsePerformanceFile('a.HWPX', buildHwpx({ title: '제목', rows: WIDE }), { year: 2026 });
  assert.equal(out.records.length, 6);
});

test('HWPX: 행 병합된 기관명은 아래 행에도 채운다', () => {
  const tc = (r, c, t, rs = 1) => `<hp:tc><hp:subList><hp:p><hp:run><hp:t>${t}</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="1" rowSpan="${rs}"/></hp:tc>`;
  const xml = `<hp:tbl><hp:tr>${tc(0, 0, '금융기관명')}${tc(0, 1, '항목')}${tc(0, 2, '7월')}</hp:tr>`
    + `<hp:tr>${tc(1, 0, '가온&amp;은행', 2)}${tc(1, 1, '송금')}${tc(1, 2, '3')}</hp:tr><hp:tr>${tc(2, 1, '조회')}${tc(2, 2, '4')}</hp:tr></hp:tbl>`;
  const [rows] = extractTablesFromXml(xml);
  const { records } = tableToRecords(rows, { year: 2026 });
  assert.deepEqual(records.map((r) => `${r.institution}/${r.item}/${r.count}`), ['가온&은행/송금/3', '가온&은행/조회/4']);
});

test('지원하지 않는 형식', async () => {
  await assert.rejects(parsePerformanceFile('a.xls', Buffer.from('x')), /xlsx/);
  await assert.rejects(parsePerformanceFile('a.pdf', Buffer.from('x')), /지원하지 않는/);
});
