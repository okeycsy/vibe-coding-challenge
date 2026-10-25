// "## 1. 비즈니스 규칙 요약"의 한글 문장에서 산정 패턴을 찾아 "## 3. 정산 수식"(SpEL)을 만드는 내장 변환기.
// 서버 RuleBasedFormulaGenerator 와 같은 규칙이다 (같은 문장이면 같은 수식·설명). 서버 미연결(Mock) 모드는
// 브라우저에 AI 키를 둘 수 없어 늘 이 변환기로, 서버 연결 시에는 서버가 AI(키가 없으면 같은 변환기)로 만든다.
// 찾는 순서: 구간별 차등 단가 → 기본료 + 건당 단가 → 균등 + 실적비례 혼합 → 건당 단가 + 최저·최고 한도 → 총액 대비 단순 실적 비율
import { FORMULA_SAMPLES, evaluateFormula, lines } from './skill';
import { parseAmount } from './postprocess';

const AMOUNT = String.raw`\d[\d,]*(?:\.\d+)?\s*(?:억|만|천)?(?:\s*\d[\d,]*\s*(?:만|천))?\s*원`;
const TOTAL = new RegExp(String.raw`총액\s*(${AMOUNT})`);
const EQUAL_SHARE = /(\d+(?:\.\d+)?)\s*%[^\n%]*균등/;
const PERF_SHARE = /(\d+(?:\.\d+)?)\s*%[^\n%]*(?:실적|건수)/g;
const BASE_FEE = new RegExp(String.raw`기본료[^\d\n]*(${AMOUNT})`);
const UNIT = /건당\s*(?:단가\s*)?(\d[\d,]*)\s*원/;
const MIN = new RegExp(String.raw`(?:최저|최소)\s*(?:회비|금액|한도)?\s*(?:는|은)?\s*(${AMOUNT})`);
const MAX = new RegExp(String.raw`(?:최고|최대)\s*(?:회비|금액|한도)?\s*(?:는|은)?\s*(${AMOUNT})`);
const TIER_UPPER = /(?:(\d[\d,]*)\s*(만|억)?\s*건\s*까지|~\s*(\d[\d,]*)\s*(만|억)?\s*건)/;
const num = (s) => Number(s.replace(/,/g, ''));
const n0 = (v) => v.toLocaleString('ko-KR');
// 30 → "0.3", 30.0 → "30" (소수 오차 없이, 서버 BigDecimal 과 같은 표기)
const ratio = (pct) => String(Number((pct / 100).toFixed(10)));
const pct = (v) => String(Number(v.toFixed(10)));

function tiered(rules) {
  for (const line of lines(rules)) {
    if (!/건\s?까지/.test(line)) continue;
    const tiers = [];
    line
      .slice(line.indexOf(':') + 1)
      .split(/[,，]/)
      .forEach((seg) => {
        const prices = [...seg.matchAll(/(\d[\d,]*)\s*원/g)];
        if (!prices.length) return;
        const u = seg.match(TIER_UPPER);
        const upper = u ? parseAmount((u[1] ?? u[3]) + ((u[1] ? u[2] : u[4]) ?? '')) : -1;
        tiers.push([upper, num(prices[prices.length - 1][1])]);
      });
    if (tiers.length < 2 || tiers[0][0] <= 0) continue;
    const parts = [];
    const steps = [`'${line}' → 최종 인정 건수(#finalCount)를 구간으로 나눠 구간마다 (구간에 든 건수 × 단가)를 더함`];
    let lower = 0;
    for (let i = 0; i < tiers.length; i++) {
      const [upper, price] = tiers[i];
      const last = i === tiers.length - 1;
      if (!last && upper <= lower) return null;
      if (i === 0) {
        parts.push(`(#finalCount < ${upper} ? #finalCount : ${upper}) * ${price}`);
        steps.push(`${i + 1}구간: ${n0(upper)}건까지 건당 ${n0(price)}원`);
      } else if (last && upper <= lower) {
        parts.push(`(#finalCount > ${lower} ? #finalCount - ${lower} : 0) * ${price}`);
        steps.push(`${i + 1}구간: ${n0(lower)}건 초과분 건당 ${n0(price)}원`);
      } else {
        parts.push(`(#finalCount > ${lower} ? (#finalCount < ${upper} ? #finalCount : ${upper}) - ${lower} : 0) * ${price}`);
        steps.push(`${i + 1}구간: ${n0(lower)}건 초과 ~ ${n0(upper)}건 건당 ${n0(price)}원`);
      }
      lower = Math.max(lower, upper);
    }
    return { formula: parts.join('\n  + '), pattern: `구간별 차등 단가 (${tiers.length}구간 누진)`, steps };
  }
  return null;
}

function baseFee(rules) {
  const b = rules.match(BASE_FEE);
  const u = rules.match(UNIT);
  if (!b || !u) return null;
  const base = parseAmount(b[1]);
  const unit = num(u[1]);
  return {
    formula: `(#finalCount > 0 ? ${base} * #periodScale : 0) + #finalCount * ${unit}`,
    pattern: '기본료 + 건당 단가',
    steps: [
      `기본료 '${b[1].trim()}' → ${base} * #periodScale (분기 = 1, 분기가 아니면 일수 비례)`,
      '실적이 있는 기관만 기본료 부과 → (#finalCount > 0 ? 기본료 : 0)',
      `건당 단가 ${n0(unit)}원 → #finalCount * ${unit}`,
    ],
  };
}

function mixed(rules) {
  const t = rules.match(TOTAL);
  const e = rules.match(EQUAL_SHARE);
  if (!t || !e) return null;
  const equalPct = Number(e[1]);
  if (!(equalPct > 0 && equalPct < 100)) return null;
  // 균등 비율 문장이 아닌 첫 "N% … 실적/건수" 문장 (없으면 나머지 = 100 - 균등)
  const p = [...rules.matchAll(PERF_SHARE)].find((m) => m.index !== e.index);
  const perfPct = p ? Number(p[1]) : Number((100 - equalPct).toFixed(10));
  const total = parseAmount(t[1]);
  const eq = ratio(equalPct);
  const perf = ratio(perfPct);
  const steps = [
    `총액 '${t[1].trim()}' → ${total}.0 (원, 소수점을 붙여 정수 나눗셈 버림 방지)`,
    '기간 환산 → * #periodScale (분기 = 1, 분기가 아니면 일수 ÷ 91)',
    `균등 ${pct(equalPct)}% → ${eq} / #institutionCount (참가기관 수가 0이면 0)`,
    `실적 ${pct(perfPct)}%${p ? '' : '(나머지)'} → ${perf} * #finalCount / #totalCount (전체 인정 건수가 0이면 0)`,
  ];
  if (Number((equalPct + perfPct).toFixed(10)) !== 100) steps.push('주의: 균등·실적 비율의 합이 100%가 아니어서 회비 합계가 총액과 달라집니다.');
  steps.push('분리 수식: 균등분담분(formula:equal)과 실적분담분(formula:perf)을 따로 두면 4번 후처리에서 각 합계를 따로 맞출 수 있습니다.');
  return {
    equalFormula: `#institutionCount == 0 ? 0 : ${total}.0 * #periodScale * ${eq} / #institutionCount`,
    perfFormula: `#totalCount == 0 ? 0 : ${total}.0 * #periodScale * ${perf} * #finalCount / #totalCount`,
    formula: `${total}.0 * #periodScale * ((#institutionCount == 0 ? 0 : ${eq} / #institutionCount) + (#totalCount == 0 ? 0 : ${perf} * #finalCount / #totalCount))`,
    pattern: `균등 ${pct(equalPct)}% + 실적비례 ${pct(perfPct)}% 혼합분담`,
    steps,
  };
}

function unitPrice(rules) {
  const u = rules.match(UNIT);
  if (!u) return null;
  const unit = num(u[1]);
  const fee = `#finalCount * ${unit}`;
  const mn = rules.match(MIN);
  const mx = rules.match(MAX);
  const min = mn ? parseAmount(mn[1]) : null;
  const max = mx ? parseAmount(mx[1]) : null;
  const capped = max == null ? fee : `(${fee} > ${max} ? ${max} : ${fee})`;
  const steps = [`건당 단가 ${n0(unit)}원 → #finalCount * ${unit}`];
  if (min != null) steps.push(`최저 회비 ${n0(min)}원 → 단가 계산액이 ${min} 미만이면 ${min}`);
  if (max != null) steps.push(`최고 회비 ${n0(max)}원 → 단가 계산액이 ${max} 초과면 ${max}`);
  return {
    formula: min == null ? capped : `${fee} < ${min}\n  ? ${min}\n  : ${capped}`,
    pattern:
      min != null && max != null ? '건당 단가 + 최저·최고 한도' : min != null ? '건당 단가 + 최저 한도' : max != null ? '건당 단가 + 최고 한도' : '건당 단가',
    steps,
  };
}

function ratioShare(rules) {
  const t = rules.match(TOTAL);
  if (!t) return null;
  const total = parseAmount(t[1]);
  return {
    formula: `#totalCount == 0 ? 0 : ${total}.0 * #periodScale * #finalCount / #totalCount`,
    pattern: '총액 대비 단순 실적 비율',
    steps: [
      `총액 '${t[1].trim()}' → ${total}.0 (원, 소수점을 붙여 정수 나눗셈 버림 방지)`,
      '기간 환산 → * #periodScale (분기 = 1, 분기가 아니면 일수 ÷ 91)',
      '분담률 = #finalCount / #totalCount (전체 인정 건수가 0이면 0)',
    ],
  };
}

export function generateFormula(rules) {
  if (!rules?.trim()) return null;
  return tiered(rules) ?? baseFee(rules) ?? mixed(rules) ?? unitPrice(rules) ?? ratioShare(rules);
}

// 서버 POST /api/v1/skills/{taskCode}/generate-formula 와 같은 모양의 응답 (Mock 모드용). 알아듣지 못하면 Error
export function generateFormulaLocally(taskCode, businessRulesText) {
  const rules = (businessRulesText ?? '').replace(/\r\n/g, '\n').trim();
  if (!rules) throw new Error("'## 1. 비즈니스 규칙 요약'에 규칙을 먼저 적어 주세요.");
  const g = generateFormula(rules);
  if (!g) {
    throw new Error(
      '서버 미연결 모드라 내장 변환기로 만드는데, 알아듣는 표현(총액 N원·N% 균등·N% 실적, 기본료 N원 + 건당 N원, N건까지 건당 N원 구간, 건당 단가 N원·최저/최고 회비, 총액 N원 실적 비율)이 규칙에 없습니다. 수식을 직접 작성해 주세요.',
    );
  }
  let passed = true;
  let message = '섹션·구문 검사와 시험 계산 2벌(정상·실적 0)을 통과했습니다.';
  let normal = null;
  let zero = null;
  try {
    normal = Math.round(evaluateFormula(g.formula, FORMULA_SAMPLES[0]));
    zero = Math.round(evaluateFormula(g.formula, FORMULA_SAMPLES[1]));
  } catch (e) {
    passed = false;
    message = e.message;
  }
  return {
    taskCode,
    generatedFormula: g.formula,
    equalFormula: g.equalFormula ?? null,
    perfFormula: g.perfFormula ?? null,
    detectedPattern: g.pattern,
    explanation: g.steps,
    validationPassed: passed,
    validationMessage: message,
    sampleResultNormal: normal,
    sampleResultZero: zero,
    source: 'RULE',
    model: null,
    note: '서버 미연결(Mock) 모드: 브라우저에 AI 키를 둘 수 없어 서버와 같은 내장 변환기로 만들었습니다.',
  };
}
