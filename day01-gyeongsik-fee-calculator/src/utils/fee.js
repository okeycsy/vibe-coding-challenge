import { INSTITUTIONS, getBaseCounts } from '../data/mockData';
import { asQuarter, daysBetween } from './period';
import { allocate, evaluateFormula, rateLabel } from './skill';
import { postProcess, reviewIssues } from './aiRules';

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

// 서버가 없을 때 브라우저에서 산출한다 (서버 FeeCalculationService.calculate 와 같은 순서, AI 단계는 규칙 기반).
// Step A: 이슈 문장을 skill.md "## 2. AI 예외 차감 지침"으로 판별해 차감 대상만 차감
// Step B: skill(parseSkill 결과)의 정산 수식을 기관마다 실행해 1차 회비(primaryFee)
// Step C: "## 1. 비즈니스 규칙 요약"의 단수 처리·예외 규정(절상·절삭·최저/최고 회비)으로 최종 회비(fee)와 보정 사유(aiAdjustReason)
// counts(업로드 실적 [{ institutionId, baseCount }])가 있으면 그 건수를 그대로 쓰고, 없으면 시연용 예시 실적을 만든다.
export function calculateFees({ businessId, from, to, issues, skill, counts }) {
  const scale = periodScale(from, to);
  const base = counts?.length ? counts : getBaseCounts(businessId, from, to, scale);
  const reviewed = reviewIssues(skill.aiGuide, issues);

  const rows = base.map(({ institutionId, baseCount }) => {
    const inst = INSTITUTIONS.find((i) => i.id === institutionId);
    const related = reviewed.filter((i) => i.applied && i.parsed.institutionId === institutionId);
    const deduction = Math.min(
      baseCount,
      related.reduce((s, i) => s + i.parsed.count, 0),
    );
    return {
      institutionId,
      name: inst.name,
      code: inst.code,
      aliases: inst.aliases,
      baseCount,
      deduction,
      reasons: related.map((i) => i.text),
      finalCount: baseCount - deduction,
    };
  });

  const totalCount = rows.reduce((s, r) => s + r.finalCount, 0);
  const primary = allocate(
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
  const adjusted = postProcess(
    skill.summaryText,
    rows.map((r, idx) => ({ ...r, primaryFee: primary[idx] })),
  );
  const feeSum = adjusted.reduce((s, a) => s + a.finalFee, 0);
  return {
    rows: rows.map(({ aliases, ...r }, idx) => ({
      ...r,
      rateLabel: rateLabel(skill, adjusted[idx].finalFee, r.finalCount, feeSum),
      primaryFee: primary[idx],
      fee: adjusted[idx].finalFee,
      aiAdjustReason: adjusted[idx].finalFee === primary[idx] ? null : adjusted[idx].reason,
      status: '대기',
    })),
    issues: reviewed,
    ai: { mode: 'MOCK', model: null, note: '서버 미연결(Mock) 모드: 브라우저에 AI 키를 둘 수 없어 서버와 같은 규칙 기반으로 판별·보정했습니다.' },
  };
}

export const runKey = (businessId, from, to) => `${businessId}-${from}-${to}`;
