// R-10 엑셀 실적 업로드: 머리글 찾기 → 열 매핑 추정 → 검증 → 미리보기 → 적용.
// 엑셀 읽기(SheetJS)는 화면 쪽에서 하고, 여기는 2차원 배열(aoa)만 받는다.

export const ROLE_LABELS = {
  org: '기관명',
  total: '합계 (검증에만 사용)',
  period: '기간 (기준년월·일자·분기)',
  year: '연도 (기간 열에 연도가 없을 때)',
  new: '새 실적 항목 (추가 필요)',
  ignore: '사용 안 함',
};
export const roleLabel = (role, items) => (role?.startsWith('item:') ? (items.find((i) => `item:${i.id}` === role)?.name ?? '(삭제된 항목)') : ROLE_LABELS[role] ?? role);

const cell = (v) => (v === null || v === undefined ? '' : v instanceof Date ? isoDate(v) : String(v).trim());
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isBlankRow = (row) => !row || row.every((v) => cell(v) === '');
const TOTAL_ROW = /^(합\s*계|총\s*계|계|소\s*계|total)$/i;

// D-15 기관명 동일성: ignoreSpaces면 공백을 모두 지우고 비교
export const normalizeName = (name, mode = 'ignoreSpaces') => (mode === 'exact' ? cell(name) : cell(name).replace(/\s+/g, ''));

// 머리글 행: 글자 셀이 2개 이상이고, 그 아래에 숫자가 있는 행이 오는 첫 행
export function detectHeaderRow(aoa) {
  for (let i = 0; i < Math.min(aoa.length, 30); i += 1) {
    const row = aoa[i] ?? [];
    const texts = row.filter((v) => typeof v === 'string' && v.trim() !== '').length;
    if (texts < 2) continue;
    const below = aoa.slice(i + 1).find((r) => !isBlankRow(r));
    if (!below) return i;
    if (below.some((v) => typeof v === 'number' || (typeof v === 'string' && /^[\d,.\s-]+$/.test(v.trim()) && v.trim() !== ''))) return i;
  }
  return 0;
}

const squash = (s) => cell(s).replace(/\s+/g, '').toLowerCase();
const stem = (s) => squash(s).replace(/(건수|건|수|횟수|count)$/i, '');

// 열 매핑 추정 (R-10.2). saved = 저장된 { 머리글: 역할 } (R-10.2 재사용)
export function guessMapping(headers, items, saved = {}) {
  const mapping = {};
  let orgDone = false;
  headers.forEach((h, idx) => {
    const text = cell(h);
    if (text === '') { mapping[idx] = 'ignore'; return; }
    if (saved[text]) { mapping[idx] = saved[text]; if (saved[text] === 'org') orgDone = true; return; }
    const s = squash(text);
    const item = items.find((i) => stem(i.name) && (stem(text) === stem(i.name) || s.includes(stem(i.name)) || stem(i.name).includes(stem(text))));
    if (item) mapping[idx] = `item:${item.id}`;
    else if (!orgDone && /기관|회사|은행|금융|참가|명칭|이름|^명$|name/.test(s)) { mapping[idx] = 'org'; orgDone = true; }
    else if (/^(합계|총계|계|소계|total|sum)$|합계/.test(s)) mapping[idx] = 'total';
    else if (/^(연도|년도|년|기준연도|기준년도|회계연도|year)$/.test(s)) mapping[idx] = 'year';
    else if (/년월|기준월|기준년|일자|날짜|기간|분기|^월$|year|month|date|period/.test(s)) mapping[idx] = 'period';
    else if (/순번|번호|비고|no\.?$|^no$|구분/.test(s)) mapping[idx] = 'ignore';
    else mapping[idx] = 'new';
  });
  return mapping;
}

// 기간 표기 정리: '2026년도'→'2026년', '제1분기'·'1/4분기'·'1사분기'→'1분기', 'Q1 2026'·'2026 1Q'→'2026Q1', 2자리 연도
const tidyPeriod = (t) => t.replace(/\s+/g, '').toUpperCase()
  .replace(/년도/g, '년')
  .replace(/제([1-4])/g, '$1')
  .replace(/([1-4])(?:\/4|사)분기/g, '$1분기')
  .replace(/^Q([1-4])[-./]?(\d{4})$/, '$2Q$1')
  .replace(/^(\d{4})[-./년]?([1-4])Q$/, '$1Q$2');

// 기간 값 → { from, to } (yyyy-mm-dd). 못 읽으면 null
export function periodRange(v) {
  if (v instanceof Date) { const d = isoDate(v); return { from: d, to: d }; }
  const raw = cell(v);
  if (raw === '') return null;
  // 기간 범위 ('2026.01.01 ~ 2026.03.31', '2026-01 - 2026-03', '1월부터 3월까지')
  const parts = raw.split(/\s*(?:~|〜|∼|\s-\s|부터|까지)\s*/).filter(Boolean);
  if (parts.length === 2) {
    const a = periodRange(parts[0]);
    const b = periodRange(parts[1]);
    return a && b && a.from <= b.to ? { from: a.from, to: b.to } : null;
  }
  const t = tidyPeriod(raw);
  let m;
  if ((m = t.match(/^(\d{4}|\d{2})년?[-./]?([1-4])(?:분기|Q)$/))) return quarterRange(year2(m[1]), +m[2]);
  if ((m = t.match(/^(\d{4})[-./년]?Q([1-4])$/))) return quarterRange(+m[1], +m[2]);
  if ((m = t.match(/^(\d{4})[-./년](\d{1,2})[-./월](\d{1,2})일?$/))) { const d = `${m[1]}-${pad(m[2])}-${pad(m[3])}`; return { from: d, to: d }; }
  if ((m = t.match(/^(\d{4})[-./년](\d{1,2})월?$/))) return monthRange(+m[1], +m[2]);
  if ((m = t.match(/^(\d{4})년$/))) return { from: `${m[1]}-01-01`, to: `${m[1]}-12-31` };
  if ((m = t.match(/^(\d{4})(\d{2})(\d{2})$/))) { const d = `${m[1]}-${m[2]}-${m[3]}`; return { from: d, to: d }; }
  if ((m = t.match(/^(\d{4})(\d{2})$/))) return monthRange(+m[1], +m[2]);
  return null;
}
const year2 = (s) => (s.length === 2 ? 2000 + Number(s) : Number(s));

// '2026', 2026, '2026년', '2026년도' → 2026
export function toYear(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.getFullYear();
  const m = String(v).trim().match(/^(\d{4})(?:년도?)?$/);
  const y = m ? +m[1] : typeof v === 'number' ? v : NaN;
  return y >= 1990 && y <= 2100 ? y : null;
}

// 연도가 없는 기간 값('1분기', 'Q1', '3월', 숫자 1~4·1~12)은 연도 열이나 산출 연도로 읽는다.
// unitHint: 머리글로 본 단위 ('quarter' | 'month' | null). 반환: 범위 | { needYear: true } | null
export function parsePeriodCell(v, { year = null, unitHint = null } = {}) {
  const direct = periodRange(v);
  if (direct) return direct;
  if (v instanceof Date || cell(v) === '') return null;
  const s = tidyPeriod(cell(v));
  let q = null;
  let mo = null;
  let m;
  if ((m = s.match(/^([1-4])(?:분기|Q)$/)) || (m = s.match(/^Q([1-4])$/))) q = +m[1];
  else if ((m = s.match(/^(\d{1,2})월$/))) mo = +m[1];
  else if ((m = s.match(/^(\d{1,2})$/))) {
    if (unitHint === 'quarter') q = +m[1];
    else if (unitHint === 'month') mo = +m[1];
  }
  if (q === null && mo === null) return null;
  const y = toYear(year);
  if (!y) return { needYear: true };
  return q !== null ? quarterRange(y, q) : monthRange(y, mo);
}
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, mo) => new Date(y, mo, 0).getDate();
const monthRange = (y, mo) => (mo >= 1 && mo <= 12 ? { from: `${y}-${pad(mo)}-01`, to: `${y}-${pad(mo)}-${pad(lastDay(y, mo))}` } : null);
export const quarterRange = (y, q) => (q >= 1 && q <= 4 ? { from: `${y}-${pad(q * 3 - 2)}-01`, to: `${y}-${pad(q * 3)}-${pad(lastDay(y, q * 3))}` } : null);
const within = (r, start, end) => (!start || r.from >= start) && (!end || r.to <= end);

// 건수 셀 → { value, error }
function parseCount(v) {
  if (v === null || v === undefined || cell(v) === '') return { value: 0 };
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return { error: `숫자가 아닌 값 '${cell(v)}'` };
  if (n < 0) return { error: `음수 ${n}` };
  if (!Number.isInteger(n)) return { error: `소수 ${n} (건수는 정수)` };
  return { value: n };
}

/*
미리보기 + 검증 (R-10.4)
  aoa, headerIdx, mapping      엑셀 2차원 배열, 머리글 행, { 열 번호: 역할 }
  items, recognized            실적 항목, 인정 항목 id
  orgs                         등록된 참가기관 [{ id, name, active }]
  period                       { start, end } 실적 기준기간 (비우면 기간 필터 없음)
  d                            { 'D-11': value, 'D-12': value, 'D-15': value }
  nameMap                      { 파일 기관명: orgId | '' }  담당자가 연결한 기관 ('' = 연결 안 함·제외)
  edits                        { 파일 기관명: { itemId: '문자열' } }  미리보기에서 고친 값
  autoAddOrgs                  미등록 기관을 적용할 때 새 참가기관으로 등록 (R-10.7)
  defaultYear                  기간 열에 연도가 없고 연도 열도 없을 때 쓸 연도 (업로드 정보의 산출 연도)
*/
export function buildPreview({ aoa, headerIdx, mapping, items, recognized, orgs, period = {}, d = {}, nameMap = {}, edits = {}, autoAddOrgs = true, defaultYear = null }) {
  const issues = [];
  const push = (level, message, where = {}) => issues.push({ level, message, ...where });
  const dup = d['D-12'] ?? 'sum';
  const missing = d['D-11'] ?? 'zero';
  const nameMode = d['D-15'] ?? 'ignoreSpaces';

  const cols = Object.entries(mapping).map(([idx, role]) => ({ idx: Number(idx), role }));
  const orgCol = cols.find((c) => c.role === 'org')?.idx;
  const totalCol = cols.find((c) => c.role === 'total')?.idx;
  const periodCol = cols.find((c) => c.role === 'period')?.idx;
  const yearCol = cols.find((c) => c.role === 'year')?.idx;
  const periodHeader = periodCol === undefined ? '' : cell(aoa[headerIdx]?.[periodCol]);
  const unitHint = /분기|quarter/i.test(periodHeader) ? 'quarter' : /월|month/i.test(periodHeader) ? 'month' : null;
  let lastPeriod = null; // 셀 병합으로 비어 있는 기간·연도 칸은 바로 위 행의 값을 이어 쓴다
  let lastYear = null;
  let carried = 0;
  let yearDefaulted = 0;
  let minFrom = '';
  let maxTo = '';
  const itemCols = cols.filter((c) => c.role.startsWith('item:')).map((c) => ({ idx: c.idx, itemId: c.role.slice(5) }));
  const newCols = cols.filter((c) => c.role === 'new').map((c) => ({ idx: c.idx, header: cell(aoa[headerIdx]?.[c.idx]) }));
  if (orgCol === undefined) push('error', '기관명 열을 지정하세요.');
  for (const id of recognized) {
    if (!itemCols.some((c) => c.itemId === id)) push('error', `인정 실적 항목 '${items.find((i) => i.id === id)?.name ?? id}'에 연결된 열이 없습니다.`);
  }
  for (const c of newCols) push('info', `'${c.header}' 열은 등록되지 않은 항목입니다. 새 실적 항목으로 추가하거나 '사용 안 함'으로 두세요.`);

  const registered = new Map(orgs.map((o) => [normalizeName(o.name, nameMode), o]));
  const groups = new Map(); // 정규화한 기관명 → 미리보기 행
  let excludedByPeriod = 0;
  let totalRows = 0;
  let totalSkip = 0;

  aoa.slice(headerIdx + 1).forEach((row, i) => {
    const rowNo = headerIdx + i + 2; // 엑셀 행 번호 (1부터)
    if (isBlankRow(row)) return;
    const rawName = orgCol === undefined ? '' : cell(row[orgCol]);
    if (TOTAL_ROW.test(rawName)) { totalSkip += 1; return; }
    if (rawName === '') { totalRows += 1; push('error', `${rowNo}행: 기관명이 비어 있습니다.`, { row: rowNo }); return; }
    if (periodCol !== undefined) {
      let pv = row[periodCol];
      if (cell(pv) === '' && lastPeriod !== null) { pv = lastPeriod; carried += 1; }
      lastPeriod = pv;
      let yv = yearCol === undefined ? null : row[yearCol];
      if (yearCol !== undefined) { if (cell(yv) === '') yv = lastYear; lastYear = yv; }
      const r = parsePeriodCell(pv, { year: yv ?? defaultYear, unitHint });
      if (!r || r.needYear) {
        const why = r?.needYear ? '연도가 없어 어느 해인지 알 수 없습니다. 연도 열을 지정하거나 업로드 정보의 산출 연도를 입력하세요.' : '2026년 1분기, 2026-Q1, 1/4분기, 2026-03, 2026-03-31 같은 형식이면 읽을 수 있습니다.';
        totalRows += 1;
        push('error', `${rowNo}행 '${rawName}': 기간 '${cell(pv)}'을(를) 날짜로 읽지 못했습니다. ${why}`, { row: rowNo, org: rawName });
        return;
      }
      if (!yv && defaultYear && !/\d{4}/.test(cell(pv)) && !(pv instanceof Date)) yearDefaulted += 1;
      if (!minFrom || r.from < minFrom) minFrom = r.from;
      if (!maxTo || r.to > maxTo) maxTo = r.to;
      if ((period.start || period.end) && !within(r, period.start, period.end)) { excludedByPeriod += 1; return; }
    }
    totalRows += 1;
    const key = normalizeName(rawName, nameMode);
    let g = groups.get(key);
    if (!g) {
      g = { key, name: rawName, srcRows: [], counts: Object.fromEntries(items.map((it) => [it.id, 0])), fileTotal: 0, hasTotal: false, errors: [] };
      groups.set(key, g);
    } else if (dup === 'error') {
      push('error', `${rowNo}행: '${rawName}'이(가) 여러 행에 있습니다 (D-12: 오류).`, { row: rowNo, org: rawName });
    }
    g.srcRows.push(rowNo);
    for (const c of itemCols) {
      const edited = edits[rawName]?.[c.itemId];
      const p = parseCount(edited !== undefined && g.srcRows.length === 1 ? edited : row[c.idx]);
      if (p.error) {
        const itemName = items.find((it) => it.id === c.itemId)?.name ?? c.itemId;
        g.errors.push({ itemId: c.itemId, message: p.error });
        push('error', `${rowNo}행 '${rawName}' ${itemName}: ${p.error}`, { row: rowNo, org: rawName, itemId: c.itemId });
      } else g.counts[c.itemId] += p.value;
    }
    if (totalCol !== undefined) {
      const p = parseCount(row[totalCol]);
      if (!p.error) { g.fileTotal += p.value; g.hasTotal = true; }
    }
  });

  // 중복 안내, 합계 열 검증 (R-10.5: 합계 열은 검증에만 쓴다)
  const rows = [];
  for (const g of groups.values()) {
    if (g.srcRows.length > 1 && dup === 'sum') push('info', `'${g.name}' ${g.srcRows.length}개 행을 같은 기관으로 합산했습니다 (D-12).`, { org: g.name });
    if (g.hasTotal) {
      const itemSum = itemCols.reduce((s, c) => s + g.counts[c.itemId], 0);
      if (itemSum !== g.fileTotal) push('warn', `'${g.name}': 파일 합계 ${g.fileTotal.toLocaleString('ko-KR')}건 ≠ 항목 합 ${itemSum.toLocaleString('ko-KR')}건`, { org: g.name });
    }
    // 기관 연결
    let status; let orgId = null;
    const linked = nameMap[g.name];
    const reg = registered.get(g.key);
    if (linked === '') status = 'excluded';
    else if (linked && orgs.some((o) => o.id === linked)) { status = 'linked'; orgId = linked; }
    else if (reg) { status = reg.active === false ? 'inactive' : 'ok'; orgId = reg.id; }
    else if (autoAddOrgs) status = 'new';
    else status = 'unlinked';
    if (status === 'new') push('info', `'${g.name}'은(는) 등록되지 않은 기관입니다. 적용할 때 새 참가기관으로 등록합니다 (R-10.7).`, { org: g.name });
    if (status === 'unlinked') push('warn', `등록되지 않은 기관 '${g.name}' — 기존 기관에 연결하거나 제외하세요. 연결하지 않으면 적용에서 빠집니다.`, { org: g.name });
    if (status === 'inactive') push('warn', `'${g.name}'은(는) 분담 대상에서 제외된 기관입니다. 실적은 저장되지만 회비 산출에는 쓰이지 않습니다.`, { org: g.name });
    const recognizedSum = recognized.reduce((s, id) => s + (g.counts[id] ?? 0), 0);
    rows.push({ key: g.key, name: g.name, status, orgId, counts: g.counts, recognizedSum, srcRows: g.srcRows, errors: g.errors, fileTotal: g.hasTotal ? g.fileTotal : null });
  }

  // 파일에 없는 분담 대상 기관 (D-11)
  const coveredIds = new Set(rows.filter((r) => r.orgId).map((r) => r.orgId));
  const missingOrgs = orgs.filter((o) => o.active !== false && !coveredIds.has(o.id));
  if (missingOrgs.length) {
    const list = missingOrgs.map((o) => o.name).join(', ');
    if (missing === 'error') push('error', `파일에 없는 분담 대상 기관 ${missingOrgs.length}곳: ${list} (D-11: 오류)`);
    else push('warn', `파일에 없는 분담 대상 기관 ${missingOrgs.length}곳: ${list} — 실적 0건으로 보고 균등회비만 부과합니다 (D-11).`);
  }
  if (carried) push('info', `기간 칸이 비어 있는 ${carried}개 행은 바로 위 행의 기간으로 보았습니다 (셀 병합).`);
  if (yearDefaulted) push('info', `기간 값에 연도가 없는 ${yearDefaulted}개 행은 업로드 정보의 산출 연도(${defaultYear}년)로 보았습니다.`);
  if (excludedByPeriod) push('info', `실적 기준기간(${period.start || '…'} ~ ${period.end || '…'}) 밖의 ${excludedByPeriod}개 행은 제외했습니다.`);
  if (periodCol !== undefined && !period.start && !period.end && minFrom) push('warn', `파일에 ${minFrom} ~ ${maxTo} 기간이 섞여 있습니다. 실적 시작일·종료일을 정하지 않으면 전체를 합산합니다.`);
  if (totalSkip) push('info', `합계 행 ${totalSkip}개는 건너뛰었습니다.`);

  const stats = {
    fileRows: totalRows,
    orgCount: rows.length,
    newOrgCount: rows.filter((r) => r.status === 'new').length,
    unlinkedCount: rows.filter((r) => r.status === 'unlinked').length,
    excludedCount: rows.filter((r) => r.status === 'excluded').length,
    activeOrgCount: orgs.filter((o) => o.active !== false).length,
    missingOrgCount: missingOrgs.length,
    recognizedTotal: rows.filter((r) => r.status !== 'excluded' && r.status !== 'unlinked').reduce((s, r) => s + r.recognizedSum, 0),
  };
  const canApply = !issues.some((i) => i.level === 'error') && rows.length > 0;
  return { rows, issues, stats, canApply, newColumns: newCols, itemCols };
}

// 적용 (R-10.1 마지막 단계): 실적 데이터와 새로 등록할 기관
export function applyPreview(preview, makeId = () => `org_${Math.random().toString(36).slice(2, 9)}`) {
  const perf = {};
  const newOrgs = [];
  for (const r of preview.rows) {
    if (r.status === 'excluded' || r.status === 'unlinked') continue;
    let id = r.orgId;
    if (r.status === 'new') {
      id = makeId();
      newOrgs.push({ id, name: r.name, active: true, postOffice: /우체국/.test(r.name.replace(/\s+/g, '')) });
    }
    perf[id] = { ...(perf[id] ?? {}) };
    for (const [itemId, n] of Object.entries(r.counts)) perf[id][itemId] = (perf[id][itemId] ?? 0) + n;
  }
  return { perf, newOrgs };
}

// 기관명만 뽑기 (참가기관 화면 "엑셀에서 기관명 불러오기"). 합계 행과 중복은 뺀다.
export function extractOrgNames(aoa, nameMode = 'ignoreSpaces') {
  const h = detectHeaderRow(aoa);
  const headers = aoa[h] ?? [];
  const hasHeader = headers.filter((v) => typeof v === 'string' && v.trim() !== '').length >= 2;
  let col = hasHeader ? headers.findIndex((v) => /기관|회사|은행|금융|참가|명칭|이름|name/.test(squash(v))) : -1;
  const bodyStart = col >= 0 ? h + 1 : 0;
  if (col < 0) col = 0;
  const seen = new Set();
  const names = [];
  for (const row of aoa.slice(bodyStart)) {
    const name = cell(row?.[col]);
    if (name === '' || TOTAL_ROW.test(name)) continue;
    const key = normalizeName(name, nameMode);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}
