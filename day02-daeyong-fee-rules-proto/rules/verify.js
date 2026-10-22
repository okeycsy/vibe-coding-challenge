// R-12 검증. 산출할 때마다 자동으로 돌리고, 일치 / 불일치 / 확인 필요로 표시한다.
import { B as big, BP, won } from './money.js';

export const STATUS = { ok: '일치', fail: '불일치', warn: '확인 필요' };

const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0n);

export function verify({ sch, quarter, alloc, equalBp, perfBp }) {
  const checks = [];
  const add = (rule, label, expected, actual, cause = '', targets = '', warnOnly = false) => {
    const ok = expected === actual;
    checks.push({ rule, label, expected, actual, diff: actual - expected, status: ok ? 'ok' : warnOnly ? 'warn' : 'fail', cause: ok ? '' : cause, targets: ok ? '' : targets });
  };

  // 3. 1~4분기 합계 = D
  add('R-12.1-3', '1~4분기 회비 합계 = 최종 연간 회비 D', sch.D, sch.sum,
    `분기 금액 원 단위 처리로 ${won(sch.diff)} 차액. 차액을 반영할 분기(D-3)를 고르세요.`, sch.diffQuarter ? `${sch.diffQuarter}분기` : '');

  if (alloc) {
    const rows = alloc.rows;
    const T = alloc.T;
    // 1. 균등 합계 + 실적 합계 = T
    add('R-12.1-1', '균등회비 합계 + 실적회비 합계 = 분기 청구 대상 총액', T, sum(rows, 'equalFinal') + sum(rows, 'perfFinal'),
      '원 단위 잔액이나 조정이 총액과 맞지 않습니다.', alloc.perf.leftoverTargets?.map((id) => rows.find((r) => r.id === id)?.name).join(', ') ?? '');
    // 2. 전체 기관 합계 = T
    add('R-12.1-2', '전체 기관 회비 합계 = 분기 청구 대상 총액', T, sum(rows, 'final'), '기관별 최종 회비 합계가 총액과 다릅니다.');
    // 4. 우체국 보정 전후 합계 유지, 1원 자리 0
    if (alloc.po.enabled) {
      const poRow = rows.find((r) => r.id === alloc.po.orgId);
      add('R-12.1-4a', '우체국 보정 전후 전체 회비 합계 유지', T, sum(rows, 'final'), '우체국 차액을 반대로 반영할 기관(D-10)이 없거나 잘못되었습니다.', alloc.po.counterpartName ?? '');
      add('R-12.1-4b', '우체국 최종 회비 1원 자리 = 0', 0n, poRow ? ((poRow.final % 10n) + 10n) % 10n : 0n, '우체국 회비가 10원 단위가 아닙니다.', poRow?.name ?? '');
    }
    // 5. 균등 방식 A: 균등 합계 = 균등회비 총액 / 방식 B: 모두 동일
    if (alloc.equal.method === 'A') {
      add('R-12.1-5', '균등회비 방식 A: 기관별 균등회비 합계 = 균등회비 총액', alloc.equal.pool, sum(rows, 'equalFinal'),
        `차액 ${won(alloc.equal.diff)}을(를) 받을 기관 수가 맞지 않습니다 (D-6).`, alloc.equal.targets.map((id) => rows.find((r) => r.id === id)?.name).join(', '));
    } else {
      const distinct = new Set(rows.map((r) => r.equalFinal.toString())).size;
      add('R-12.1-5', '균등회비 방식 B: 모든 기관의 균등회비가 같음 (서로 다른 금액 수 = 1)', 1n, BigInt(distinct || 1), '기관별 균등회비가 서로 다릅니다.');
    }
    // 6. 비율 합 100%, 음수 없음, 실적 누락, 인정 실적 0
    add('R-12.1-6a', '균등회비 비율 + 실적회비 비율 = 100%', BP, BigInt(equalBp) + BigInt(perfBp), '두 비율의 합이 100%가 아닙니다.');
    const negatives = rows.filter((r) => r.final < 0n || r.perfFinal < 0n || r.equalFinal < 0n);
    add('R-12.1-6b', '음수 회비 없음', 0n, BigInt(negatives.length), '음수 회비가 있는 기관이 있습니다.', negatives.map((r) => r.name).join(', '));
    const noData = rows.filter((r) => !r.hasData);
    add('R-12.1-6c', '모든 분담 대상 기관에 실적 데이터 있음', 0n, BigInt(noData.length), '실적 파일에 없는 기관은 D-11에 따라 0건으로 봅니다.', noData.map((r) => r.name).join(', '), true);
    add('R-12.1-6d', '전체 인정 실적 합계 > 0', 1n, alloc.perf.totalRecognized > 0n ? 1n : 0n, '인정 실적 합계가 0건이라 실적회비를 배분할 수 없습니다.');
  }
  return checks;
}

export const overallStatus = (checks, issues, pendingCount) =>
  checks.some((c) => c.status === 'fail') || issues.some((i) => i.level === 'error') ? 'fail'
    : checks.some((c) => c.status === 'warn') || issues.some((i) => i.level === 'warn') || pendingCount > 0 ? 'warn'
      : 'ok';
