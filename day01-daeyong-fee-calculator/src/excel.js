// 엑셀 읽기·쓰기 (SheetJS)
import * as XLSX from 'xlsx';
import { sampleSheetRows } from './sampleData.js';
import { toQuarter, toQuarterFromParts } from './period.js';

// 머리글 이름이 조금 달라도 찾을 수 있게 키워드로 매칭 (공백 제거 후 포함 여부)
const COLUMNS = {
  name: ['기관명', '기관', '참가기관', '회원사', '은행명'],
  seizure: ['압류'],
  collection: ['추심'],
  release: ['해제'],
  total: ['합계', '총계'],
  period: ['기준년월', '년월', '연월', '기준일', '일자', '날짜', '기간', 'date', 'month', 'period'],
  quarter: ['분기', 'quarter'],
  year: ['연도', '년도', 'year'],
};

const norm = (v) => String(v ?? '').replace(/\s+/g, '').toLowerCase();

function findColumn(header, keywords, used) {
  for (const kw of keywords) {
    const idx = header.findIndex((h, i) => !used.has(i) && norm(h).includes(kw));
    if (idx !== -1) return idx;
  }
  return -1;
}

function toCount(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s건]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

const showValue = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

// 시트 하나의 2차원 배열에서 건수 행을 뽑는다.
// 반환: { records: [{ name, period, seizure, collection, release }], warnings, periodFrom }
//   periodFrom: 'column'(기간 열) | 'sheet'(시트 이름) | null(기간 없음)
export function parseRows(aoa, { sheetName = '' } = {}) {
  const where = sheetName ? `[${sheetName}] ` : '';
  // 압류·추심·해제가 모두 있는 첫 행을 머리글로 본다 (위에 제목 행이 있어도 됨)
  const headerIdx = aoa.findIndex((row) => {
    const cells = row.map(norm);
    return ['압류', '추심', '해제'].every((kw) => cells.some((c) => c.includes(kw)));
  });
  if (headerIdx === -1) {
    throw new Error(`${where}머리글에서 압류·추심·해제 열을 찾지 못했습니다.`);
  }
  const header = aoa[headerIdx];
  const used = new Set();
  const col = {};
  // 건수 열을 먼저 잡고, 나머지는 남은 열에서 찾는다 ('합계건수'가 '압류'로 오인되지 않게)
  for (const key of ['seizure', 'collection', 'release', 'name', 'total', 'period', 'quarter', 'year']) {
    col[key] = findColumn(header, COLUMNS[key], used);
    if (col[key] !== -1) used.add(col[key]);
  }
  // '월' 열은 머리글이 정확히 '월'인 경우만 (다른 머리글에 '월'이 흔히 들어가므로)
  col.month = header.findIndex((h, i) => !used.has(i) && ['월', '기준월'].includes(norm(h)));
  if (col.name === -1) {
    // 기관명 머리글이 없으면 첫 번째 남은 열을 기관명으로 쓴다
    col.name = header.findIndex((_, i) => !used.has(i) && i !== col.month);
  }

  // 기간 읽는 방법: 기간 열 → 연도+분기/월 열 → 시트 이름
  let periodOf = null;
  let periodFrom = null;
  if (col.period !== -1) {
    periodOf = (row) => [toQuarter(row[col.period]), row[col.period]];
    periodFrom = 'column';
  } else if (col.year !== -1 && (col.quarter !== -1 || col.month !== -1)) {
    periodOf = (row) => [
      toQuarterFromParts(row[col.year], row[col.month], col.quarter !== -1 ? row[col.quarter] : undefined),
      `${row[col.year]} ${col.quarter !== -1 ? row[col.quarter] : row[col.month]}`,
    ];
    periodFrom = 'column';
  } else if (col.quarter !== -1) {
    periodOf = (row) => [toQuarter(row[col.quarter]), row[col.quarter]];
    periodFrom = 'column';
  } else if (toQuarter(sheetName)) {
    const q = toQuarter(sheetName);
    periodOf = () => [q, sheetName];
    periodFrom = 'sheet';
  }

  const records = [];
  const warnings = [];
  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const name = String(row[col.name] ?? '').trim();
    if (!name) continue;
    // 표 아래의 합계 행은 건너뛴다
    if (/^(합계|총계|계|소계|total)$/i.test(norm(name))) continue;

    const line = r + 1;
    const seizure = toCount(row[col.seizure]);
    const collection = toCount(row[col.collection]);
    const release = toCount(row[col.release]);
    if ([seizure, collection, release].some((n) => Number.isNaN(n) || n < 0)) {
      throw new Error(`${where}${line}행(${name})의 건수가 숫자가 아니거나 음수입니다.`);
    }
    let period = null;
    if (periodOf) {
      const [q, raw] = periodOf(row);
      if (!q) throw new Error(`${where}${line}행(${name})의 기간 '${showValue(raw)}'을(를) 년·월이나 분기로 읽지 못했습니다.`);
      period = q;
    }
    if (col.total !== -1 && row[col.total] !== undefined && row[col.total] !== '') {
      const given = toCount(row[col.total]);
      const sum = seizure + collection + release;
      if (given !== sum) {
        warnings.push(`${where}${line}행(${name}): 파일의 합계 ${given}건과 압류+추심+해제 ${sum}건이 달라 계산값(${sum}건)을 사용했습니다.`);
      }
    }
    records.push({ name, period, seizure, collection, release });
  }
  return { records, warnings, periodFrom };
}

// 워크북의 모든 시트에서 건수 행을 모은다. 압류·추심·해제 머리글이 없는 시트는 건너뛴다.
export function parseWorkbook(data) {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const records = [];
  const warnings = [];
  const periodFroms = new Set();
  for (const sheetName of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    let parsed;
    try {
      parsed = parseRows(aoa, { sheetName: wb.SheetNames.length > 1 ? sheetName : '' });
    } catch (err) {
      if (/머리글/.test(err.message)) continue;
      throw err;
    }
    records.push(...parsed.records);
    warnings.push(...parsed.warnings);
    periodFroms.add(parsed.periodFrom);
  }
  if (periodFroms.size === 0) {
    throw new Error('압류·추심·해제 열이 있는 시트를 찾지 못했습니다.');
  }
  if (records.length === 0) throw new Error('기관 데이터 행이 없습니다.');
  if (periodFroms.has(null) && periodFroms.size > 1) {
    warnings.push('기간을 알 수 없는 시트의 행은 분기 대신 "전체"로 따로 묶었습니다.');
  }
  return { records, warnings };
}

// 분기별 산출 결과를 엑셀 워크북으로 만든다.
// quarters: [{ label, result }]  (result는 calculateFees 반환값)
export function buildResultWorkbook(quarters, { sourceName = '', date = new Date() } = {}) {
  const won = '#,##0';
  const setFormat = (ws, rows, cols, z) => {
    for (let r = 1; r <= rows; r++) {
      for (const c of cols) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === 'number') cell.z = z;
      }
    }
  };
  const wb = XLSX.utils.book_new();
  const single = quarters.length === 1;

  if (!single) {
    // 분기별 요약
    const summary = [
      ['분기', '기관 수', '압류+추심+해제 건수', '회비 총액', '균등분(25%)', '건수비례분(75%)'],
      ...quarters.map(({ label, result }) => [label, result.rows.length, result.totalCount, result.totalFee, result.equalPool, result.ratioPool]),
    ];
    summary.push(['합계', '', ...[2, 3, 4, 5].map((c) => summary.slice(1).reduce((a, r) => a + r[c], 0))]);
    const ws = XLSX.utils.aoa_to_sheet(summary);
    ws['!cols'] = [14, 10, 20, 16, 16, 16].map((wch) => ({ wch }));
    setFormat(ws, summary.length, [2, 3, 4, 5], won);
    XLSX.utils.book_append_sheet(wb, ws, '분기별요약');

    // 기관 × 분기 회비표
    const names = [];
    for (const { result } of quarters) for (const r of result.rows) if (!names.includes(r.name)) names.push(r.name);
    const feeOf = quarters.map(({ result }) => new Map(result.rows.map((r) => [r.name, r.fee])));
    const matrix = [
      ['기관명', ...quarters.map((q) => q.label), '합계'],
      ...names.map((n) => {
        const fees = feeOf.map((m) => m.get(n) ?? 0);
        return [n, ...fees, fees.reduce((a, b) => a + b, 0)];
      }),
    ];
    matrix.push(['합계', ...matrix[0].slice(1).map((_, c) => matrix.slice(1).reduce((a, r) => a + r[c + 1], 0))]);
    const wm = XLSX.utils.aoa_to_sheet(matrix);
    wm['!cols'] = [{ wch: 18 }, ...matrix[0].slice(1).map(() => ({ wch: 14 }))];
    setFormat(wm, matrix.length, matrix[0].map((_, i) => i).slice(1), won);
    XLSX.utils.book_append_sheet(wb, wm, '기관별분기회비');
  }

  // 분기별 상세
  const pct = (x) => Math.round(x * 1e6) / 1e4; // 소수 넷째 자리까지 %
  const header = ['순번', '기관명', '압류건수', '추심건수', '해제건수', '합계건수', '건수비율(%)', '균등분담액(25%)', '건수비례분담액(75%)', '회비'];
  for (const { label, result } of quarters) {
    const body = result.rows.map((r, i) => [
      i + 1, r.name, r.seizure, r.collection, r.release, r.count, pct(r.ratio), r.equalShare, r.ratioShare, r.fee,
    ]);
    const t = result.totals;
    const ws = XLSX.utils.aoa_to_sheet([
      header, ...body, ['합계', '', t.seizure, t.collection, t.release, t.count, 100, t.equalShare, t.ratioShare, t.fee],
    ]);
    ws['!cols'] = [6, 20, 10, 10, 10, 10, 12, 16, 18, 16].map((wch) => ({ wch }));
    setFormat(ws, body.length + 1, [2, 3, 4, 5, 7, 8, 9], won);
    XLSX.utils.book_append_sheet(wb, ws, single ? '회비산출결과' : label.slice(0, 31));
  }

  const info = XLSX.utils.aoa_to_sheet([
    ['항목', '값'],
    ['산출일', date.toISOString().slice(0, 10)],
    ['원본 파일', sourceName],
    ['산출 단위', single ? '전체 1회' : `분기(3개월)별 ${quarters.length}회: ${quarters[0].label} ~ ${quarters.at(-1).label}`],
    ['회비 총액 합계(원)', quarters.reduce((a, q) => a + q.result.totalFee, 0)],
    ['분기 구분', '1~3월 1분기, 4~6월 2분기, 7~9월 3분기, 10~12월 4분기'],
    ['같은 기관명', '같은 분기 안에서 건수를 합산해 한 기관으로 계산'],
    ['균등분', '분기 회비 총액의 25%를 그 분기 데이터에 있는 기관 수로 균등 분배'],
    ['건수비례분', '분기 회비 총액의 75%를 그 분기 (압류+추심+해제) 건수 비율로 안분'],
    ['원 단위 처리', '원 미만 버림 후 남는 원은 소수점 이하가 큰 기관부터 1원씩 배정(합계가 총액과 일치)'],
  ]);
  info['!cols'] = [{ wch: 20 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, info, '산출기준');
  return wb;
}

// 예시 입력 양식 워크북
export function buildSampleWorkbook() {
  const ws = XLSX.utils.aoa_to_sheet(sampleSheetRows());
  ws['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '건수');
  return wb;
}

// 파일로 저장. claude.ai 웹 페이지 안에서는 다운로드 확인 창을 거치고, 그 밖에서는 브라우저가 바로 내려받는다.
export async function saveWorkbook(wb, filename) {
  if (typeof window !== 'undefined' && window.claude?.use) {
    const downloads = await window.claude.use('downloads');
    if (downloads) {
      const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      await downloads.save({ filename, data });
      return;
    }
    throw new Error('이 화면에서는 파일 저장을 쓸 수 없습니다.');
  }
  XLSX.writeFile(wb, filename);
}
