import * as XLSX from 'xlsx';
import { activeInstitutions, matchExcelValue } from './institutions';

// 실적 엑셀 업로드. 서버(FeeExcelService.parseUpload)와 같은 규칙으로 읽는다:
// 첫 시트 위쪽 21행 안에서 기관(기관·금융회사·코드)과 건수(건수·실적) 열이 함께 있는 머리글 행을 찾고,
// 같은 기관 행은 합산, '합계' 행은 건너뛰고, 기관을 찾지 못한 행은 unmatched 로 돌려준다.
// 결과 형태도 서버 UploadResult 와 같다: { fileName, rowCount, totalCount, counts: [{ institutionId, name, baseCount }], unmatched }

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

const squash = (v) => String(v ?? '').replace(/\s/g, '');

// 기관 관리에서 추가·수정한 기관이 바로 반영되도록 읽을 때마다 현재 목록(사용 중인 기관)으로 매칭한다
const matchInstitution = (value) => matchExcelValue(value)?.inst ?? null;

function readCount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const digits = String(value ?? '').replace(/[,\s건]/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

export async function parseUploadInBrowser(file) {
  let rows;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  } catch {
    throw new UploadError('엑셀 파일(xlsx, xls)을 읽을 수 없습니다.');
  }

  let headerRow = -1;
  let instCol = -1;
  let countCol = -1;
  for (let r = 0; r < Math.min(rows.length, 21) && headerRow < 0; r++) {
    let ic = -1;
    let cc = -1;
    rows[r].forEach((cell, c) => {
      const h = squash(cell);
      if (ic < 0 && (h.includes('기관') || h.includes('금융회사') || h.includes('코드'))) ic = c;
      if (cc < 0 && (h.includes('건수') || h.includes('실적'))) cc = c;
    });
    if (ic >= 0 && cc >= 0) [headerRow, instCol, countCol] = [r, ic, cc];
  }
  if (headerRow < 0) {
    throw new UploadError("머리글 행을 찾지 못했습니다. '기관명'(또는 기관코드)과 '건수' 열이 필요합니다.");
  }

  const sums = new Map();
  const unmatched = [];
  let rowCount = 0;
  rows.slice(headerRow + 1).forEach((row) => {
    const instValue = String(row[instCol] ?? '').trim();
    if (!instValue || instValue.includes('합계')) return;
    const count = readCount(row[countCol]);
    if (count === null) return;
    const inst = matchInstitution(instValue);
    if (!inst) {
      unmatched.push(instValue);
      return;
    }
    sums.set(inst.id, (sums.get(inst.id) ?? 0) + count);
    rowCount++;
  });

  const counts = activeInstitutions().filter((i) => sums.has(i.id)).map((i) => ({
    institutionId: i.id,
    name: i.name,
    baseCount: sums.get(i.id),
  }));
  return {
    fileName: file.name,
    rowCount,
    totalCount: counts.reduce((s, c) => s + c.baseCount, 0),
    counts,
    unmatched,
  };
}
