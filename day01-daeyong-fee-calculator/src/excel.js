// 엑셀 읽기·쓰기 (SheetJS)
import * as XLSX from 'xlsx';
import { sampleSheetRows } from './sampleData.js';

// 머리글 이름이 조금 달라도 찾을 수 있게 키워드로 매칭 (공백 제거 후 포함 여부)
const COLUMNS = {
  name: ['기관명', '기관', '참가기관', '회원사', '은행명'],
  seizure: ['압류'],
  collection: ['추심'],
  release: ['해제'],
  total: ['합계', '총계', '계'],
};

const norm = (v) => String(v ?? '').replace(/\s+/g, '');

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

// 시트의 2차원 배열에서 기관별 건수를 뽑는다
export function parseRows(aoa) {
  // 압류·추심·해제가 모두 있는 첫 행을 머리글로 본다 (위에 제목 행이 있어도 됨)
  const headerIdx = aoa.findIndex((row) => {
    const cells = row.map(norm);
    return ['압류', '추심', '해제'].every((kw) => cells.some((c) => c.includes(kw)));
  });
  if (headerIdx === -1) {
    throw new Error('머리글에서 압류·추심·해제 열을 찾지 못했습니다. 첫 시트에 해당 열이 있는지 확인해 주세요.');
  }
  const header = aoa[headerIdx];
  const used = new Set();
  const col = {};
  // 건수 열을 먼저 잡고, 기관명·합계는 남은 열에서 찾는다 ('합계건수'가 '압류'로 오인되지 않게)
  for (const key of ['seizure', 'collection', 'release', 'name', 'total']) {
    col[key] = findColumn(header, COLUMNS[key], used);
    if (col[key] !== -1) used.add(col[key]);
  }
  if (col.name === -1) {
    // 기관명 머리글이 없으면 첫 번째 남은 열을 기관명으로 쓴다
    col.name = header.findIndex((_, i) => !used.has(i));
  }

  const orgs = [];
  const warnings = [];
  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const name = String(row[col.name] ?? '').trim();
    if (!name) continue;
    // 표 아래의 합계 행은 건너뛴다
    if (/^(합계|총계|계|소계|total)$/i.test(norm(name))) continue;

    const seizure = toCount(row[col.seizure]);
    const collection = toCount(row[col.collection]);
    const release = toCount(row[col.release]);
    const line = r + 1;
    if ([seizure, collection, release].some((n) => Number.isNaN(n) || n < 0)) {
      throw new Error(`${line}행(${name})의 건수가 숫자가 아니거나 음수입니다.`);
    }
    if (col.total !== -1) {
      const given = toCount(row[col.total]);
      const sum = seizure + collection + release;
      if (row[col.total] !== undefined && row[col.total] !== '' && given !== sum) {
        warnings.push(`${line}행(${name}): 파일의 합계 ${given}건과 압류+추심+해제 ${sum}건이 달라 계산값(${sum}건)을 사용했습니다.`);
      }
    }
    orgs.push({ name, seizure, collection, release });
  }

  if (orgs.length === 0) throw new Error('기관 데이터 행이 없습니다.');
  const dup = orgs.map((o) => o.name).filter((n, i, arr) => arr.indexOf(n) !== i);
  if (dup.length) warnings.push(`기관명이 중복됩니다: ${[...new Set(dup)].join(', ')}`);

  return { orgs, warnings };
}

export function parseWorkbook(data) {
  const wb = XLSX.read(data, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  return parseRows(aoa);
}

// 산출 결과를 엑셀 워크북으로 만든다
export function buildResultWorkbook(result, { sourceName = '', date = new Date() } = {}) {
  const pct = (x) => Math.round(x * 1e6) / 1e4; // 소수 넷째 자리까지 %
  const header = ['순번', '기관명', '압류건수', '추심건수', '해제건수', '합계건수', '건수비율(%)', '균등분담액(25%)', '건수비례분담액(75%)', '회비'];
  const body = result.rows.map((r, i) => [
    i + 1, r.name, r.seizure, r.collection, r.release, r.count, pct(r.ratio), r.equalShare, r.ratioShare, r.fee,
  ]);
  const t = result.totals;
  const totalRow = ['합계', '', t.seizure, t.collection, t.release, t.count, 100, t.equalShare, t.ratioShare, t.fee];

  const ws = XLSX.utils.aoa_to_sheet([header, ...body, totalRow]);
  ws['!cols'] = [6, 20, 10, 10, 10, 10, 12, 16, 18, 16].map((wch) => ({ wch }));
  const won = '#,##0';
  for (let r = 1; r <= body.length + 1; r++) {
    for (const c of [2, 3, 4, 5, 7, 8, 9]) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) cell.z = won;
    }
  }

  const info = XLSX.utils.aoa_to_sheet([
    ['항목', '값'],
    ['산출일', date.toISOString().slice(0, 10)],
    ['원본 파일', sourceName],
    ['회비 총액(원)', result.totalFee],
    ['기관 수', result.rows.length],
    ['균등분 비율', '25%'],
    ['균등분 총액(원)', result.equalPool],
    ['건수비례분 총액(원)', result.ratioPool],
    ['전체 건수(압류+추심+해제)', result.totalCount],
    ['원 단위 처리', '원 미만 버림 후 남는 원은 소수점 이하가 큰 기관부터 1원씩 배정(합계가 총액과 일치)'],
  ]);
  info['!cols'] = [{ wch: 26 }, { wch: 70 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '회비산출결과');
  XLSX.utils.book_append_sheet(wb, info, '산출기준');
  return wb;
}

// 예시 입력 양식 워크북
export function buildSampleWorkbook() {
  const ws = XLSX.utils.aoa_to_sheet(sampleSheetRows());
  ws['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
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
