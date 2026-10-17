// .xlsx / .csv → 시트별 2차원 배열
import CFB from 'cfb';
import ExcelJS from 'exceljs';

export async function readXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    // 일부 시스템이 내보낸 파일(네임스페이스 접두사 x: 등)은 exceljs가 못 읽어 직접 읽는다.
    return readXlsxRaw(buffer);
  }
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

// ── 최소 xlsx 판독기: 시트 이름, 공유 문자열, 셀 값만 읽는다 ──
export function readXlsxRaw(buffer) {
  const zip = CFB.read(buffer, { type: 'buffer' });
  const file = (name) => {
    const target = name.replace(/^\//, '').toLowerCase();
    const i = zip.FullPaths.findIndex((p) => p.replace(/^[^/]*\//, '').toLowerCase() === target || p.toLowerCase() === target);
    return i >= 0 ? Buffer.from(zip.FileIndex[i].content).toString('utf8').replace(/^\uFEFF/, '') : null;
  };
  const wbXml = file('xl/workbook.xml');
  if (!wbXml) throw new Error('엑셀 파일 구조를 읽지 못했습니다.');
  const rels = new Map([...(file('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<(?:\w+:)?Relationship\b([^>]*)>/g)]
    .map(([, a]) => [attrOf(a, 'Id'), attrOf(a, 'Target')]));
  const shared = [...(file('xl/sharedStrings.xml') ?? '').matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)]
    .map(([, si]) => textOf(si));

  return [...wbXml.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)].map(([, a]) => {
    const target = rels.get(attrOf(a, 'r:id')) ?? '';
    const xml = file(target.startsWith('/') ? target : `xl/${target}`) ?? '';
    const rows = [];
    for (const [, cAttr, inner] of xml.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ref = attrOf(cAttr, 'r');
      const m = ref.match(/^([A-Z]+)(\d+)$/);
      if (!m) continue;
      const col = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const row = Number(m[2]) - 1;
      const type = attrOf(cAttr, 't');
      const v = (inner ?? '').match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(inner ?? '');
      else if (type === 'str' || type === 'e') value = v === undefined ? '' : unescapeXml(v);
      else if (type === 'b') value = v === '1';
      else if (v !== undefined) value = Number(v);
      (rows[row] ??= [])[col] = value;
    }
    return { name: unescapeXml(attrOf(a, 'name')), rows: Array.from(rows, (r) => Array.from(r ?? [], (x) => x ?? '')) };
  });
}

const attrOf = (s, name) => (s.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`)) ?? [])[1] ?? '';
const textOf = (xml) => unescapeXml([...xml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => m[1]).join(''));
const unescapeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');
