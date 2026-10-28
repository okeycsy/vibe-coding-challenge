import { INSTITUTIONS, getBaseCounts } from '../data/mockData';
import { asQuarter, daysBetween } from './period';
import { computeRaw, rateLabel, requireSingleInput, skillInputs, variablesOf } from './skill';
import { reviewIssues } from './aiRules';
import { runScript, scriptOf } from './postprocess';
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
// Step 1: "## 3. 정산 수식"(총액 또는 균등·실적 분리 수식)을 기관마다 실행해 원 미만까지의 원시값
// Step 2: "## 4. 최종 정산 특이사항"의 후처리 스크립트(postprocess.js)로 정수화·보정·검증 → 최종 회비(fee)와 보정 사유(specialReason)
// counts(업로드 실적 [{ institutionId, baseCount, inputs }])가 있으면 그 실적 항목별 건수(inputs, 없으면 baseCount 를 하나뿐인 입력에)를
// 3번 변수 정의로 계산해 쓰고, 없으면 시연용 예시 실적을 만든다(실적 입력이 하나인 기준만). 같은 기관이 여러 번 오면 더한다.
// 행 순서는 서버와 같은 기관 목록 순서다 ("첫 번째 기관" 절상 대상이 서버와 같도록).
export function calculateFees({ businessId, from, to, issues, skill, counts }) {
  const scale = periodScale(from, to);
  const vars = variablesOf(skill);
  const inputDefs = skillInputs(skill);
  const order = (id) => INSTITUTIONS.findIndex((i) => i.id === id);
  const merged = new Map();
  const source = counts?.length ? counts : getBaseCounts(businessId, from, to, scale).map((c) => ({ ...c, inputs: { [requireSingleInput(vars).name]: c.baseCount } }));
  for (const c of source) {
    const inst = INSTITUTIONS.find((i) => i.id === c.institutionId);
    // 서버와 같이, 업로드 후 기관 관리에서 지우거나 사용 중지한 기관은 산출하지 않는다
    if (!inst || inst.active === false) {
      throw new Error(`알 수 없거나 사용 중지된 기관입니다: ${c.institutionId} (실적 파일을 다시 올려 주세요)`);
    }
    const byInput = c.inputs && inputDefs.some((d) => d.name in c.inputs);
    const values = byInput
      ? Object.fromEntries(inputDefs.map((d) => [d.name, Math.max(0, Number(c.inputs[d.name]) || 0)]))
      : { [requireSingleInput(vars).name]: Math.max(0, Number(c.baseCount) || 0) };
    const row = merged.get(c.institutionId) ?? { institutionId: c.institutionId, inputs: Object.fromEntries(inputDefs.map((d) => [d.name, 0])) };
    inputDefs.forEach((d) => (row.inputs[d.name] += values[d.name] ?? 0));
    merged.set(c.institutionId, row);
  }
  const reviewed = reviewIssues(skill.aiGuide, issues);
  const base = [...merged.values()].sort((a, b) => order(a.institutionId) - order(b.institutionId));
  const rows = base.map(({ institutionId, inputs }) => {
    const inst = INSTITUTIONS.find((i) => i.id === institutionId);
    const related = reviewed.filter((i) => i.applied && i.parsed.institutionId === institutionId);
    return {
      institutionId,
      name: inst.name,
      code: inst.code,
      aliases: inst.aliases,
      inputs,
      deductedCount: related.reduce((s, i) => s + i.parsed.count, 0),
      reasons: related.map((i) => i.text),
    };
  });

  // Step 1: 변수 정의로 기관별 rawCount·차감(rawCount 를 넘지 않게)·finalCount 를 확정하고 수식을 계산한다
  const raw = computeRaw(skill, rows, scale);
  rows.forEach((r, idx) => {
    r.baseCount = raw.bound.rawCount[idx];
    r.deduction = raw.bound.deducted[idx];
    r.finalCount = raw.bound.finalCount[idx];
  });
  const lineRows = rows.map((r, idx) => ({
    institutionId: r.institutionId,
    code: r.code,
    name: r.name,
    aliases: r.aliases,
    finalCount: r.finalCount,
    equalMicro: raw.equalMicro[idx],
    perfMicro: raw.perfMicro[idx],
  }));
  const script = scriptOf(skill, rows.map((r) => ({ name: r.name, aliases: r.aliases ?? [] })));
  const result = runScript(script.text, lineRows);
  const feeSum = result.items.reduce((s, it) => s + it.fee, 0);
  return {
    rows: rows.map(({ aliases, deductedCount, ...r }, idx) => {
      const it = result.items[idx];
      return {
        ...r,
        rateLabel: rateLabel(skill, it.fee, r.finalCount, feeSum),
        equalFee: it.equalFee,
        perfFee: it.perfFee,
        fee: it.fee,
        specialRuleApplied: it.applied,
        beforeSpecialFee: it.beforeSpecialFee,
        specialAdjustment: it.adjustment,
        specialReason: it.reason,
        status: '대기',
      };
    }),
    issues: reviewed,
    special: { postprocess: script.text, source: script.source, checks: result.checks, notes: result.notes },
    variables: skill.variables ?? '',
    inputDefs,
    ai: { mode: 'MOCK', model: null, note: '서버 미연결(Mock) 모드: 브라우저에 AI 키를 둘 수 없어 이슈 차감은 서버와 같은 규칙 기반으로 판별했습니다.' },
  };
}

export const runKey = (businessId, from, to) => `${businessId}-${from}-${to}`;
