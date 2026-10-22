// 엑셀 실적 데이터 → 열 매핑 → 검증 → 미리보기 → 적용 (요구사항 10장)
// 엑셀 파일 자체는 excel.js가 2차원 배열로 읽어 넘긴다. 여기서는 배열만 다룬다.
import { toDateRange, within } from './period.js';

const norm = (v) => String(v ?? '').replace(/\s+/g, '').toLowerCase();
const ORG_WORDS = ['기관명', '기관', '참가기관', '회원사', '은행명', '금융기관'];
const TOTAL_WORDS = ['합계', '총계', '총건수', '계'];
const PERIOD_WORDS = ['기준년월', '년월', '연월', '기준일', '일자', '날짜', '기간', '기준월', '분기', 'date', 'month', 'period'];
const TOTAL_ROW = /^(합계|총계|계|소계|total)$/i;

export const ROLE_LABELS = {
  ignore: '사용 안 함',
  org: '기관명',
  total: '합계 (검증용)',
  period: '기간',
};

// 머리글 행: 칸 값이 '기관명' 류와 같은 첫 행 → 그런 낱말을 포함한 첫 행 → 글자 칸이 2개 이상인 첫 행
// ('참가기관 명단' 같은 제목 행보다 실제 머리글을 먼저 찾기 위해 같은 값을 먼저 본다)
export function detectHeaderRow(aoa) {
  const exact = aoa.findIndex((row) => row.some((c) => ORG_WORDS.includes(norm(c))));
  if (exact !== -1) return exact;
  const byOrg = aoa.findIndex((row) => row.some((c) => ORG_WORDS.some((w) => norm(c).includes(w))));
  if (byOrg !== -1) return byOrg;
  return aoa.findIndex((row) => row.filter((c) => typeof c === 'string' && c.trim()).length >= 2);
}

// 열마다 역할을 추측한다. 저장된 매핑(머리글 이름 → 역할)이 있으면 먼저 쓴다.
// 역할: 'ignore' | 'org' | 'total' | 'period' | 'item:<항목 id>' | 'new'(새 실적 항목으로 추가)
export function guessMapping(headers, items, saved = {}) {
  const mapping = {};
  const used = new Set();
  headers.forEach((h, i) => {
    const key = String(h ?? '').trim();
    if (!key) return void (mapping[i] = 'ignore');
    const s = saved[key];
    if (s && (s === 'ignore' || s === 'org' || s === 'total' || s === 'period' || items.some((it) => `item:${it.id}` === s))) {
      mapping[i] = s;
      used.add(s);
    }
  });
  headers.forEach((h, i) => {
    if (mapping[i]) return;
    const n = norm(h);
    const take = (role) => {
      if (used.has(role) && role !== 'ignore') return false;
      mapping[i] = role;
      used.add(role);
      return true;
    };
    // 실적 항목: 항목 이름과 머리글이 서로 포함되면 같은 항목 ("압류" ↔ "압류건수")
    const item = items.find((it) => {
      const a = norm(it.name).replace(/건수$/, '');
      const b = n.replace(/건수$/, '');
      return a && b && (a === b || b.includes(a) || a.includes(b));
    });
    if (item && take(`item:${item.id}`)) return;
    if (ORG_WORDS.some((w) => n.includes(w)) && take('org')) return;
    if (PERIOD_WORDS.some((w) => n.includes(w)) && take('period')) return;
    if (TOTAL_WORDS.some((w) => n === w || n.startsWith(w)) && take('total')) return;
    mapping[i] = 'new';
  });
  return mapping;
}

function toCount(v) {
  if (v === null || v === undefined || v === '') return { value: 0 };
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) return { error: `정수가 아닌 값 ${v}` };
    return v < 0 ? { error: `음수 ${v}` } : { value: v };
  }
  const s = String(v).replace(/[,\s]/g, '').replace(/건$/, '');
  if (!/^\d+$/.test(s)) return { error: `숫자가 아닌 값 '${v}'` };
  return { value: Number(s) };
}

const showValue = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

// 미리보기와 검증
// orgs: 등록된 전체 기관 [{id, name, active}], items: [{id, name}], recognizedItemIds: 인정 항목
// nameMap: { 엑셀 기관명: 등록 기관 id } (담당자가 고친 기관명 매핑, ''이면 연결 안 함), edits: { 엑셀 기관명: { 항목 id: 값 } }
// autoAddOrgs: 등록되지 않은 기관명을 적용할 때 새 참가기관으로 등록 (entry.willAdd)
export function buildPreview({ aoa, headerIdx, mapping, items, recognizedItemIds, orgs, period = {}, duplicatePolicy = 'sum', nameMap = {}, edits = {}, autoAddOrgs = false }) {
  const issues = [];
  const add = (level, message, extra = {}) => issues.push({ level, message, ...extra });
  const header = aoa[headerIdx] ?? [];
  const cols = Object.entries(mapping).map(([i, role]) => ({ i: Number(i), role, header: String(header[i] ?? '') }));
  const orgCol = cols.find((c) => c.role === 'org');
  const totalCol = cols.find((c) => c.role === 'total');
  const periodCol = cols.find((c) => c.role === 'period');
  const itemCols = cols.filter((c) => c.role.startsWith('item:')).map((c) => ({ ...c, itemId: c.role.slice(5) }));
  const itemName = Object.fromEntries(items.map((it) => [it.id, it.name]));

  if (!orgCol) add('error', '기관명 열을 지정해 주세요.');
  if (itemCols.length === 0) add('error', '실적 항목으로 쓸 열을 하나 이상 지정해 주세요.');
  for (const id of recognizedItemIds) {
    if (!itemCols.some((c) => c.itemId === id)) add('error', `필수 실적 항목 '${itemName[id]}'에 해당하는 열이 없습니다. 열 매핑에서 지정해 주세요.`, { column: itemName[id] });
  }
  const dupItems = itemCols.filter((c, k) => itemCols.findIndex((x) => x.itemId === c.itemId) !== k);
  for (const c of dupItems) add('error', `'${itemName[c.itemId]}' 항목에 열이 두 개 이상 지정되었습니다.`, { column: c.header });

  const byName = new Map(orgs.map((o) => [norm(o.name), o]));
  const orgById = Object.fromEntries(orgs.map((o) => [o.id, o]));
  const entries = new Map();
  let rowsRead = 0;
  let rowsOutside = 0;
  let minFrom = null;
  let maxTo = null;

  if (orgCol) {
    for (let r = headerIdx + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const line = r + 1;
      const rawName = String(row[orgCol.i] ?? '').trim();
      const hasNumbers = itemCols.some((c) => row[c.i] !== '' && row[c.i] !== undefined && row[c.i] !== null);
      if (!rawName && !hasNumbers) continue;
      if (TOTAL_ROW.test(norm(rawName))) continue;
      if (!rawName) {
        add('error', `${line}행: 기관명이 비어 있습니다.`, { row: line });
        continue;
      }
      if (periodCol) {
        const range = toDateRange(row[periodCol.i]);
        if (!range) {
          add('error', `${line}행(${rawName}): 기간 '${showValue(row[periodCol.i])}'을(를) 날짜로 읽지 못했습니다.`, { row: line, org: rawName, column: periodCol.header });
          continue;
        }
        if (!minFrom || range.from < minFrom) minFrom = range.from;
        if (!maxTo || range.to > maxTo) maxTo = range.to;
        if (!within(range, period.start, period.end)) {
          rowsOutside += 1;
          continue;
        }
      }
      rowsRead += 1;
      const e = entries.get(rawName) ?? { rawName, rows: [], counts: {}, cellErrors: {}, totalGiven: null, totalCalc: 0 };
      e.rows.push(line);
      let rowSum = 0;
      let rowError = false;
      for (const c of itemCols) {
        const parsed = toCount(row[c.i]);
        if (parsed.error) {
          rowError = true;
          e.cellErrors[c.itemId] = `${line}행(${rawName}) ${c.header}: ${parsed.error}`;
        } else {
          e.counts[c.itemId] = (e.counts[c.itemId] ?? 0) + parsed.value;
          rowSum += parsed.value;
        }
      }
      // 항목 칸에 오류가 있는 행은 그 오류를 먼저 고치게 하고 합계 비교는 하지 않는다
      if (totalCol && !rowError && row[totalCol.i] !== '' && row[totalCol.i] !== undefined) {
        const t = toCount(row[totalCol.i]);
        if (t.error) add('warn', `${line}행(${rawName}) 합계 열: ${t.error}`, { row: line, org: rawName, column: totalCol.header });
        else if (t.value !== rowSum) {
          add('warn', `${line}행(${rawName}): 합계 열 ${t.value.toLocaleString('ko-KR')}건 ≠ 항목 합 ${rowSum.toLocaleString('ko-KR')}건. 합계 열은 검증에만 쓰고 계산에는 넣지 않습니다.`, { row: line, org: rawName, column: totalCol.header });
        }
      }
      entries.set(rawName, e);
    }
  }

  // 담당자 수정값 반영, 기관 매핑, 중복 확인
  const list = [...entries.values()].map((e) => {
    for (const [itemId, v] of Object.entries(edits[e.rawName] ?? {})) {
      const parsed = toCount(v);
      if (parsed.error) e.cellErrors[itemId] = `${e.rawName} ${itemName[itemId]} 수정값: ${parsed.error}`;
      else {
        e.counts[itemId] = parsed.value;
        delete e.cellErrors[itemId];
      }
      e.edited = true;
    }
    for (const msg of Object.values(e.cellErrors)) add('error', msg, { org: e.rawName });
    const mapped = nameMap[e.rawName];
    const org = mapped !== undefined ? orgById[mapped] : byName.get(norm(e.rawName));
    e.orgId = org?.id ?? null;
    e.orgName = org?.name ?? null;
    e.recognized = recognizedItemIds.reduce((a, id) => a + (e.counts[id] ?? 0), 0);
    e.willAdd = !org && autoAddOrgs && mapped === undefined;
    if (e.willAdd) add('info', `'${e.rawName}'은(는) 등록되지 않은 기관이라 적용할 때 새 참가기관으로 등록합니다.`, { org: e.rawName });
    else if (!org && mapped === '') add('warn', `'${e.rawName}'은(는) 연결 안 함으로 정해 산출에서 뺍니다.`, { org: e.rawName });
    else if (!org) add('warn', `등록되지 않은 기관 '${e.rawName}': 등록 기관에 연결하거나 새 기관으로 등록해야 산출에 들어갑니다.`, { org: e.rawName });
    else if (!org.active) add('warn', `'${e.rawName}'은(는) 분담 대상에서 제외된 기관이라 산출에 넣지 않습니다.`, { org: e.rawName });
    if (e.rows.length > 1) {
      if (duplicatePolicy === 'error') add('error', `'${e.rawName}'이(가) ${e.rows.length}개 행(${e.rows.join(', ')}행)에 중복 입력되었습니다.`, { org: e.rawName });
      else add('info', `'${e.rawName}' ${e.rows.length}개 행(${e.rows.join(', ')}행)을 같은 기관으로 보고 합산했습니다.`, { org: e.rawName });
    }
    return e;
  });
  const byOrg = {};
  for (const e of list) if (e.orgId) (byOrg[e.orgId] ??= []).push(e.rawName);
  for (const [orgId, names] of Object.entries(byOrg)) {
    if (names.length > 1) add('warn', `엑셀 기관명 ${names.map((x) => `'${x}'`).join(', ')}이(가) 모두 '${orgById[orgId].name}'에 연결되어 합산됩니다.`, { org: orgById[orgId].name });
  }
  const active = orgs.filter((o) => o.active);
  const missing = active.filter((o) => !byOrg[o.id]);
  const matchedActive = active.length - missing.length;
  if (missing.length) {
    add('warn', `파일에 없는 분담 대상 기관 ${missing.length}곳: ${missing.map((o) => o.name).join(', ')} (실적 0건으로 계산)`);
  }
  if (periodCol && rowsOutside) add('info', `실적 적용 기간(${period.start || '처음'} ~ ${period.end || '끝'}) 밖의 ${rowsOutside}개 행은 제외했습니다.`);
  if (periodCol && !period.start && !period.end && minFrom) add('warn', `파일에 ${minFrom} ~ ${maxTo} 기간이 섞여 있습니다. 실적 적용 기간을 정하지 않으면 전체를 합산합니다.`);
  if (orgCol && list.length === 0) add('error', '실적 데이터 행이 없습니다.');

  const errors = issues.filter((i) => i.level === 'error').length;
  return {
    entries: list,
    issues,
    stats: {
      rowsRead,
      rowsOutside,
      fileOrgCount: list.length,
      activeOrgCount: active.length,
      matchedActive,
      newOrgCount: new Set(list.filter((e) => e.willAdd).map((e) => norm(e.rawName))).size,
      periodRange: minFrom ? { from: minFrom, to: maxTo } : null,
      itemIds: itemCols.map((c) => c.itemId),
    },
    canApply: errors === 0,
  };
}

// 미리보기 → 산출에 쓰는 실적 { 기관 id: { 항목 id: 건수 } }. 같은 기관에 연결된 행은 합산
export function previewToPerf(preview) {
  const perf = {};
  for (const e of preview.entries) {
    if (!e.orgId) continue;
    const t = (perf[e.orgId] ??= {});
    for (const [itemId, v] of Object.entries(e.counts)) t[itemId] = (t[itemId] ?? 0) + v;
  }
  return perf;
}

// 미리보기 적용: 새로 등록할 기관(willAdd)을 만들고 실적을 기관 id로 묶는다.
// 띄어쓰기만 다른 기관명은 한 기관으로 등록한다. makeId: () => 새 기관 id
export function applyPreview(preview, makeId) {
  const newOrgs = [];
  const idByName = new Map();
  const entries = preview.entries.map((e) => {
    if (!e.willAdd) return e;
    const key = norm(e.rawName);
    if (!idByName.has(key)) {
      const id = makeId();
      idByName.set(key, id);
      newOrgs.push({ id, name: e.rawName, active: true });
    }
    return { ...e, orgId: idByName.get(key) };
  });
  return { newOrgs, perf: previewToPerf({ entries }) };
}

// 엑셀에서 기관명만 뽑기 (참가기관 일괄 등록용). 기관명 열을 못 찾으면 첫 열을 쓴다.
export function extractOrgNames(aoa) {
  const h = detectHeaderRow(aoa);
  const header = aoa[h] ?? [];
  let col = header.findIndex((c) => ORG_WORDS.includes(norm(c)));
  if (col === -1) col = header.findIndex((c) => ORG_WORDS.some((w) => norm(c).includes(w)));
  if (col === -1) col = 0;
  const seen = new Set();
  const names = [];
  for (let r = Math.max(h, -1) + 1; r < aoa.length; r++) {
    const name = String(aoa[r]?.[col] ?? '').trim();
    if (!name || TOTAL_ROW.test(norm(name)) || typeof aoa[r][col] === 'number' || seen.has(norm(name))) continue;
    seen.add(norm(name));
    names.push(name);
  }
  return names;
}
