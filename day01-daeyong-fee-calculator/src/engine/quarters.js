// 연간 회비 → 분기별 청구 대상 총액 (요구사항 3장)
//
// A = 당초 연간 회비, B = 전기이월잉여금, C = 1분기 기청구 회비
// D = 최종 연간 회비 = A − B, E = 2~4분기 청구 대상 = D − C
// 방식 A(상·하반기 동일): 2분기 = D/2 − C, 3분기 = 4분기 = D/4
// 방식 B(잔여 3등분):     2분기 = 3분기 = 4분기 = (D − C)/3
// 원 단위로 나누어떨어지지 않으면 설정한 방식으로 정수화하고, 남는 차액은 담당자가 고른 분기에 더한다.
import { divRound, divisible, toNumber, won, ROUNDING } from './money.js';

export const QUARTER_METHODS = {
  A: '방식 A: 상반기와 하반기 회비 총액 동일',
  B: '방식 B: 1분기 기청구액 제외 잔여 회비 3개 분기 균등',
};

export function computeQuarterSchedule({
  annualFee,
  surplus = 0,
  surplusConfirmed = true,
  q1Billed = null,
  method = 'A',
  rounding = 'floor',
  diffQuarter = null,
}) {
  const issues = [];
  const A = BigInt(annualFee || 0);
  const B = surplusConfirmed ? BigInt(surplus || 0) : 0n;
  const q1Auto = divRound(A, 4, rounding);
  const C = q1Billed === null || q1Billed === undefined || q1Billed === '' ? q1Auto : BigInt(q1Billed);
  const D = A - B;
  const E = D - C;

  if (A <= 0n) issues.push({ level: 'error', message: '당초 연간 회비를 입력해 주세요.' });
  if (B < 0n) issues.push({ level: 'error', message: '전기이월잉여금은 0 이상이어야 합니다.' });
  if (B > A) issues.push({ level: 'error', message: '전기이월잉여금이 당초 연간 회비보다 큽니다.' });

  const r = ROUNDING[rounding];
  const q = { 1: C, 2: 0n, 3: 0n, 4: 0n };
  const formulas = {
    1: q1Billed === null || q1Billed === undefined || q1Billed === ''
      ? `당초 연간 회비 ${won(A)} ÷ 4${divisible(A, 4) ? '' : ` (${r})`} = ${won(C)}`
      : `기청구액 ${won(C)} (변경하지 않음)`,
  };
  if (method === 'A') {
    q[2] = divRound(D - 2n * C, 2, rounding);
    q[3] = divRound(D, 4, rounding);
    q[4] = q[3];
    formulas[2] = `D/2 − C = ${won(D)} ÷ 2 − ${won(C)}${divisible(D - 2n * C, 2) ? '' : ` (${r})`} = ${won(q[2])}`;
    formulas[3] = `D/4 = ${won(D)} ÷ 4${divisible(D, 4) ? '' : ` (${r})`} = ${won(q[3])}`;
    formulas[4] = formulas[3];
  } else {
    const each = divRound(E, 3, rounding);
    q[2] = q[3] = q[4] = each;
    const f = `(D − C)/3 = (${won(D)} − ${won(C)}) ÷ 3${divisible(E, 3) ? '' : ` (${r})`} = ${won(each)}`;
    formulas[2] = formulas[3] = formulas[4] = f;
  }

  const rawSum = q[1] + q[2] + q[3] + q[4];
  const diff = D - rawSum; // 원 단위 처리로 생긴 차액
  let diffApplied = false;
  if (diff !== 0n) {
    if ([2, 3, 4].includes(diffQuarter)) {
      q[diffQuarter] += diff;
      formulas[diffQuarter] += ` → 차액 ${won(diff)} 반영 = ${won(q[diffQuarter])}`;
      diffApplied = true;
    } else {
      issues.push({
        level: 'warn',
        message: `분기 금액을 원 단위로 맞추면서 ${won(diff)} 차액이 생겼습니다. 차액을 반영할 분기를 골라 주세요.`,
      });
    }
  }
  for (const k of [2, 3, 4]) {
    if (q[k] < 0n) issues.push({ level: 'error', message: `${k}분기 회비가 음수(${won(q[k])})입니다. 1분기 기청구액이 너무 큽니다.` });
  }

  const quarters = [1, 2, 3, 4].map((k) => ({ quarter: k, amount: toNumber(q[k]), formula: formulas[k] }));
  const sum = quarters.reduce((a, x) => a + x.amount, 0);
  return {
    A: toNumber(A),
    B: toNumber(B),
    C: toNumber(C),
    D: toNumber(D),
    E: toNumber(E),
    q1Auto: toNumber(q1Auto),
    q1IsAuto: q1Billed === null || q1Billed === undefined || q1Billed === '',
    surplusConfirmed,
    method,
    rounding,
    quarters,
    sum,
    diff: toNumber(diff),
    diffQuarter: diffApplied ? diffQuarter : null,
    balanced: sum === toNumber(D),
    issues,
  };
}
