// R-8 계산 순서대로 업무 하나를 끝까지 계산한다. 화면·엑셀·병행검증은 모두 이 결과만 쓴다.
import { schedule, totalForQuarter } from './schedule.js';
import { allocate } from './allocate.js';
import { verify, overallStatus } from './verify.js';
import { dec, pendingDecisions } from './decisions.js';

export function runBusiness(b) {
  const c = b.cond;
  const d = Object.fromEntries(['D-1', 'D-2', 'D-3', 'D-4', 'D-5', 'D-6', 'D-7', 'D-8', 'D-9', 'D-10', 'D-11', 'D-12'].map((id) => [id, dec(b, id)]));

  // 2~3. 연간 회비·잉여금 → 분기 총액
  const sch = schedule({
    A: c.A, B: c.B, bConfirmed: c.bConfirmed,
    C: d['D-1'].value === 'manual' && c.C != null ? c.C : null,
    method: c.quarterMethod, rounding: d['D-2'].value, diffQuarter: d['D-3'].value,
  });
  const T = totalForQuarter(sch, c.quarter);
  const orgs = b.orgs.filter((o) => o.active);
  const postOfficeOrgId = b.orgs.find((o) => o.active && o.postOffice)?.id ?? null;

  // 6~10. 배분
  let alloc = null;
  let allocError = '';
  try {
    alloc = allocate({
      T: T < 0n ? 0n : T,
      orgs, items: b.items, recognized: b.recognized, perf: b.perf,
      equalBp: c.equalBp, perfBp: c.perfBp, equalMethod: c.equalMethod, d,
      postOffice: { enabled: Boolean(c.postOffice), orgId: postOfficeOrgId },
    });
  } catch (err) {
    allocError = err.message;
  }

  // 11. 검증
  const checks = verify({ sch, quarter: c.quarter, alloc, equalBp: c.equalBp, perfBp: c.perfBp });
  const issues = [...sch.issues, ...(alloc?.issues ?? [])];
  if (allocError) issues.push({ level: 'error', rule: 'R-8.1', message: allocError });
  if (!b.perfMeta) issues.push({ level: 'warn', rule: 'R-10.1', message: '실적 데이터를 아직 적용하지 않았습니다.' });
  const pending = pendingDecisions(b);
  const status = overallStatus(checks, issues, pending.length);
  return { sch, T, alloc, checks, issues, pending, status, postOfficeOrgId };
}
