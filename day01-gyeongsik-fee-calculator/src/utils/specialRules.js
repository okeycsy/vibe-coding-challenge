// 2단계 정산의 Step 2: skill.md "## 4. 최종 정산 특이사항"을 1차 계산 결과(수식 + 원 단위 배분)에 적용한다.
// 서버 SpecialRulePostProcessor 와 같은 규칙이다 (서버 연결 여부와 상관없이 같은 금액). 알아듣는 문장:
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
const LABEL = { 올림: '절상', 버림: '절사', 내림: '절사' };

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

function round(fee, unit, mode) {
  if (mode === '절상' || mode === '올림') return Math.floor((fee + unit - 1) / unit) * unit;
  if (mode === '반올림') return Math.floor((fee + Math.floor(unit / 2)) / unit) * unit;
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

const orAll = (idx, n) => (idx.length ? idx : Array.from({ length: n }, (_, i) => i));

// rows: [{ institutionId, code, name, aliases, finalCount, fee }] → [{ finalFee, adjustment, reason, applied }]
export function applySpecialRules(specialRules, rows) {
  const n = rows.length;
  const fee = rows.map((r) => r.fee);
  const reasons = rows.map(() => []);
  const rules = lines(specialRules);
  const shareBackRules = rules.filter(isShareBack);

  // 1) 최저·최고 회비
  rules.forEach((rule) => {
    for (const m of rule.matchAll(CLAMP)) {
      const limit = parseAmount(m[2]);
      const min = m[1] === '최저' || m[1] === '최소';
      orAll(named(rule, rows), n).forEach((i) => {
        const next = min ? Math.max(fee[i], limit) : Math.min(fee[i], limit);
        if (next !== fee[i]) {
          reasons[i].push(`${m[1]} 회비 ${won(limit)} 적용 (${signed(next - fee[i])})`);
          fee[i] = next;
        }
      });
    }
  });

  // 2) 원 단위 절상(+ 차이분 실적순 1원 절삭)·절사·반올림
  rules.forEach((rule) => {
    const m = rule.match(ROUNDING);
    if (!m) return;
    const unit = Number(m[1].replace(/,/g, ''));
    if (unit <= 1) return;
    const label = LABEL[m[2]] ?? m[2];
    const raise = label !== '절사' && label !== '절삭';
    const shareBack = raise && shareBackRules.length > 0 && n > 0;
    const hit = named(rule, rows);
    const targets = hit.length ? hit : shareBack ? [0] : orAll(hit, n);
    let diff = 0;
    targets.forEach((i) => {
      const next = round(fee[i], unit, m[2]);
      if (next !== fee[i]) {
        reasons[i].push(`${unit.toLocaleString('ko-KR')}원 단위 ${label} (${signed(next - fee[i])})`);
        diff += next - fee[i];
        fee[i] = next;
      }
    });
    if (!shareBack || diff === 0) return;
    const asc = shareBackRules.some((r) => ASC.test(r));
    const order = rows
      .map((_, i) => i)
      .filter((i) => !targets.includes(i))
      .sort(
        (a, b) =>
          (asc ? rows[a].finalCount - rows[b].finalCount : rows[b].finalCount - rows[a].finalCount) ||
          compareCode(rows[a].code, rows[b].code) ||
          a - b,
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

// 서버 String.compareTo 와 같은 순서 (기관코드는 영문·숫자라 UTF-16 비교와 같다)
const compareCode = (a = '', b = '') => (a < b ? -1 : a > b ? 1 : 0);
