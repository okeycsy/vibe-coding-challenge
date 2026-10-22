// R-3 회비 구성, R-5 균등회비, R-6 실적회비, R-7 우체국 특수 처리.
// 계산 순서(R-8) 6~10단계를 한 번씩만 적용하고, 기관별 산출 근거(R-13)를 계산하는 자리에서 기록한다.
import { B as big, BP, divide, toUnit, remainder, won, count, ratioPercent, decimal, ROUNDING_MODES } from './money.js';

export const EQUAL_METHODS = {
  A: '방식 A: 균등회비 총액 정확성 우선',
  B: '방식 B: 기관별 균등회비 금액 동일성 우선',
};

/*
입력
  T                 이번 분기 청구 대상 총액 (BigInt 또는 숫자)
  orgs              분담 대상 기관 [{ id, name }]  (D-14: 실적 유무와 무관하게 전부 분모)
  items             실적 항목 [{ id, name }]
  recognized        인정할 항목 id 배열 (R-6.2)
  perf              { orgId: { itemId: 건수 } }
  equalBp, perfBp   균등·실적 비율 (bp)
  equalMethod       'A' | 'B'
  d                 결정값 { 'D-4', 'D-5', 'D-6', 'D-7', 'D-8', 'D-9', 'D-10' } (각각 { value, ... })
  postOffice        { enabled, orgId }
*/
export function allocate(input) {
  const T = big(input.T);
  const orgs = input.orgs;
  const n = BigInt(orgs.length);
  const d = input.d;
  const issues = [];
  const rows = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    counts: Object.fromEntries(input.items.map((i) => [i.id, Number(input.perf?.[o.id]?.[i.id] ?? 0)])),
    hasData: Boolean(input.perf?.[o.id]),
    recognized: 0n,
    equalBase: 0n, equalAdj: 0n, equalFinal: 0n,
    perfExactNum: 0n, perfFloor: 0n, perfFraction: 0n, perfRemainderAdj: 0n, perfPoAdj: 0n, perfFinal: 0n,
    final: 0n,
    trace: { equal: [], perf: [], adjust: [] },
  }));
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const say = (row, part, rule, label, formula, value) => row.trace[part].push({ rule, label, formula, value });

  if (orgs.length === 0) issues.push({ level: 'error', rule: 'R-11.1', message: '회비를 분담할 참가기관이 없습니다.' });

  // ── R-3 균등회비 총액과 실적회비 총액 ──────────────────────────────
  const equalBp = BigInt(input.equalBp);
  const perfBp = BigInt(input.perfBp);
  let equalPool;
  let equalUnit = null; // 방식 B의 기관별 동일 금액
  const equal = { method: input.equalMethod, diff: 0n, targets: [] };
  if (input.equalMethod === 'B') {
    // R-5.2 모든 기관이 정확히 같은 금액 (D-7)
    const d7 = d['D-7'];
    if (d7.value === 'manual') {
      equalUnit = big(d7.amount);
      equal.unitFormula = '담당자 지정';
    } else if (n > 0n) {
      // (T × 비율 ÷ n) 을 D-7 단위로 정수화. 단위가 1원이면 원 미만을 D-7 처리 방식으로, 아니면 그 단위로 처리.
      const unit = big(d7.unit || 1);
      equalUnit = divide(T * equalBp, BP * n * unit, d7.rounding) * unit;
      equal.unitFormula = `${won(T)} × ${ratioPercent(equalBp, BP, 2)} ÷ ${n}곳 → ${unit}원 단위 ${ROUNDING_MODES[d7.rounding]}`;
    } else {
      equalUnit = 0n;
    }
    equalPool = equalUnit * n;
    equal.unit = equalUnit;
  } else {
    // R-5.1 균등회비 총액 = T × 균등 비율 (D-4)
    equalPool = divide(T * equalBp, BP, d['D-4'].value);
    equal.poolFormula = `${won(T)} × ${ratioPercent(equalBp, BP, 2)} → ${ROUNDING_MODES[d['D-4'].value]}`;
  }
  // R-3.3 실적회비 총액 = T − 균등회비 총액
  const perfPool = T - equalPool;
  equal.pool = equalPool;
  equal.setBp = equalBp;
  equal.actualPercent = ratioPercent(equalPool, T);
  equal.setPercent = ratioPercent(equalBp, BP);
  const perf = { pool: perfPool, formula: `${won(T)} − ${won(equalPool)}` };

  // ── R-5 기관별 균등회비 ─────────────────────────────────────────────
  if (input.equalMethod === 'B') {
    for (const r of rows) {
      r.equalBase = equalUnit;
      r.equalFinal = equalUnit;
      say(r, 'equal', 'R-5.2', '기관별 동일 균등회비', equal.unitFormula, equalUnit);
    }
    equal.diff = 0n;
    equal.targets = [];
  } else if (n > 0n) {
    const base = divide(equalPool, n, d['D-5'].value);
    const diff = equalPool - base * n; // 양수면 +1원씩, 음수면 −1원씩 배정
    const need = Number(diff < 0n ? -diff : diff);
    const d6 = d['D-6'];
    let targets;
    if (d6.value === 'manual') targets = (d6.orgIds ?? []).filter((id) => byId[id]);
    else targets = rows.slice(0, need).map((r) => r.id);
    const step = diff < 0n ? -1n : 1n;
    for (const r of rows) {
      r.equalBase = base;
      say(r, 'equal', 'R-5.1', '균등회비 총액', equal.poolFormula, equalPool);
      say(r, 'equal', 'R-5.1', '기본 균등회비', `${won(equalPool)} ÷ ${n}곳 → ${ROUNDING_MODES[d['D-5'].value]}`, base);
    }
    for (const id of targets) {
      const r = byId[id];
      r.equalAdj += step;
      say(r, 'adjust', 'R-5.1', '균등회비 원 단위 조정', `차액 ${won(diff)}을(를) ${d6.value === 'manual' ? '담당자 지정' : '목록 순서'}에 따라 배정`, step);
    }
    for (const r of rows) {
      r.equalFinal = r.equalBase + r.equalAdj;
      say(r, 'equal', 'R-5.1', '최종 균등회비', `${won(r.equalBase)} ${r.equalAdj >= 0n ? '+' : '−'} ${won(r.equalAdj < 0n ? -r.equalAdj : r.equalAdj)}`, r.equalFinal);
    }
    equal.base = base;
    equal.diff = diff;
    equal.targets = targets;
    if (BigInt(targets.length) !== BigInt(need)) {
      issues.push({ level: 'error', rule: 'R-5.1', message: `균등회비 차액 ${won(diff)}을(를) 배정할 기관 수(${targets.length}곳)가 차액(${need}원)과 다릅니다. D-6에서 ${need}곳을 지정하세요.` });
    }
  }

  // ── R-6 기관별 실적회비 ─────────────────────────────────────────────
  const recognizedIds = input.recognized.filter((id) => input.items.some((i) => i.id === id));
  const recognizedNames = recognizedIds.map((id) => input.items.find((i) => i.id === id).name);
  for (const r of rows) {
    r.recognized = recognizedIds.reduce((s, id) => s + BigInt(r.counts[id] ?? 0), 0n);
    say(r, 'perf', 'R-6.2', '인정 실적', recognizedIds.map((id) => `${input.items.find((i) => i.id === id).name} ${count(r.counts[id] ?? 0)}`).join(' + ') || '(인정 항목 없음)', r.recognized);
  }
  const totalRecognized = rows.reduce((s, r) => s + r.recognized, 0n);
  perf.totalRecognized = totalRecognized;
  perf.recognizedNames = recognizedNames;
  if (recognizedIds.length === 0) issues.push({ level: 'error', rule: 'R-6.2', message: '실적 인정 항목을 하나 이상 선택하세요.' });
  if (totalRecognized === 0n) {
    // R-6.4 전체 인정 실적 0 → 배분하지 않고 오류
    issues.push({ level: 'error', rule: 'R-6.4', message: '전체 기관의 인정 실적 합계가 0건이라 실적회비를 배분할 수 없습니다.' });
  } else {
    for (const r of rows) {
      r.perfExactNum = perfPool * r.recognized; // 분모 totalRecognized
      r.perfFloor = divide(r.perfExactNum, totalRecognized, 'floor');
      r.perfFraction = remainder(r.perfExactNum, totalRecognized);
      r.share = ratioPercent(r.recognized, totalRecognized);
      say(r, 'perf', 'R-6.1', '실적 점유율', `${count(r.recognized)} ÷ ${count(totalRecognized)}`, r.share);
      say(r, 'perf', 'R-6.1', '원 단위 처리 전 실적회비', `${won(perfPool)} × (${r.recognized.toLocaleString('ko-KR')} ÷ ${totalRecognized.toLocaleString('ko-KR')})`, decimal(r.perfExactNum, totalRecognized, 4) + '원');
      say(r, 'perf', 'R-6.5', '원 미만 버림', `버린 소수점 ${decimal(r.perfFraction, totalRecognized, 4)}원`, r.perfFloor);
    }
    // R-6.5 남은 원을 1원씩 배정 (D-8)
    const leftover = perfPool - rows.reduce((s, r) => s + r.perfFloor, 0n);
    const need = Number(leftover);
    const d8 = d['D-8'];
    let order;
    if (d8.value === 'manual') order = (d8.orgIds ?? []).filter((id) => byId[id]).map((id) => byId[id]);
    else if (d8.value === 'order') order = rows.slice(0, need);
    else {
      const key = d8.value === 'largestPerf' ? (r) => r.recognized : (r) => r.perfFraction;
      order = [...rows].sort((x, y) => (key(y) > key(x) ? 1 : key(y) < key(x) ? -1 : rows.indexOf(x) - rows.indexOf(y))).slice(0, need);
    }
    perf.leftover = leftover;
    perf.leftoverTargets = order.map((r) => r.id);
    for (const r of order) {
      r.perfRemainderAdj += 1n;
      say(r, 'adjust', 'R-6.5', '실적회비 원 단위 잔액 배정', d8.value === 'largestFraction' ? `버린 소수점(${decimal(r.perfFraction, totalRecognized, 4)})이 큰 순서` : d8.value === 'largestPerf' ? '인정 실적이 많은 순서' : d8.value === 'order' ? '목록 순서' : '담당자 지정', 1n);
    }
    if (BigInt(order.length) !== leftover) {
      issues.push({ level: 'error', rule: 'R-6.5', message: `실적회비 잔액 ${won(leftover)}을(를) 배정할 기관 수(${order.length}곳)가 잔액과 다릅니다. D-8을 확인하세요.` });
    }
  }

  // ── R-7 우체국 특수 처리 ────────────────────────────────────────────
  const po = { enabled: false };
  const poRow = input.postOffice?.enabled ? byId[input.postOffice.orgId] : null;
  if (input.postOffice?.enabled && !poRow) issues.push({ level: 'warn', rule: 'R-7.1', message: '우체국 특수 처리가 켜져 있지만 우체국 기관이 지정되지 않았습니다.' });
  if (poRow && totalRecognized > 0n) {
    const before = poRow.equalFinal + poRow.perfFloor + poRow.perfRemainderAdj;
    const direction = d['D-9'].value;
    const after = toUnit(before, 10n, direction === 'down' ? 'floor' : 'ceil');
    const delta = after - before;
    const d10 = d['D-10'];
    let counterpart = null;
    if (delta !== 0n) {
      if (d10.value === 'manual') counterpart = byId[d10.orgId] ?? null;
      else counterpart = rows.filter((r) => r !== poRow).reduce((best, r) => (!best || r.perfFloor + r.perfRemainderAdj > best.perfFloor + best.perfRemainderAdj ? r : best), null);
      if (counterpart === poRow) counterpart = null;
      if (!counterpart) issues.push({ level: 'error', rule: 'R-7.4', message: `우체국 차액 ${won(delta)}을(를) 반대로 반영할 기관이 없습니다. D-10을 확인하세요.` });
      else {
        poRow.perfPoAdj += delta; // R-7.3 실적회비에서 조정
        counterpart.perfPoAdj -= delta; // R-7.4 반대 조정
        say(poRow, 'adjust', 'R-7.3', `우체국 10원 단위 ${direction === 'down' ? '내림' : '올림'}`, `${won(before)} → ${won(after)} (실적회비에서 조정)`, delta);
        say(counterpart, 'adjust', 'R-7.4', '우체국 보정 반대 조정', `우체국 회비 ${delta > 0n ? '올림' : '내림'} 차액 ${won(delta)}을(를) 실적회비에서 반대로 반영 (${d10.value === 'manual' ? '담당자 지정' : '실적회비가 가장 큰 기관'})`, -delta);
      }
    }
    Object.assign(po, { enabled: true, orgId: poRow.id, name: poRow.name, direction, before, after, delta, counterpartId: counterpart?.id ?? null, counterpartName: counterpart?.name ?? null });
  }

  // ── 최종 금액 ───────────────────────────────────────────────────────
  for (const r of rows) {
    r.perfFinal = r.perfFloor + r.perfRemainderAdj + r.perfPoAdj;
    r.adjust = r.equalAdj + r.perfRemainderAdj + r.perfPoAdj;
    r.final = r.equalFinal + r.perfFinal;
    say(r, 'perf', 'R-6.5', '최종 실적회비', `${won(r.perfFloor)} + 잔액 ${won(r.perfRemainderAdj)}${r.perfPoAdj !== 0n ? ` + 우체국 보정 ${won(r.perfPoAdj)}` : ''}`, r.perfFinal);
    if (r.perfFinal < 0n) issues.push({ level: 'error', rule: 'R-7.4', message: `${r.name}의 실적회비가 음수(${won(r.perfFinal)})가 됩니다.` });
    if (!r.hasData && totalRecognized > 0n) say(r, 'perf', 'D-11', '실적 데이터 없음', '실적 0건으로 보고 균등회비만 부과', 0n);
  }

  return { T, rows, equal, perf, po, issues, recognizedIds };
}
