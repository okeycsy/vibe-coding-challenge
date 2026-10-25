import { INSTITUTIONS, getBaseCounts } from '../data/mockData';
import { asQuarter, daysBetween } from './period';
import { allocate, evaluateFormula, rateLabel } from './skill';

export const fmt = (n) => Math.round(n).toLocaleString('ko-KR');

// AI 에이전트 이슈 문장을 해석하는 시연용 파서.
// 기관 별칭과 "1,500건" 같은 건수를 찾아 차감 규칙으로 바꾼다.
// 문장에 들어 있는 이름·별칭 중 가장 긴 것을 고른다 ('하나온은행'이 '하나'(하나은행)로 잡히지 않도록).
export function longestMatch(text) {
  let best = null;
  INSTITUTIONS.forEach((inst) => {
    const alias = [inst.name, ...inst.aliases].find((a) => text.includes(a));
    if (alias && (!best || alias.length > best.alias.length)) best = { inst, alias };
  });
  return best;
}

export function parseIssue(text) {
  const match = longestMatch(text);
  const inst = match?.inst;
  const countMatch = text.match(/([\d,]+)\s*건/);
  const count = countMatch ? Number(countMatch[1].replace(/,/g, '')) : null;
  const dateMatch = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);

  let reason = '기타 예외';
  if (/장애/.test(text)) reason = '시스템 장애';
  else if (/중복/.test(text)) reason = '중복 전송';
  else if (/테스트|시험/.test(text)) reason = '테스트 전문';
  else if (/재처리/.test(text)) reason = '재처리분';
  if (/중복/.test(text) && reason === '시스템 장애') reason = '시스템 장애·중복 전송';

  return {
    institutionId: inst?.id ?? null,
    institutionName: inst?.name ?? null,
    matchedAlias: match?.alias ?? null,
    count,
    date: dateMatch ? `${dateMatch[1]}/${dateMatch[2]}` : null,
    reason,
  };
}

// 분기 기준 값(실적·총액)에 곱할 비율. 정확히 한 분기면 1, 아니면 산출 기간 일수 ÷ 91일.
export const periodScale = (from, to) => (asQuarter(from, to) ? 1 : daysBetween(from, to) / 91);

// 서버가 없을 때 브라우저에서 산출한다. skill(parseSkill 결과)의 정산 수식을 기관마다 실행한다.
// counts(업로드 실적 [{ institutionId, baseCount }])가 있으면 그 건수를 그대로 쓰고, 없으면 시연용 예시 실적을 만든다.
export function calculateFees({ businessId, from, to, issues, skill, counts }) {
  const scale = periodScale(from, to);
  const base = counts?.length ? counts : getBaseCounts(businessId, from, to, scale);

  const rows = base.map(({ institutionId, baseCount }) => {
    const inst = INSTITUTIONS.find((i) => i.id === institutionId);
    const related = issues.filter((i) => i.parsed.institutionId === institutionId);
    const deduction = Math.min(
      baseCount,
      related.reduce((s, i) => s + i.parsed.count, 0),
    );
    return {
      institutionId,
      name: inst.name,
      code: inst.code,
      baseCount,
      deduction,
      reasons: related.map((i) => i.text),
      finalCount: baseCount - deduction,
    };
  });

  const totalCount = rows.reduce((s, r) => s + r.finalCount, 0);
  const fees = allocate(
    rows.map((r) =>
      evaluateFormula(skill.formula, {
        rawCount: r.baseCount,
        deductedCount: r.deduction,
        finalCount: r.finalCount,
        totalCount,
        institutionCount: rows.length,
        periodScale: scale,
      }),
    ),
  );
  const feeSum = fees.reduce((s, f) => s + f, 0);
  return rows.map((r, idx) => ({
    ...r,
    rateLabel: rateLabel(skill, fees[idx], r.finalCount, feeSum),
    fee: fees[idx],
    status: '대기',
  }));
}

export const runKey = (businessId, from, to) => `${businessId}-${from}-${to}`;
