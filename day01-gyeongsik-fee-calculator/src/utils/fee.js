import { INSTITUTIONS, getBaseCounts } from '../data/mockData';
import { asQuarter, daysBetween } from './period';
import { calculatePrimary, rateLabel } from './skill';
import { reviewIssues } from './aiRules';
import { describeAction, executeSpecialActions, interpretSpecialRules } from './specialRules';
import { longestMatch } from './institutions';

export { longestMatch };

export const fmt = (n) => Math.round(n).toLocaleString('ko-KR');

// AI 에이전트 이슈 문장을 해석하는 시연용 파서.
// 기관 별칭과 "1,500건" 같은 건수를 찾아 차감 규칙으로 바꾼다.
// 문장에 들어 있는 이름·별칭 중 가장 긴 것을 고른다 (longestMatch, 사용 중인 기관만).
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

// 서버가 없을 때 브라우저에서 산출한다 (서버 FeeCalculationService.calculate 와 같은 순서·규칙이라 같은 금액이 나온다).
// 이슈 판별: 이슈 문장을 skill.md "## 2. AI 예외 차감 지침"으로 판별해 차감 대상만 차감 (규칙 기반)
// Step 1: "## 3. 정산 수식"을 기관마다 실행 + 원 단위 배분, 균등+실적 혼합형이면 균등분담분(equalFee)·실적분담분(perfFee) 분해
// Step 2: "## 4. 최종 정산 특이사항"(10원 절상·실적순 1원 절삭·N원 미만 절사·최저/최고 회비)으로 최종 회비(fee)와 보정 사유(specialReason)
// counts(업로드 실적 [{ institutionId, baseCount }])가 있으면 그 건수를 그대로 쓰고, 없으면 시연용 예시 실적을 만든다.
// 행 순서는 서버와 같은 기관 목록 순서다 ("첫 번째 기관" 절상 대상이 서버와 같도록).
export function calculateFees({ businessId, from, to, issues, skill, counts }) {
  const scale = periodScale(from, to);
  const order = (id) => INSTITUTIONS.findIndex((i) => i.id === id);
  const base = (counts?.length ? counts : getBaseCounts(businessId, from, to, scale))
    .slice()
    .sort((a, b) => order(a.institutionId) - order(b.institutionId));
  const reviewed = reviewIssues(skill.aiGuide, issues);

  const rows = base.map(({ institutionId, baseCount }) => {
    const inst = INSTITUTIONS.find((i) => i.id === institutionId);
    // 서버와 같이, 업로드 후 기관 관리에서 지우거나 사용 중지한 기관은 산출하지 않는다
    if (!inst || inst.active === false) {
      throw new Error(`알 수 없거나 사용 중지된 기관입니다: ${institutionId} (실적 파일을 다시 올려 주세요)`);
    }
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

  const primary = calculatePrimary(skill.formula, rows, scale);
  const lines = rows.map((r, idx) => ({ ...r, fee: primary.fees[idx] }));
  // 4번 특이사항: 규칙 기반 해석(브라우저엔 AI 키가 없음) → 보정 동작대로 실행
  const interpretation = interpretSpecialRules(skill.specialRulesRaw ?? '', lines);
  const special = executeSpecialActions(interpretation.actions, lines);
  const feeSum = special.reduce((s, a) => s + a.finalFee, 0);
  return {
    rows: rows.map(({ aliases, ...r }, idx) => {
      const fee = special[idx].finalFee;
      return {
        ...r,
        rateLabel: rateLabel(skill, fee, r.finalCount, feeSum),
        equalFee: primary.equalFees[idx],
        perfFee: fee - primary.equalFees[idx],
        fee,
        specialRuleApplied: special[idx].applied,
        beforeSpecialFee: primary.fees[idx],
        specialAdjustment: special[idx].adjustment,
        specialReason: special[idx].reason,
        status: '대기',
      };
    }),
    issues: reviewed,
    special: {
      mode: 'MOCK',
      model: null,
      note: null,
      actions: interpretation.actions.map((a) => ({ ...a, description: describeAction(a) })),
      unsupported: interpretation.unsupported,
    },
    ai: { mode: 'MOCK', model: null, note: '서버 미연결(Mock) 모드: 브라우저에 AI 키를 둘 수 없어 이슈 차감은 서버와 같은 규칙 기반으로 판별했습니다.' },
  };
}

export const runKey = (businessId, from, to) => `${businessId}-${from}-${to}`;
