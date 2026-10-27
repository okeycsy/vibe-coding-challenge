import * as XLSX from 'xlsx';
import { activeInstitutions, matchExcelValue } from './institutions';

// 실적 엑셀 업로드. 형식을 고정하지 않고 표 구조를 판별해 읽는다.
// 서버가 있으면 서버(FeeExcelService.parseUpload)가 AI(키가 없거나 실패하면 규칙 기반)로 판별하고,
// 서버가 없으면(Mock) 브라우저에서 서버 규칙 기반(RuleLayoutDetector·UploadReader·UploadDate)과 같은 규칙으로 읽는다.
// 꼭 필요한 것은 기관 열(기관명 또는 기관코드)과 날짜(최소 년월)이고, 나머지 수치 열(건수·금액 등)은 자유롭다.
// 날짜는 ① 날짜 열(기준월·일자) ② 머리글이 날짜인 가로형 표 ③ 표 위 제목('2026년 3분기 실적') 순으로 찾는다.
// 산출 기간과 겹치지 않는 날짜의 행은 빼고 excluded 로 알려 준다. 결과 형태도 서버 UploadResult 와 같다.

export const MAX_UPLOAD_MB = 10; // 서버 spring.servlet.multipart.max-file-size 와 맞춘다
export const SAMPLE_FILE = `${import.meta.env.BASE_URL}samples/fee-performance-sample.xlsx`;

export class UploadError extends Error {}

// 파일을 서버에 보내기 전에 확장자·크기를 먼저 본다.
export function checkUploadFile(file) {
  if (!file) throw new UploadError('업로드할 파일을 선택해 주세요.');
  if (!/\.(xlsx|xls)$/i.test(file.name)) throw new UploadError(`엑셀 파일(.xlsx, .xls)만 올릴 수 있습니다: ${file.name}`);
  if (file.size === 0) throw new UploadError('빈 파일입니다.');
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new UploadError(`파일이 ${MAX_UPLOAD_MB}MB를 넘습니다.`);
}

const MAX_SHEETS = 10;
const MAX_ROWS = 50000;
const MAX_COLS = 60;
const HEADER_SCAN_ROWS = 30;
const SAMPLE_ROWS = 30;

const squash = (v) => String(v ?? '').replace(/\s/g, '');
const pad = (n) => String(n).padStart(2, '0');

// ── 칸 값 ── 문자열(앞뒤 공백 제거) · 숫자 · { ymd: 'YYYY-MM-DD' }(날짜 서식 칸) · 빈 칸 ''
const isDateCell = (v) => v !== null && typeof v === 'object' && typeof v.ymd === 'string';
const isEmpty = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const cellText = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (isDateCell(v)) return v.ymd;
  return String(v ?? '').trim();
};

// 칸 값 → 정수(반올림). 숫자 또는 "1,234" · "1,234건" · "1,234원". 아니면 null
export function cellNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\s건원]/g, '');
  return /^-?[\d,]+(\.\d+)?$/.test(t) && /\d/.test(t) ? Math.round(Number(t.replace(/,/g, ''))) : null;
}

// ── 날짜 (서버 UploadDate 와 같은 규칙) ── → { key, unit: DAY|MONTH|QUARTER, start, end } (start·end 는 'YYYY-MM-DD')
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dayOf = (y, m, d) => ({ key: `${y}-${pad(m)}-${pad(d)}`, unit: 'DAY', start: `${y}-${pad(m)}-${pad(d)}`, end: `${y}-${pad(m)}-${pad(d)}` });
const monthOf = (y, m) => ({ key: `${y}-${pad(m)}`, unit: 'MONTH', start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay(y, m))}` });
const quarterOf = (y, q) => {
  const m = (q - 1) * 3 + 1;
  return { key: `${y}년 ${q}분기`, unit: 'QUARTER', start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m + 2)}-${pad(lastDay(y, m + 2))}` };
};

const QUARTER_RE = /^(\d{4})\s*년?\s*[-./]?\s*(?:([1-4])\s*분기|[Qq]([1-4])|([1-4])[Qq])$/;
const YMD_RE = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/;
const COMPACT_RE = /^(\d{4})(\d{2})(\d{2})?$/;

function parseDateText(raw) {
  const t = String(raw).trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, '');
  if (!t) return null;
  const q = QUARTER_RE.exec(t);
  if (q) return quarterOf(Number(q[1]), Number(q[2] ?? q[3] ?? q[4]));
  const n = t.replace(/[년월./]/g, '-').replace(/일/g, '').replace(/\s+/g, '').replace(/-+$/, '');
  const m = YMD_RE.exec(n) ?? COMPACT_RE.exec(n);
  if (!m) return null;
  const [y, mo] = [Number(m[1]), Number(m[2])];
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12) return null;
  if (m[3] === undefined) return monthOf(y, mo);
  const d = Number(m[3]);
  return d >= 1 && d <= lastDay(y, mo) ? dayOf(y, mo, d) : null;
}

export function parseUploadDate(v) {
  if (isDateCell(v)) {
    const [y, m, d] = v.ymd.split('-').map(Number);
    return dayOf(y, m, d);
  }
  if (typeof v === 'number') return Number.isInteger(v) ? parseDateText(String(v)) : null;
  return typeof v === 'string' ? parseDateText(v) : null;
}

// 제목 문장(예: "2026년 3분기 실적")에서 날짜 찾기. 분기 먼저, 없으면 년월
export function findUploadDate(text) {
  if (!text) return null;
  const q = /(\d{4})\s*년?\s*(?:([1-4])\s*분기|[Qq]([1-4]))/.exec(text);
  if (q) return quarterOf(Number(q[1]), Number(q[2] ?? q[3]));
  const re = /(\d{4})\s*(?:[-./]|년)\s*(\d{1,2})(?!\d)/g;
  let m;
  while ((m = re.exec(text))) {
    const [y, mo] = [Number(m[1]), Number(m[2])];
    if (y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12) return monthOf(y, mo);
  }
  return null;
}

// 산출 기간과 겹치면 true (월·분기 단위는 기간과 겹치는 달·분기를 포함). from·to 는 'YYYY-MM-DD'
const overlaps = (d, from, to) => d.start <= to && d.end >= from;

// ── 시트 → 값 격자 ──
function sheetRows(ws) {
  if (!ws || !ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let r = 0; r <= Math.min(range.e.r, MAX_ROWS); r++) {
    const row = [];
    for (let c = 0; c <= Math.min(range.e.c, MAX_COLS - 1); c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      let v = '';
      if (cell && cell.v !== undefined && cell.v !== null) {
        if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
          const p = XLSX.SSF.parse_date_code(cell.v);
          v = p ? { ymd: `${p.y}-${pad(p.m)}-${pad(p.d)}` } : cell.v;
        } else if (cell.t === 'n') v = cell.v;
        else if (cell.t === 'b') v = String(cell.v);
        else if (cell.t === 'd') v = { ymd: `${cell.v.getFullYear()}-${pad(cell.v.getMonth() + 1)}-${pad(cell.v.getDate())}` };
        else if (cell.t === 's' || cell.t === 'str') v = String(cell.v).trim();
      }
      row.push(v);
    }
    // 서버(POI)처럼 행 끝의 빈 칸은 없는 것으로 본다
    while (row.length && isEmpty(row[row.length - 1])) row.pop();
    rows.push(row);
  }
  return rows;
}

const cellAt = (rows, r, c) => (r >= 0 && r < rows.length && c >= 0 && c < rows[r].length ? rows[r][c] : '');
const width = (rows) => rows.reduce((w, row) => Math.max(w, row.length), 0);
const blank = (rows, r) => r >= rows.length || rows[r].every(isEmpty);

// ── 규칙 기반 구조 판별 (서버 RuleLayoutDetector 와 같은 규칙) ──
const INST_RE = /기관|금융회사|회사|은행|참가|업체|거래처/;
const DATE_KEY_RE = /기준월|년월|연월|일자|날짜|기준일|거래일|기간|월|분기|date|month/i;
const SKIP_RE = /코드|순번|번호|연번|^no\.?$/i;
const AMOUNT_RE = /금액|수수료|요금|\(원\)|액$/;
const COUNT_RE = /건수|건|횟수|실적|조회|이체|count|cnt/i;
const PREFER_RE = /건수|실적/;

export const columnKind = (header) => {
  const h = squash(header);
  return AMOUNT_RE.test(h) ? 'AMOUNT' : COUNT_RE.test(h) ? 'COUNT' : 'NUMBER';
};

// 실적에 넣을 기본 열: 머리글에 '건수'·'실적'이 있으면 그 열만, 없으면 금액이 아닌 열 모두, 그것도 없으면 전부
function defaultUse(values) {
  const prefer = values.some((v) => PREFER_RE.test(squash(v.header)));
  const nonAmount = values.some((v) => v.kind !== 'AMOUNT');
  return values.map((v) => ({
    ...v,
    use: prefer ? PREFER_RE.test(squash(v.header)) : !nonAmount || v.kind !== 'AMOUNT',
  }));
}

function dataRows(rows, headerRow) {
  const out = [];
  for (let r = headerRow + 1; r < rows.length && out.length < SAMPLE_ROWS; r++) if (!blank(rows, r)) out.push(r);
  return out;
}

function rate(rows, data, c, test) {
  let filled = 0;
  let hit = 0;
  data.forEach((r) => {
    const v = cellAt(rows, r, c);
    if (isEmpty(v)) return;
    filled++;
    if (test(v)) hit++;
  });
  return filled === 0 ? 0 : hit / filled;
}
const textRate = (rows, data, c) => rate(rows, data, c, (v) => cellNumber(v) === null && !isDateCell(v));
const numberRate = (rows, data, c) => rate(rows, data, c, (v) => cellNumber(v) !== null);
const dateRate = (rows, data, c, keyword) =>
  rate(rows, data, c, (v) => (keyword || typeof v !== 'number') && parseUploadDate(v) !== null);

function valueColumns(rows, headerRow, data, exclude) {
  const values = [];
  for (let c = 0; c < width(rows); c++) {
    const header = cellText(cellAt(rows, headerRow, c));
    const h = squash(header);
    if (exclude.includes(c) || !h || SKIP_RE.test(h) || numberRate(rows, data, c) < 0.5) continue;
    values.push({ index: c, header, kind: columnKind(h), use: false });
  }
  return defaultUse(values);
}

function titleDate(rows, headerRow) {
  for (let r = 0; r < headerRow; r++) {
    for (const v of rows[r]) {
      const t = cellText(v);
      if (t && findUploadDate(t)) return t;
    }
  }
  return null;
}

function tryHeader(rows, s, r) {
  if (blank(rows, r)) return null;
  const data = dataRows(rows, r);
  if (!data.length) return null;
  const w = width(rows);
  let inst = -1;
  let code = -1;
  for (let c = 0; c < w; c++) {
    const h = squash(cellText(cellAt(rows, r, c)));
    if (!h || parseUploadDate(cellAt(rows, r, c))) continue;
    if (h.includes('코드')) {
      if (code < 0) code = c;
    } else if (inst < 0 && INST_RE.test(h) && textRate(rows, data, c) >= 0.5) inst = c;
  }
  if (inst < 0) [inst, code] = [code, -1];
  if (inst < 0) return null;

  let date = -1;
  for (let c = 0; c < w && date < 0; c++) {
    if (c !== inst && c !== code && DATE_KEY_RE.test(squash(cellText(cellAt(rows, r, c)))) && dateRate(rows, data, c, true) >= 0.5) date = c;
  }
  for (let c = 0; c < w && date < 0; c++) {
    if (c !== inst && c !== code && dateRate(rows, data, c, false) >= 0.8) date = c;
  }
  const base = { sheet: s, headerRow: r, institutionColumn: inst, codeColumn: code, dateColumn: -1, dateHeaderColumns: [], titleText: null };
  if (date >= 0) {
    const values = valueColumns(rows, r, data, [inst, code, date]);
    return values.length ? { ...base, dateSource: 'COLUMN', dateColumn: date, valueColumns: values } : null;
  }
  const headerDates = [];
  for (let c = 0; c < w; c++) {
    if (c !== inst && c !== code && parseUploadDate(cellAt(rows, r, c)) && numberRate(rows, data, c) >= 0.5) headerDates.push(c);
  }
  if (headerDates.length) {
    return { ...base, dateSource: 'HEADER', dateHeaderColumns: headerDates, valueColumns: [{ index: -1, header: '실적', kind: 'COUNT', use: true }] };
  }
  const title = titleDate(rows, r);
  if (title) {
    const values = valueColumns(rows, r, data, [inst, code]);
    return values.length ? { ...base, dateSource: 'TITLE', titleText: title, valueColumns: values } : null;
  }
  return null;
}

export function detectLayout(sheets) {
  for (let s = 0; s < Math.min(sheets.length, MAX_SHEETS); s++) {
    const { rows } = sheets[s];
    for (let r = 0; r < Math.min(rows.length, HEADER_SCAN_ROWS); r++) {
      const layout = tryHeader(rows, s, r);
      if (layout) return layout;
    }
  }
  return null;
}

// ── 행 읽기 (서버 UploadReader 와 같은 규칙) ──
const TOTAL_RE = /합계|소계|총계|^계$|^total$/i;

function readRows(rows, layout, period) {
  const header = layout.dateSource === 'HEADER';
  const n = header ? 1 : layout.valueColumns.length;
  const title = layout.dateSource === 'TITLE' ? findUploadDate(layout.titleText) : null;
  const out = { sums: new Map(), unmatched: [], excluded: new Map(), unreadableSamples: [], included: new Set(), units: new Set(), rowCount: 0, unreadableRows: 0 };
  const exclude = (d, vals) => {
    const e = out.excluded.get(d.key) ?? { rows: 0, values: new Array(vals.length).fill(0) };
    e.rows++;
    vals.forEach((v, i) => (e.values[i] += v));
    out.excluded.set(d.key, e);
  };
  const add = (inst, code, vals) => {
    let match = inst ? matchExcelValue(inst)?.inst : null;
    if (!match && code) match = matchExcelValue(code)?.inst;
    if (!match) {
      const label = inst || code;
      if (!out.unmatched.includes(label)) out.unmatched.push(label);
      return false;
    }
    const sum = out.sums.get(match.id) ?? new Array(vals.length).fill(0);
    vals.forEach((v, i) => (sum[i] += v));
    out.sums.set(match.id, sum);
    out.rowCount++;
    return true;
  };
  const include = (d) => {
    out.included.add(d.key);
    out.units.add(d.unit);
  };
  let last = null;
  for (let r = layout.headerRow + 1; r < rows.length; r++) {
    if (blank(rows, r)) continue;
    const inst = cellText(cellAt(rows, r, layout.institutionColumn));
    const code = layout.codeColumn >= 0 ? cellText(cellAt(rows, r, layout.codeColumn)) : '';
    if ((!inst && !code) || TOTAL_RE.test(inst.replace(/ /g, ''))) continue;
    if (layout.dateColumn >= 0 && TOTAL_RE.test(cellText(cellAt(rows, r, layout.dateColumn)).replace(/ /g, ''))) continue;

    if (header) {
      let sum = 0;
      const dates = [];
      layout.dateHeaderColumns.forEach((c) => {
        const v = cellNumber(cellAt(rows, r, c));
        const d = parseUploadDate(cellAt(rows, layout.headerRow, c));
        if (v === null || !d) return;
        if (period && !overlaps(d, period.from, period.to)) {
          exclude(d, [v]);
          return;
        }
        sum += v;
        dates.push(d);
      });
      if (dates.length && add(inst, code, [sum])) dates.forEach(include);
      continue;
    }

    const vals = new Array(n).fill(0);
    let any = false;
    layout.valueColumns.forEach((col, i) => {
      const v = cellNumber(cellAt(rows, r, col.index));
      if (v !== null) {
        vals[i] = v;
        any = true;
      }
    });
    if (!any) continue;
    let d;
    if (title) d = title;
    else {
      const raw = cellAt(rows, r, layout.dateColumn);
      d = isEmpty(raw) ? last : parseUploadDate(raw);
      if (!d) {
        out.unreadableRows++;
        if (out.unreadableSamples.length < 5) out.unreadableSamples.push(isEmpty(raw) ? `(빈 칸) ${inst}` : cellText(raw));
        continue;
      }
      last = d;
    }
    if (period && !overlaps(d, period.from, period.to)) {
      exclude(d, vals);
      continue;
    }
    if (add(inst, code, vals)) include(d);
  }
  return out;
}

// 선택한 열(use)로 기관별 건수를 다시 더한다. 화면에서 열을 바꿀 때도 쓴다
export function applyColumns(result, use) {
  const counts = result.values.map((v) => ({
    institutionId: v.institutionId,
    name: v.name,
    baseCount: Math.max(0, v.values.reduce((s, x, i) => s + (use[i] ? x : 0), 0)),
  }));
  return {
    ...result,
    columns: result.columns.map((c, i) => ({ ...c, use: !!use[i] })),
    counts,
    totalCount: counts.reduce((s, c) => s + c.baseCount, 0),
  };
}

// period = { from, to } ('YYYY-MM-DD'). 없으면 기간으로 거르지 않는다
export async function parseUploadInBrowser(file, period = null) {
  let sheets;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellNF: true });
    sheets = wb.SheetNames.slice(0, MAX_SHEETS).map((name) => ({ name, rows: sheetRows(wb.Sheets[name]) }));
  } catch {
    throw new UploadError('엑셀 파일(xlsx, xls)을 읽을 수 없습니다.');
  }
  const layout = detectLayout(sheets);
  if (!layout) {
    throw new UploadError(
      "표 구조를 판별하지 못했습니다. 기관명(또는 기관코드) 열과 날짜(최소 년월: 기준월 열, 2026-07 같은 머리글, 또는 표 위 '2026년 3분기' 같은 제목)가 필요합니다.",
    );
  }
  const { rows, name: sheetName } = sheets[layout.sheet];
  const read = readRows(rows, layout, period?.from && period?.to ? period : null);
  const values = activeInstitutions()
    .filter((i) => read.sums.has(i.id))
    .map((i) => ({ institutionId: i.id, name: i.name, values: read.sums.get(i.id) }));
  const headerText = (c) => cellText(cellAt(rows, layout.headerRow, c));
  const dateHeader =
    layout.dateSource === 'COLUMN'
      ? headerText(layout.dateColumn)
      : layout.dateSource === 'HEADER'
        ? layout.dateHeaderColumns.map(headerText).join(', ')
        : layout.titleText;
  const result = {
    fileName: file.name,
    rowCount: read.rowCount,
    unmatched: read.unmatched,
    layout: {
      sheetName,
      headerRow: layout.headerRow + 1,
      institutionHeader: headerText(layout.institutionColumn),
      dateSource: layout.dateSource,
      dateHeader,
      dateUnit: read.units.size === 0 ? null : read.units.size > 1 ? 'MIXED' : [...read.units][0],
    },
    columns: layout.valueColumns,
    values,
    excluded: [...read.excluded.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, e]) => ({ date, rows: e.rows, values: e.values })),
    unreadableRows: read.unreadableRows,
    unreadableSamples: read.unreadableSamples,
    includedDates: [...read.included].sort(),
    analysis: { mode: 'RULE', model: null, note: null, reason: null },
  };
  return applyColumns(result, layout.valueColumns.map((c) => c.use));
}
