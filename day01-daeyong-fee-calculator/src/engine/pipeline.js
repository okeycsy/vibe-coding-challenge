// 업무 하나의 전체 계산(12-8 계산 순서). 화면과 엑셀 내보내기는 모두 이 결과만 쓴다.
import { computeQuarterSchedule } from './quarters.js';
import { computeFees } from './fee.js';
import { pendingDecisions, postOfficeOrgId } from './model.js';

export const STATUS_LABEL = { ok: '일치', fail: '불일치', warn: '확인 필요' };

export function runBusiness(b) {
  const s = b.settings;
  // 2~3. 연간 회비, 전기이월잉여금 → 분기별 청구 대상 총액
  const schedule = computeQuarterSchedule({
    annualFee: s.annualFee,
    surplus: s.surplus,
    surplusConfirmed: s.surplusConfirmed,
    q1Billed: s.q1Billed,
    method: s.quarterMethod,
    rounding: s.quarterRounding,
    diffQuarter: s.quarterDiffQuarter,
  });
  const total = schedule.quarters[s.quarter - 1].amount;
  const orgs = b.orgs.filter((o) => o.active);

  // 6~10. 균등·실적 총액 → 기관별 배분 → 원 단위 잔액 → 우체국 처리
  let fee = null;
  let feeError = '';
  try {
    fee = computeFees({
      total: Math.max(total, 0),
      orgs,
      items: b.items,
      recognizedItemIds: b.recognizedItemIds,
      perf: b.perf,
      equalRateBp: s.equalRateBp,
      perfRateBp: s.perfRateBp,
      equal: s.equal,
      perfRemainder: s.perfRemainder,
      postOffice: { ...s.postOffice, orgId: postOfficeOrgId(b) },
    });
  } catch (err) {
    feeError = err.message;
  }

  // 11. 검증
  const checks = [
    {
      id: 'quarters',
      label: '1~4분기 회비 합계 = 최종 연간 회비(전기이월잉여금 반영)',
      expected: schedule.D,
      actual: schedule.sum,
      diff: schedule.sum - schedule.D,
      status: schedule.sum !== schedule.D ? 'fail' : s.surplusConfirmed ? 'ok' : 'warn',
      cause: schedule.sum !== schedule.D
        ? `분기 금액 원 단위 처리로 ${schedule.diff.toLocaleString('ko-KR')}원 차액이 생겼습니다. 차액을 반영할 분기를 골라 주세요.`
        : s.surplusConfirmed ? '' : '전기이월잉여금이 확정되지 않아 잠정 금액입니다.',
      targets: schedule.diffQuarter ? `${schedule.diffQuarter}분기` : '',
    },
    ...(fee?.checks ?? []),
  ];
  const issues = [...schedule.issues, ...(fee?.issues ?? []), ...(feeError ? [{ level: 'error', message: feeError }] : [])];
  if (!b.perfMeta) issues.push({ level: 'warn', message: '실적 데이터를 아직 적용하지 않았습니다.' });
  const pending = pendingDecisions(b);
  const status = checks.some((c) => c.status === 'fail') || issues.some((i) => i.level === 'error')
    ? 'fail'
    : checks.some((c) => c.status === 'warn') || issues.some((i) => i.level === 'warn') || pending.length
      ? 'warn'
      : 'ok';
  return { schedule, total, fee, checks, issues, pending, status };
}
