// 회비 안분 계산 (화면·엑셀과 무관한 순수 로직)
//
// 규칙
// - 회비총액의 25%(균등분)는 모든 기관에 똑같이 나눈다.
// - 나머지 75%(건수분)는 기관별 (압류+추심+해제) 건수가 전체에서 차지하는 비율로 나눈다.
// 원 단위 처리
// - 균등분 풀 = round(총액 × 25%), 건수분 풀 = 총액 − 균등분 풀.
// - 각 풀은 기관별 금액을 원 미만 버림한 뒤, 남는 원(단수)을 소수점 이하가 큰 기관부터 1원씩 더한다(최대잔여법).
//   그래서 기관별 합계의 총합은 항상 입력한 총액과 정확히 같다.

export const EQUAL_RATIO = 0.25;

// 정수 금액 pool을 weights 비율로 나누되, 합계가 pool과 정확히 같도록 최대잔여법으로 단수 보정
export function allocate(pool, weights) {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  // 가중치가 모두 0이면 균등 분배
  const w = totalWeight > 0 ? weights : weights.map(() => 1);
  const wSum = totalWeight > 0 ? totalWeight : weights.length;

  const exact = w.map((x) => (pool * x) / wSum);
  const base = exact.map((x) => Math.floor(x));
  let remainder = pool - base.reduce((a, b) => a + b, 0);

  // 소수점 이하가 큰 순, 같으면 원래 순서
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length, remainder--) {
    base[order[k].i] += 1;
  }
  return base;
}

// orgs: [{ name, seizure, collection, release }]
export function calculateFees(totalFee, orgs, equalRatio = EQUAL_RATIO) {
  if (!Number.isInteger(totalFee) || totalFee <= 0) {
    throw new Error('회비 총액은 1원 이상의 정수여야 합니다.');
  }
  if (orgs.length === 0) throw new Error('기관 데이터가 없습니다.');

  const counts = orgs.map((o) => o.seizure + o.collection + o.release);
  const totalCount = counts.reduce((a, b) => a + b, 0);

  const equalPool = Math.round(totalFee * equalRatio);
  const ratioPool = totalFee - equalPool;

  const equalShares = allocate(equalPool, orgs.map(() => 1));
  const ratioShares = allocate(ratioPool, counts);

  const rows = orgs.map((o, i) => ({
    ...o,
    count: counts[i],
    ratio: totalCount > 0 ? counts[i] / totalCount : 1 / orgs.length,
    equalShare: equalShares[i],
    ratioShare: ratioShares[i],
    fee: equalShares[i] + ratioShares[i],
  }));

  const warnings = [];
  if (totalCount === 0) {
    warnings.push('전체 건수가 0건이라 건수분(75%)도 균등 분배했습니다.');
  }

  return {
    totalFee,
    equalRatio,
    equalPool,
    ratioPool,
    totalCount,
    rows,
    totals: {
      seizure: orgs.reduce((a, o) => a + o.seizure, 0),
      collection: orgs.reduce((a, o) => a + o.collection, 0),
      release: orgs.reduce((a, o) => a + o.release, 0),
      count: totalCount,
      equalShare: equalPool,
      ratioShare: ratioPool,
      fee: totalFee,
    },
    warnings,
  };
}
