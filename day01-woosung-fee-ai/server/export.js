// 산출 결과 → 엑셀(.xlsx). 시트 1: 회비산출내역, 시트 2: 산출기준.
import ExcelJS from 'exceljs';
import { monthLabel, periodLabel } from './engine/period.js';
import { describeRule, METHODS } from './engine/rules.js';

const NAVY = 'FF0B2545';
const LIGHT = 'FFE8EEF7';
const thin = { style: 'thin', color: { argb: 'FFB8C4D6' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

export async function buildWorkbook({ work, version, result }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = '회비자동산출시스템';
  wb.created = new Date();

  const ws = wb.addWorksheet('회비산출내역', { views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }] });
  const { period, rows, totals, components } = result;
  const showMetric = rows.some((r) => r.metric !== r.totalCount);
  const multiYear = new Set(period.months.map((m) => m.slice(0, 4))).size > 1;
  const mLabel = (m) => monthLabel(m, multiYear);
  const headers = [
    '금융기관명',
    ...period.months.map((m) => `${mLabel(m)} 실적건수`),
    '실적 합계',
    ...(showMetric ? ['반영실적(가중)'] : []),
    ...components.map((c) => `${c.name}(원)`),
    '산출 회비(원)',
    '분담 비율(%)',
  ];

  ws.mergeCells(1, 1, 1, headers.length);
  ws.getCell(1, 1).value = `${work.name} ${periodLabel(period.year, period.quarter)} 회비 산출내역`;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.mergeCells(2, 1, 2, headers.length);
  ws.getCell(2, 1).value = `분기 총회비 ${result.totalFee.toLocaleString('ko-KR')}원 · 분담기준 v${version.version} · 참가기관 ${rows.length}곳`;
  ws.getCell(2, 1).font = { color: { argb: 'FF5B6B82' } };

  const head = ws.getRow(4);
  headers.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = border;
  });
  head.height = 30;

  const line = (label, r) => [
    label,
    ...r.monthly,
    r.totalCount,
    ...(showMetric ? [r.metric] : []),
    ...r.components,
    r.fee,
    r.share,
  ];
  rows.forEach((r, i) => addRow(ws, 5 + i, line(r.institution, r), false));
  const totalShare = rows.length ? 100 : 0;
  addRow(ws, 5 + rows.length, line('합계', { ...totals, share: totalShare }), true);

  ws.columns.forEach((col, i) => { col.width = i === 0 ? 22 : 16; });
  headers.forEach((h, i) => {
    const fmt = h.includes('비율') ? '0.00' : h.includes('반영실적') ? '#,##0.####' : '#,##0';
    if (i > 0) ws.getColumn(i + 1).numFmt = fmt;
  });

  // 산출기준 시트
  const info = wb.addWorksheet('산출기준');
  const kv = [
    ['업무', work.name],
    ['산출 분기', periodLabel(period.year, period.quarter)],
    ['실적 기준 기간', `${period.basisText} — ${period.months.map((m) => monthLabel(m, true)).join(', ')}`],
    ['분기 총회비(원)', result.totalFee],
    ['분담기준 버전', `v${version.version} (${version.createdAt.slice(0, 10)} 등록, ${version.engine})`],
    ['요약', version.rule.summary],
    ...describeRule(version.rule).map((l, i) => [i === 0 ? '산정 방법' : '', l]),
    ...components.map((c) => [`구성요소 금액`, `${c.name} (${METHODS[c.method]}): ${c.amount.toLocaleString('ko-KR')}원`]),
    ...result.warnings.map((w, i) => [i === 0 ? '확인 사항' : '', w]),
    ['산출 일시', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
  ];
  kv.forEach(([k, v], i) => {
    const row = info.getRow(i + 1);
    row.getCell(1).value = k;
    row.getCell(1).font = { bold: true, color: { argb: NAVY } };
    row.getCell(2).value = v;
    if (typeof v === 'number') row.getCell(2).numFmt = '#,##0';
  });
  info.getColumn(1).width = 18;
  info.getColumn(2).width = 80;
  if (version.sourceText) {
    const r = kv.length + 2;
    info.getCell(r, 1).value = '분담기준 원문';
    info.getCell(r, 1).font = { bold: true, color: { argb: NAVY } };
    info.getCell(r, 2).value = version.sourceText;
    info.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' };
  }

  return wb.xlsx.writeBuffer();
}

function addRow(ws, r, values, isTotal) {
  const row = ws.getRow(r);
  values.forEach((v, i) => {
    const c = row.getCell(i + 1);
    c.value = v;
    c.border = border;
    if (isTotal) {
      c.font = { bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    }
  });
}
