// 2단계 정산의 Step 2: skill.md "## 4. 최종 정산 특이사항"을 1차 계산 결과(수식 + 원 단위 배분)에 적용한다.
// 해석(문장 → 보정 동작)과 실행(동작대로 금액 계산)으로 나뉜다. 서버는 AI 가 해석하고(키가 없거나 실패하면 규칙 기반),
// 서버 미연결(Mock) 모드는 브라우저에 AI 키를 둘 수 없어 늘 아래 규칙 기반 해석기를 쓴다. 실행은 서버
// SpecialRulePostProcessor.execute 와 같다. 보정 동작: { type: MIN_FEE|MAX_FEE|ROUND, amount, unit, rounding: UP|DOWN|HALF_UP,
// target: ALL|FIRST|NAMED, institutions, redistribute: NONE|PERF_DESC|PERF_ASC, rule }
// 규칙 기반 해석기가 알아듣는 문장:
// 1) "최저/최소/최고/최대 (회비|금액|한도) N원": 상하한. 문장에 기관 이름·별칭이 있으면 그 기관만, 없으면 전체
// 2) "N원 단위로 절상(올림·반올림)" + 섹션 안에 "차이분(차액·초과액)은 … 실적 … 1원씩 절삭(차감)" 문장이 있으면:
//    절상 대상(문장에 기관이 있으면 그 기관, 없으면 첫 번째 기관)을 N원 단위로 올리고, 늘어난 금액만큼 나머지 기관을
//    최종 인정 실적이 큰 순서(동률이면 기관코드 순)대로 1원씩 깎아 합계를 유지한다. "작은 순"이면 실적이 작은 순서
// 3) "N원 미만 절사(절삭·버림·내림)": 대상(없으면 전체)을 N원 단위로 버린다. 합계는 줄어든다.
//    차이분 문장이 없는 절상·반올림도 대상(없으면 전체)만 바꾼다
import { lines } from './skill';

export const PREFIX = '특이사항 반영: ';

const AMOUNT = String.raw`\d[\d,]*(?:\.\d+)?\s*(?:억|만|천)?(?:\s*\d[\d,]*\s*(?:만|천))?\s*원`;
const UNITS = { 억: 100_000_000, 만: 10_000, 천: 1_000 };
const ROUNDING = /(\d[\d,]*)\s*원\s*(?:단위|미만)\s*(?:로|으로|에서)?\s*(반올림|절상|올림|절사|절삭|버림|내림)/;
const CLAMP = new RegExp(String.raw`(최저|최소|최고|최대)\s*(?:회비|금액|한도)?\s*(?:는|은)?\s*(${AMOUNT})`, 'g');
const DIFF = /차이|차액|초과/;
const CUT = /절삭|차감|1원씩/;
const ASC = /(작은|적은)\s*(순|기관)/;

// "50만원", "1억 2,000만원", "900,000원" → 원
export function parseAmount(text) {
  let total = 0;
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(억|만|천)?/g)) {
    total += Number(m[1].replace(/,/g, '')) * (m[2] ? UNITS[m[2]] : 1);
  }
  return Math.round(total);
}

const won = (n) => `${Math.abs(n).toLocaleString('ko-KR')}원`;
export const signed = (d) => `${d > 0 ? '+' : '-'}${won(d)}`;

// "차이분 … 실적 … 1원씩 절삭" 처럼 절상 차이분을 다른 기관에서 되돌리는 문장인지
export const isShareBack = (rule) => DIFF.test(rule) && rule.includes('실적') && CUT.test(rule);

function round(fee, unit, rounding) {
  if (rounding === 'UP') return Math.floor((fee + unit - 1) / unit) * unit;
  if (rounding === 'HALF_UP') return Math.floor((fee + Math.floor(unit / 2)) / unit) * unit;
  return Math.floor(fee / unit) * unit;
}

// 문장에 이름·별칭이 나온 기관 (더 긴 이름 안에 든 별칭은 뺀다: '하나온은행' 안의 '하나')
export function named(rule, rows) {
  const found = [];
  rows.forEach((r, idx) => {
    const hit = rule.includes(r.name)
      ? r.name
      : (r.aliases ?? []).filter((a) => rule.includes(a)).sort((a, b) => b.length - a.length)[0];
    if (hit) found.push({ idx, hit });
  });
  return found
    .filter((f) => !found.some((g) => g !== f && g.hit.length > f.hit.length && g.hit.includes(f.hit)))
    .map((f) => f.idx);
}

const MAX_UNIT = 100_000_000;
const ROUNDING_OF = { 절상: 'UP', 올림: 'UP', 반올림: 'HALF_UP' };
const ROUNDING_LABEL = { UP: '절상', DOWN: '절사', HALF_UP: '반올림' };

// 규칙 기반 해석기: 문장 → { actions, unsupported } (서버 SpecialRulePostProcessor.interpret 과 같음)
export function interpretSpecialRules(specialRules, rows) {
  const n = rows.length;
  const rules = lines(specialRules);
  const shareBackRules = rules.filter(isShareBack);
  const asc = shareBackRules.some((r) => ASC.test(r));
  const used = rules.map(() => false);
  const names = (rule) => named(rule, rows).map((i) => rows[i].name);
  const actions = [];

  rules.forEach((rule, k) => {
    for (const m of rule.matchAll(CLAMP)) {
      const hit = names(rule);
      actions.push({
        type: m[1] === '최저' || m[1] === '최소' ? 'MIN_FEE' : 'MAX_FEE',
        amount: parseAmount(m[2]),
        unit: null,
        rounding: null,
        target: hit.length ? 'NAMED' : 'ALL',
        institutions: hit,
        redistribute: 'NONE',
        rule,
      });
      used[k] = true;
    }
  });

  let sharedBack = false;
  rules.forEach((rule, k) => {
    const m = rule.match(ROUNDING);
    if (!m) return;
    const unit = Number(m[1].replace(/,/g, ''));
    if (unit <= 1 || unit > MAX_UNIT) return;
    const rounding = ROUNDING_OF[m[2]] ?? 'DOWN';
    const shareBack = rounding !== 'DOWN' && shareBackRules.length > 0 && n > 0;
    const hit = names(rule);
    actions.push({
      type: 'ROUND',
      amount: null,
      unit,
      rounding,
      target: hit.length ? 'NAMED' : shareBack ? 'FIRST' : 'ALL',
      institutions: hit,
      redistribute: !shareBack ? 'NONE' : asc ? 'PERF_ASC' : 'PERF_DESC',
      rule,
    });
    used[k] = true;
    sharedBack ||= shareBack;
  });

  return { actions, unsupported: rules.filter((r, k) => !used[k] && !(sharedBack && isShareBack(r))) };
}

// 화면용 한 줄 설명 (서버 SpecialAction.describe 와 같음)
export function describeAction(a) {
  const who = a.target === 'ALL' ? '전체 기관' : a.target === 'FIRST' ? '첫 번째 기관' : a.institutions.join('·');
  if (a.type !== 'ROUND') return `${who} ${a.type === 'MIN_FEE' ? '최저' : '최고'} 회비 ${won(a.amount)}`;
  const text = `${who} ${won(a.unit)} 단위 ${ROUNDING_LABEL[a.rounding]}`;
  if (a.redistribute === 'PERF_DESC') return `${text} → 차이분은 나머지 기관에 실적 큰 순 1원씩 되돌림`;
  if (a.redistribute === 'PERF_ASC') return `${text} → 차이분은 나머지 기관에 실적 작은 순 1원씩 되돌림`;
  return text;
}

// 기관명·기관 ID·기관코드가 같거나 별칭에 든 행 (없으면 -1)
function indexOf(name, rows) {
  const i = rows.findIndex((r) => name === r.name || name === r.institutionId || name === r.code);
  return i >= 0 ? i : rows.findIndex((r) => (r.aliases ?? []).includes(name));
}

function targetsOf(a, rows) {
  if (a.target === 'FIRST') return rows.length ? [0] : [];
  if (a.target === 'NAMED') {
    const idx = [];
    a.institutions.forEach((name) => {
      const i = indexOf(name, rows);
      if (i >= 0 && !idx.includes(i)) idx.push(i);
    });
    return idx;
  }
  return rows.map((_, i) => i);
}

// 보정 동작 실행 (결정적). rows: [{ institutionId, code, name, aliases, finalCount, fee }] → [{ finalFee, adjustment, reason, applied }]
export function executeSpecialActions(actions, rows) {
  const fee = rows.map((r) => r.fee);
  const reasons = rows.map(() => []);

  actions.forEach((a) => {
    const targets = targetsOf(a, rows);
    if (a.type !== 'ROUND') {
      const min = a.type === 'MIN_FEE';
      targets.forEach((i) => {
        const next = min ? Math.max(fee[i], a.amount) : Math.min(fee[i], a.amount);
        if (next !== fee[i]) {
          reasons[i].push(`${min ? '최저' : '최고'} 회비 ${won(a.amount)} 적용 (${signed(next - fee[i])})`);
          fee[i] = next;
        }
      });
      return;
    }
    const label = ROUNDING_LABEL[a.rounding];
    let diff = 0;
    targets.forEach((i) => {
      const next = round(fee[i], a.unit, a.rounding);
      if (next !== fee[i]) {
        reasons[i].push(`${a.unit.toLocaleString('ko-KR')}원 단위 ${label} (${signed(next - fee[i])})`);
        diff += next - fee[i];
        fee[i] = next;
      }
    });
    if (a.redistribute === 'NONE' || diff === 0) return;
    const asc = a.redistribute === 'PERF_ASC';
    const order = rows
      .map((_, i) => i)
      .filter((i) => !targets.includes(i))
      .sort(
        (x, y) =>
          (asc ? rows[x].finalCount - rows[y].finalCount : rows[y].finalCount - rows[x].finalCount) ||
          compareCode(rows[x].code, rows[y].code) ||
          x - y,
      );
    const delta = rows.map(() => 0);
    const step = diff > 0 ? -1 : 1;
    let left = Math.abs(diff);
    while (left > 0) {
      let moved = false;
      for (const i of order) {
        if (left === 0) break;
        if (step < 0 && fee[i] <= 0) continue;
        fee[i] += step;
        delta[i] += step;
        left--;
        moved = true;
      }
      if (!moved) break;
    }
    order.forEach((i) => {
      if (delta[i]) reasons[i].push(`${label} 차이분 실적순 ${step < 0 ? '절삭' : '가산'} (${signed(delta[i])})`);
    });
  });

  return rows.map((r, i) => ({
    finalFee: fee[i],
    adjustment: fee[i] - r.fee,
    reason: reasons[i].length ? PREFIX + reasons[i].join(', ') : null,
    applied: reasons[i].length > 0,
  }));
}

// 규칙 기반 해석 + 실행 (서버 미연결 모드)
export function applySpecialRules(specialRules, rows) {
  return executeSpecialActions(interpretSpecialRules(specialRules, rows).actions, rows);
}

// 서버 String.compareTo 와 같은 순서 (기관코드는 영문·숫자라 UTF-16 비교와 같다)
const compareCode = (a = '', b = '') => (a < b ? -1 : a > b ? 1 : 0);
