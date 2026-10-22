// R-4 연간 회비와 분기 배분.
// A 당초 연간 회비, B 전기이월잉여금, C 1분기 기청구 회비, D = A − B, E = D − C
import { B as big, divide, won } from './money.js';

export const QUARTER_METHODS = {
  A: '방식 A: 상·하반기 총액 동일 (2분기 = D/2 − C, 3·4분기 = D/4)',
  B: '방식 B: 잔여 3개 분기 균등 (2·3·4분기 = (D − C)/3)',
};

// 입력: { A, B, bConfirmed, C(null이면 A÷4), method:'A'|'B', rounding(D-2), diffQuarter(D-3) }
export function schedule({ A, B = 0, bConfirmed = true, C = null, method = 'A', rounding = 'floor', diffQuarter = null }) {
  const a = big(A);
  const b = big(B);
  const issues = [];
  const steps = [];

  if (b > a) issues.push({ level: 'error', rule: 'R-4.2', message: `전기이월잉여금(${won(b)})이 당초 연간 회비(${won(a)})보다 큽니다.` });

  // R-4.1 1분기 = A ÷ 4 (D-1)
  const cAuto = C == null;
  const c = cAuto ? divide(a, 4n, rounding) : big(C);
  steps.push({ rule: cAuto ? 'R-4.1' : 'R-1.6', label: '1분기 기청구 회비 C', formula: cAuto ? `${won(a)} ÷ 4` : '실제 청구액', value: c });

  // R-4.2 D = A − B, E = D − C
  const d = a - b;
  const e = d - c;
  steps.push({ rule: 'R-4.2', label: '최종 연간 회비 D', formula: `${won(a)} − ${won(b)}`, value: d });
  steps.push({ rule: 'R-4.2', label: '2~4분기 청구 대상 E', formula: `${won(d)} − ${won(c)}`, value: e });

  // R-4.3 분기 배분 방식
  let q2; let q3; let q4; let f2; let f3;
  if (method === 'A') {
    const half = divide(d, 2n, rounding);
    const quarter = divide(d, 4n, rounding);
    q2 = half - c;
    q3 = quarter;
    q4 = quarter;
    f2 = `${won(d)} ÷ 2 − ${won(c)}`;
    f3 = `${won(d)} ÷ 4`;
  } else if (method === 'B') {
    const third = divide(e, 3n, rounding);
    q2 = third;
    q3 = third;
    q4 = third;
    f2 = `(${won(d)} − ${won(c)}) ÷ 3`;
    f3 = f2;
  } else {
    throw new Error(`알 수 없는 분기 배분 방식: ${method}`);
  }
  const quarters = [
    { q: 1, amount: c, formula: cAuto ? `${won(a)} ÷ 4` : '기청구액 유지', fixed: true },
    { q: 2, amount: q2, formula: f2 },
    { q: 3, amount: q3, formula: f3 },
    { q: 4, amount: q4, formula: f3 },
  ];

  // R-4.4 합계 = D. 차액은 D-3 분기에 더한다.
  const rawSum = quarters.reduce((s, x) => s + x.amount, 0n);
  const diff = d - rawSum;
  let applied = null;
  if (diff !== 0n && diffQuarter && diffQuarter >= 2 && diffQuarter <= 4) {
    const target = quarters[diffQuarter - 1];
    target.amount += diff;
    target.formula += ` ${diff > 0n ? '+' : '−'} 차액 ${won(diff < 0n ? -diff : diff)}`;
    target.diffApplied = diff;
    applied = diffQuarter;
  }
  const sum = quarters.reduce((s, x) => s + x.amount, 0n);
  const balanced = sum === d;
  if (!balanced) issues.push({ level: 'warn', rule: 'R-4.4', message: `분기 합계가 D와 ${won(diff)} 차이 납니다. 차액을 반영할 분기(D-3)를 고르세요.` });
  for (const x of quarters) if (x.amount < 0n) issues.push({ level: 'error', rule: 'R-12.1', message: `${x.q}분기 금액이 음수(${won(x.amount)})입니다. 1분기 기청구액이 너무 큽니다.` });
  if (!bConfirmed) issues.push({ level: 'warn', rule: 'R-4.2', message: '전기이월잉여금이 아직 확정되지 않았습니다. 2~4분기는 잠정 금액입니다.' });

  return { A: a, B: b, C: c, cAuto, D: d, E: e, method, rounding, quarters, rawSum, diff, diffQuarter: applied, sum, balanced, steps, issues };
}

// 이번 분기 청구 대상 총액 T
export const totalForQuarter = (sch, quarter) => sch.quarters[quarter - 1]?.amount ?? 0n;
