import { BUSINESSES, INSTITUTIONS, getBaseCounts } from '../data/mockData';

export const fmt = (n) => Math.round(n).toLocaleString('ko-KR');

// AI 에이전트 이슈 문장을 해석하는 시연용 파서.
// 기관 별칭과 "1,500건" 같은 건수를 찾아 차감 규칙으로 바꾼다.
export function parseIssue(text) {
  const inst = INSTITUTIONS.find((i) => [i.name, ...i.aliases].some((a) => text.includes(a)));
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
    matchedAlias: inst ? [inst.name, ...inst.aliases].find((a) => text.includes(a)) : null,
    count,
    date: dateMatch ? `${dateMatch[1]}/${dateMatch[2]}` : null,
    reason,
  };
}

export function calculateFees({ businessId, year, quarter, issues }) {
  const biz = BUSINESSES.find((b) => b.id === businessId);
  const base = getBaseCounts(businessId, year, quarter);

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

  const totalFinal = rows.reduce((s, r) => s + r.finalCount, 0);

  return rows.map((r) => {
    if (biz.method === 'unit') {
      return { ...r, rateLabel: `${biz.unitPrice}원/건`, fee: r.finalCount * biz.unitPrice, status: '대기' };
    }
    const share = totalFinal ? r.finalCount / totalFinal : 0;
    return {
      ...r,
      rateLabel: `${(share * 100).toFixed(2)}%`,
      fee: Math.round(biz.totalFee * share),
      status: '대기',
    };
  });
}

export const runKey = (businessId, year, quarter) => `${businessId}-${year}-${quarter}`;
