// 병행검증용 변환: v4(day01-daeyong-fee-calculator) 설정 JSON ↔ 이 프로토타입의 업무 구조, 두 엔진 결과 비교.
// v4 엔진은 reference/v4-engine/ 에 그대로 복사해 두고(COMMIT 파일에 기준 커밋) 결과만 비교한다.
import { newBusiness, normalizeBusiness } from './model.js';
import { defaultDecisions } from './decisions.js';

export const isV4State = (data) => Array.isArray(data?.businesses) && data.businesses.some((b) => b?.settings?.equalRateBp !== undefined);
export const isProtoState = (data) => Array.isArray(data?.businesses) && data.businesses.some((b) => b?.cond?.equalBp !== undefined);

const v4PostOfficeOrgId = (v) =>
  v.settings.postOffice.orgId && v.orgs.some((o) => o.id === v.settings.postOffice.orgId)
    ? v.settings.postOffice.orgId
    : v.orgs.find((o) => o.name.includes('우체국'))?.id ?? null;

const REMAINDER_V4_TO_PROTO = { largestRemainder: 'largestFraction', largestPerf: 'largestPerf', manual: 'manual' };
const REMAINDER_PROTO_TO_V4 = { largestFraction: 'largestRemainder', largestPerf: 'largestPerf', manual: 'manual', order: 'manual' };

// v4 업무 → 프로토타입 업무
export function fromV4Business(v) {
  const s = v.settings;
  const c = v.confirmed ?? {};
  const poId = v4PostOfficeOrgId(v);
  const b = newBusiness(v.name);
  b.id = v.id;
  b.orgs = v.orgs.map((o) => ({ id: o.id, name: o.name, active: o.active !== false, postOffice: o.id === poId }));
  b.items = v.items.map((i) => ({ ...i }));
  b.recognized = [...v.recognizedItemIds];
  b.cond = {
    year: s.year, quarter: s.quarter, A: s.annualFee, B: s.surplus, bConfirmed: Boolean(s.surplusConfirmed), C: s.q1Billed,
    quarterMethod: s.quarterMethod, equalBp: s.equalRateBp, perfBp: s.perfRateBp, equalMethod: s.equal.method,
    postOffice: Boolean(s.postOffice.enabled), perfPeriod: { ...(s.perfPeriod ?? { start: '', end: '' }) }, autoAddOrgs: s.autoAddOrgs !== false,
  };
  const d = defaultDecisions();
  d['D-1'] = { value: s.q1Billed === null || s.q1Billed === undefined ? 'auto' : 'manual', confirmed: Boolean(c.q1Source) };
  d['D-2'] = { value: s.quarterRounding ?? 'floor', confirmed: Boolean(c.quarterRounding) };
  d['D-3'] = { value: s.quarterDiffQuarter ?? null, confirmed: Boolean(c.quarterDiff) };
  d['D-4'] = { value: s.equal.poolRounding ?? 'round', confirmed: Boolean(c.equalPoolRounding) };
  d['D-5'] = { value: s.equal.unitRounding ?? 'floor', confirmed: Boolean(c.equalUnitRounding) };
  d['D-6'] = { value: s.equal.targetMode === 'manual' ? 'manual' : 'order', orgIds: [...(s.equal.targetOrgIds ?? [])], confirmed: Boolean(c.equalTargets) };
  d['D-7'] = { value: s.equal.bMode === 'manual' ? 'manual' : 'auto', unit: s.equal.bUnit ?? 1, rounding: s.equal.bRounding ?? 'floor', amount: s.equal.bAmount ?? 0, confirmed: Boolean(c.equalBRounding) };
  d['D-8'] = { value: REMAINDER_V4_TO_PROTO[s.perfRemainder?.mode] ?? 'largestFraction', orgIds: [...(s.perfRemainder?.orgIds ?? [])], confirmed: Boolean(c.perfRemainder) };
  d['D-9'] = { value: s.postOffice.direction === 'down' ? 'down' : 'up', confirmed: Boolean(c.poDirection) };
  d['D-10'] = { value: s.postOffice.counterpartMode === 'manual' ? 'manual' : 'largestPerf', orgId: s.postOffice.counterpartOrgId ?? null, confirmed: Boolean(c.poCounterpart) };
  d['D-11'] = { value: 'zero', confirmed: Boolean(c.missingOrgs) };
  d['D-12'] = { value: s.duplicatePolicy === 'error' ? 'error' : 'sum', confirmed: Boolean(c.duplicatePolicy) };
  b.decisions = d;
  b.mapping = { ...(v.columnMapping ?? {}) };
  b.perf = structuredClone(v.perf ?? {});
  b.perfMeta = v.perfMeta ? { ...v.perfMeta } : null;
  return normalizeBusiness(b);
}

// 프로토타입 업무 → v4 업무 (v4 엔진을 같은 입력으로 돌리기 위해)
export function toV4Business(b) {
  const c = b.cond;
  const d = b.decisions;
  const po = b.orgs.find((o) => o.active && o.postOffice);
  return {
    id: b.id,
    name: b.name,
    orgs: b.orgs.map((o) => ({ id: o.id, name: o.name, active: o.active !== false })),
    items: b.items.map((i) => ({ ...i })),
    recognizedItemIds: [...b.recognized],
    settings: {
      year: c.year, quarter: c.quarter,
      annualFee: Number(c.A), surplus: Number(c.B), surplusConfirmed: Boolean(c.bConfirmed),
      q1Billed: d['D-1'].value === 'manual' && c.C != null ? Number(c.C) : null,
      quarterMethod: c.quarterMethod, quarterRounding: d['D-2'].value, quarterDiffQuarter: d['D-3'].value,
      equalRateBp: c.equalBp, perfRateBp: c.perfBp,
      equal: {
        method: c.equalMethod, poolRounding: d['D-4'].value, unitRounding: d['D-5'].value,
        targetMode: d['D-6'].value === 'manual' ? 'manual' : 'auto', targetOrgIds: [...(d['D-6'].orgIds ?? [])],
        bMode: d['D-7'].value, bUnit: d['D-7'].unit, bRounding: d['D-7'].rounding, bAmount: d['D-7'].amount,
      },
      perfRemainder: { mode: REMAINDER_PROTO_TO_V4[d['D-8'].value] ?? 'largestRemainder', orgIds: d['D-8'].value === 'order' ? b.orgs.filter((o) => o.active).map((o) => o.id) : [...(d['D-8'].orgIds ?? [])] },
      postOffice: { enabled: Boolean(c.postOffice), orgId: po?.id ?? null, direction: d['D-9'].value, counterpartMode: d['D-10'].value === 'manual' ? 'manual' : 'auto', counterpartOrgId: d['D-10'].orgId ?? null },
      duplicatePolicy: d['D-12'].value,
      autoAddOrgs: c.autoAddOrgs !== false,
      perfPeriod: { ...(c.perfPeriod ?? { start: '', end: '' }) },
    },
    columnMapping: { ...(b.mapping ?? {}) },
    perf: structuredClone(b.perf ?? {}),
    perfMeta: b.perfMeta ? { ...b.perfMeta } : null,
    confirmed: {},
  };
}

// 두 엔진의 결과를 기관별로 나란히 놓고 차이를 찾는다.
// mine = 이 프로토타입 runBusiness 결과, ref = v4 runBusiness 결과
export function compareRuns(mine, ref) {
  const n = (v) => (v === null || v === undefined ? null : Number(v));
  const quarters = mine.sch.quarters.map((q, i) => {
    const r = ref.schedule.quarters[i];
    return { q: q.q, mine: n(q.amount), ref: n(r?.amount), same: n(q.amount) === n(r?.amount) };
  });
  const refRows = Object.fromEntries((ref.fee?.rows ?? []).map((r) => [r.id, r]));
  const rows = (mine.alloc?.rows ?? []).map((m) => {
    const r = refRows[m.id];
    const cols = {
      recognized: [n(m.recognized), n(r?.recognized)],
      equal: [n(m.equalFinal), n(r?.equalFinal)],
      perf: [n(m.perfFinal), n(r?.perfFinal)],
      final: [n(m.final), n(r?.final)],
    };
    const diffs = Object.entries(cols).filter(([, [a, b]]) => a !== b).map(([k]) => k);
    return { id: m.id, name: m.name, ...Object.fromEntries(Object.entries(cols).map(([k, [a, b]]) => [k, { mine: a, ref: b, diff: a !== null && b !== null ? a - b : null }])), diffs, same: diffs.length === 0 };
  });
  const missingInMine = (ref.fee?.rows ?? []).filter((r) => !rows.some((m) => m.id === r.id)).map((r) => r.name);
  const totals = {
    T: { mine: n(mine.T), ref: n(ref.total) },
    equalPool: { mine: n(mine.alloc?.equal.pool), ref: n(ref.fee?.equal.pool) },
    perfPool: { mine: n(mine.alloc?.perf.pool), ref: n(ref.fee?.perf.pool) },
    sumFinal: { mine: n(mine.alloc?.rows.reduce((s, r) => s + r.final, 0n)), ref: n(ref.fee?.rows.reduce((s, r) => s + r.final, 0)) },
  };
  for (const t of Object.values(totals)) t.same = t.mine === t.ref;
  const status = {
    mine: mine.status,
    ref: ref.status,
    mineFails: mine.checks.filter((c) => c.status === 'fail').map((c) => c.label),
    refFails: ref.checks.filter((c) => c.status === 'fail').map((c) => c.label),
  };
  const same = quarters.every((q) => q.same) && rows.every((r) => r.same) && missingInMine.length === 0 && Object.values(totals).every((t) => t.same);
  return { same, quarters, rows, missingInMine, totals, status };
}
