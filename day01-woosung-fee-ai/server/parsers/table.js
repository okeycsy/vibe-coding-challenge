// 표(2차원 배열)를 실적 레코드 [{ institution, month, item, count }]로 바꾼다.
// 엑셀·HWP·HWPX 모두 표를 뽑은 다음 여기로 넘긴다.
//
// 지원하는 표 모양
// - 세로형: 금융기관명 | 월 | 항목1 | 항목2 ...      (한 행 = 기관 × 월)
// - 가로형: 금융기관명 | 7월 | 8월 | 9월               (항목 하나, 이름은 '건수')
// - 가로형(항목열): 금융기관명 | 항목 | 7월 | 8월 | 9월 (한 행 = 기관 × 항목)
import { parseMonth } from '../engine/period.js';

const INSTITUTION = /^(금융)?기관(명)?$|^은행(명)?$|^참가기관(명)?$|^회원(기관)?(명)?$|^기관\s*이름$/;
const MONTH = /^(기준)?(년)?월$|^실적\s*월$|^년월$|^기간$/;
const ITEM = /^(실적\s*)?항목(명)?$|^구분$|^거래\s*(종류|구분)$/;
const SKIP_ROW = /^(합\s*계|총\s*계|소\s*계|계|total)$/i;
const SKIP_COL = /^(합\s*계|총\s*계|계|비고|순번|번호|no\.?|연번|비율|구성비)$/i;

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const key = (v) => norm(v).replace(/\s/g, '');

export function parseCount(v) {
  if (typeof v === 'number') return v;
  const s = norm(v).replace(/[,\s]|건$/g, '');
  if (s === '' || s === '-') return 0;
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

// 열 이름에 붙은 단위 표기 '(건)' 등을 뗀다.
const cleanHeader = (v) => norm(v).replace(/\s*\((건|건수|단위[^)]*)\)\s*$/, '');

export function tableToRecords(rows, { year } = {}) {
  const headerIdx = rows.slice(0, 15).findIndex((r) => r.some((c) => INSTITUTION.test(key(c))));
  if (headerIdx < 0) return null;
  const header = rows[headerIdx].map(cleanHeader);
  const instCol = header.findIndex((c) => INSTITUTION.test(key(c)));
  const monthCol = header.findIndex((c, i) => i !== instCol && MONTH.test(key(c)));
  const itemCol = header.findIndex((c, i) => i !== instCol && ITEM.test(key(c)));
  const body = rows.slice(headerIdx + 1);
  const records = [];
  const problems = [];

  const pushRow = (rowNo, institution, month, item, raw) => {
    const count = parseCount(raw);
    if (Number.isNaN(count)) { problems.push(`${rowNo}행 '${institution}' ${item}: 숫자가 아님(${norm(raw)})`); return; }
    records.push({ institution, month, item, count });
  };

  if (monthCol >= 0) {
    // 세로형
    const itemCols = header.map((h, i) => ({ h, i }))
      .filter(({ h, i }) => i !== instCol && i !== monthCol && h && !SKIP_COL.test(key(h)));
    body.forEach((r, k) => {
      const institution = norm(r[instCol]);
      if (!institution || SKIP_ROW.test(key(institution))) return;
      const pm = parseMonth(r[monthCol]);
      if (!pm) { problems.push(`${headerIdx + k + 2}행 '${institution}': 월(${norm(r[monthCol])})을 읽지 못함`); return; }
      const month = toYm(pm, year);
      for (const { h, i } of itemCols) pushRow(headerIdx + k + 2, institution, month, h, r[i]);
    });
  } else {
    // 가로형: 월 모양의 열 이름
    const monthCols = header.map((h, i) => ({ pm: i === instCol ? null : parseMonth(h), i })).filter((x) => x.pm);
    if (!monthCols.length) return null;
    body.forEach((r, k) => {
      const institution = norm(r[instCol]);
      if (!institution || SKIP_ROW.test(key(institution))) return;
      const item = itemCol >= 0 ? norm(r[itemCol]) || '건수' : '건수';
      if (itemCol >= 0 && SKIP_ROW.test(key(item))) return;
      for (const { pm, i } of monthCols) pushRow(headerIdx + k + 2, institution, toYm(pm, year), item, r[i]);
    });
  }
  return { records, problems, layout: monthCol >= 0 ? 'long' : 'wide' };
}

function toYm(pm, year) {
  const y = pm.year ?? year;
  if (!y) return `????-${String(pm.month).padStart(2, '0')}`;
  return `${y}-${String(pm.month).padStart(2, '0')}`;
}
