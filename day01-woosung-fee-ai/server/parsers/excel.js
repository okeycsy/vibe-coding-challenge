// .xlsx / .csv → 시트별 2차원 배열
import ExcelJS from 'exceljs';

export async function readXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets.map((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const out = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => { out[c - 1] = cellValue(cell.value); });
      rows[r - 1] = out;
    });
    return { name: ws.name, rows: Array.from(rows, (r) => r ?? []) };
  });
}

function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'object' || v instanceof Date) return v;
  if ('result' in v) return cellValue(v.result);           // 수식
  if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
  if ('text' in v) return v.text;                          // 하이퍼링크
  if ('error' in v) return '';
  return String(v);
}

export function readCsv(buffer) {
  const text = decodeText(buffer);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return [{ name: 'CSV', rows }];
}

// 국내 CSV는 CP949(EUC-KR)로 저장된 경우가 많아 UTF-8이 깨지면 다시 읽는다.
function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(buffer);
  }
}
