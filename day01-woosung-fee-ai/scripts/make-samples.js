// samples/ 아래 예시 실적 파일을 만든다. 기관명과 건수는 모두 가상이다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { buildHwp, buildHwpx } from './doc-writers.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'samples');
fs.mkdirSync(dir, { recursive: true });

const INSTITUTIONS = ['가온은행', '나래은행', '다솜은행', '라온저축은행', '마루증권', '별빛카드'];
const MONTHS = ['2026-07', '2026-08', '2026-09'];

// 기관마다 규모가 다르게, 매번 같은 값이 나오도록 고정된 계산식으로 만든다.
const count = (i, m, base) => Math.round(base * (6 - i) ** 1.6 * (1 + 0.07 * m) + 37 * i + 11 * m);

async function writeXlsx(file, sheet, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(rows.findIndex((r) => r.includes('금융기관명')) + 1).font = { bold: true };
  ws.columns.forEach((c) => { c.width = 14; });
  await wb.xlsx.writeFile(path.join(dir, file));
}

// 1) CMS: 가로형(기관 × 월)
const cms = [['CMS 업무 2026년 3분기 처리실적(예시)'], [], ['금융기관명', '7월', '8월', '9월', '합계']];
INSTITUTIONS.forEach((n, i) => {
  const v = [0, 1, 2].map((m) => count(i, m, 900));
  cms.push([n, ...v, v.reduce((a, b) => a + b, 0)]);
});
await writeXlsx('cms-2026q3.xlsx', '처리실적', cms);
fs.writeFileSync(path.join(dir, 'cms-2026q3.csv'), '﻿' + cms.slice(2).map((r) => r.join(',')).join('\n') + '\n');

// 2) 타행환: 세로형(기관 × 월, 항목별 열)
const ib = [['금융기관명', '기준월', '송금', '조회']];
INSTITUTIONS.slice(0, 5).forEach((n, i) => MONTHS.forEach((ym, m) => ib.push([n, ym, count(i, m, 1500), count(i, m, 4200)])));
await writeXlsx('interbank-2026q3.xlsx', '실적', ib);

// 3) 지로: 한글 문서 속 표
const giro = [['금융기관명', '7월', '8월', '9월']];
INSTITUTIONS.forEach((n, i) => giro.push([n, ...[0, 1, 2].map((m) => count(i, m, 450).toLocaleString('ko-KR'))]));
fs.writeFileSync(path.join(dir, 'giro-2026q3.hwp'), buildHwp({ title: '지로 업무 2026년 3분기 수납실적(예시)', rows: giro }));
fs.writeFileSync(path.join(dir, 'giro-2026q3.hwpx'), buildHwpx({ title: '지로 업무 2026년 3분기 수납실적(예시)', rows: giro }));

console.log(`예시 실적 파일을 만들었습니다: ${fs.readdirSync(dir).join(', ')}`);
