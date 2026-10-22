// 분기 청구 대상 총액 → 기관별 균등회비·실적회비 (요구사항 4·5·6·8·9장)
//
// 계산 순서(12-8): 균등·실적 총액 → 기관별 균등회비 → 기관별 실적회비 → 원 단위 잔액 처리 → 우체국 특수 처리 → 검증
// 각 단계의 값은 그대로 기관별 산출 근거(trace)에 기록한다. 화면의 설명은 이 trace만 보여 주므로 계산과 어긋나지 않는다.
import { divRound, fraction, percent, toNumber, won, num, signedWon, ROUNDING, bpToPercent } from './money.js';

export const EQUAL_METHODS = {
  A: '방식 A: 균등회비 총액의 정확성 우선',
  B: '방식 B: 기관별 균등회비 금액의 동일성 우선',
};
export const REMAINDER_MODES = {
  largestRemainder: '버린 소수점이 큰 기관부터 1원씩',
  largestPerf: '인정 실적이 많은 기관부터 1원씩',
  manual: '담당자가 고른 기관에 1원씩',
};

export function computeFees(input) {
  const {
    total,
    orgs,
    items,
    recognizedItemIds,
    perf,
    equalRateBp,
    perfRateBp,
    equal,
    perfRemainder,
    postOffice,
  } = input;
  const issues = [];
  const T = BigInt(total);
  const n = orgs.length;
  const nB = BigInt(n);
  const bp = BigInt(equalRateBp);
  const itemName = Object.fromEntries(items.map((i) => [i.id, i.name]));
  const recognized = recognizedItemIds.filter((id) => itemName[id]);

  const rows = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    counts: Object.fromEntries(items.map((i) => [i.id, perf[o.id]?.[i.id] ?? 0])),
    hasData: Boolean(perf[o.id]),
    recognized: 0,
    equalBase: 0n,
    equalAdj: 0n,
    perfFloor: 0n,
    perfRemainderAdj: 0n,
    perfPostOfficeAdj: 0n,
    trace: { equal: [], perf: [], adjust: [] },
  }));
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  if (n === 0) issues.push({ level: 'error', message: '회비를 분담할 참가기관이 없습니다.' });
  if (T < 0n) issues.push({ level: 'error', message: '분기 청구 대상 총액이 음수입니다.' });
  if (equalRateBp + perfRateBp !== 10000) {
    issues.push({ level: 'error', message: `균등회비 비율 ${bpToPercent(equalRateBp)}%와 실적회비 비율 ${bpToPercent(perfRateBp)}%의 합이 100%가 아닙니다.` });
  }
  if (recognized.length === 0) issues.push({ level: 'error', message: '실적 인정 항목을 하나 이상 선택해 주세요.' });

  // ── 1. 균등회비 총액과 실적회비 총액 ─────────────────────────────
  let equalPool = 0n;
  let perfPool = 0n;
  let unit = 0n;
  const equalInfo = { method: equal.method, ratePercent: bpToPercent(equalRateBp) };
  const totalLine = { label: '해당 분기 전체 회비', value: won(T) };
  const rateLine = { label: '균등회비 적용 비율', value: `${bpToPercent(equalRateBp)}%` };
  const countLine = { label: '균등회비 배분 대상 기관 수', value: `${n}개` };

  if (n > 0 && equal.method === 'A') {
    equalPool = divRound(T * bp, 10000n, equal.poolRounding);
    perfPool = T - equalPool;
    unit = divRound(equalPool, nB, equal.unitRounding);
    const diff = equalPool - unit * nB; // 1원씩 더하거나(+) 빼야(−) 하는 금액
    const k = Number(diff < 0n ? -diff : diff);
    const step = diff < 0n ? -1n : 1n;
    let targets = [];
    if (k > 0) {
      if (equal.targetMode === 'manual') {
        targets = (equal.targetOrgIds || []).filter((id) => byId[id]).slice(0, k);
        if (targets.length < k) {
          issues.push({
            level: 'warn',
            message: `균등회비 차액 ${won(diff)}을 맞추려면 ${k}개 기관을 골라야 하는데 ${targets.length}개만 골랐습니다.`,
          });
        }
      } else {
        targets = rows.slice(0, k).map((r) => r.id);
      }
    }
    for (const r of rows) {
      r.equalBase = unit;
      r.trace.equal.push(
        totalLine,
        rateLine,
        {
          label: '균등회비 총액',
          value: won(equalPool),
          formula: `${won(T)} × ${bpToPercent(equalRateBp)}% = ${fraction(T * bp, 10000n, 2)}원${(T * bp) % 10000n ? ` → ${ROUNDING[equal.poolRounding]} ${won(equalPool)}` : ''}`,
        },
        countLine,
        {
          label: '기관별 균등회비 기본 산출금액',
          value: won(unit),
          formula: `${won(equalPool)} ÷ ${n} = ${fraction(equalPool, nB, 4)}원${equalPool % nB ? ` → ${ROUNDING[equal.unitRounding]} ${won(unit)}` : ''}`,
        },
      );
    }
    for (const id of targets) {
      byId[id].equalAdj = step;
    }
    for (const r of rows) {
      r.trace.equal.push({
        label: '원 단위 조정',
        value: r.equalAdj ? signedWon(r.equalAdj) : '없음',
        formula: diff
          ? `균등회비 총액 − 기본금액 × 기관 수 = ${won(equalPool)} − ${won(unit)} × ${n} = ${won(diff)} → ${k}개 기관에 ${signedWon(step)}씩${r.equalAdj ? ' (이 기관 포함)' : ''}`
          : '나누어떨어져 조정 없음',
      });
      if (r.equalAdj) {
        r.trace.adjust.push({
          kind: '균등회비',
          amount: toNumber(r.equalAdj),
          reason: `균등회비 총액 ${won(equalPool)}을 정확히 맞추기 위한 원 단위 조정 (${equal.targetMode === 'manual' ? '담당자 지정' : '목록 순서 자동 지정'})`,
        });
      }
    }
    Object.assign(equalInfo, { pool: toNumber(equalPool), unit: toNumber(unit), diff: toNumber(diff), targets });
  } else if (n > 0 && equal.method === 'B') {
    const step = BigInt(equal.bUnit || 1);
    unit = equal.bMode === 'manual'
      ? BigInt(equal.bAmount || 0)
      : divRound(T * bp, 10000n * nB * step, equal.bRounding) * step;
    equalPool = unit * nB;
    perfPool = T - equalPool;
    const targetPool = T * bp; // ÷ 10000
    Object.assign(equalInfo, {
      pool: toNumber(equalPool),
      unit: toNumber(unit),
      actualPercent: percent(equalPool, T || 1n, 4),
      setPercent: `${bpToPercent(equalRateBp)}%`,
      gapPercent: T ? `${fraction(equalPool * 1000000n - targetPool * 100n, T * 10000n, 4)}%p` : '-',
    });
    for (const r of rows) {
      r.equalBase = unit;
      r.trace.equal.push(
        totalLine,
        rateLine,
        countLine,
        equal.bMode === 'manual'
          ? { label: '기관별 균등회비 (담당자 지정)', value: won(unit) }
          : {
            label: '기관별 균등회비 기본 산출금액',
            value: won(unit),
            formula: `${won(T)} × ${bpToPercent(equalRateBp)}% ÷ ${n} = ${fraction(T * bp, 10000n * nB, 4)}원 → ${num(step)}원 단위 ${ROUNDING[equal.bRounding]} ${won(unit)}`,
          },
        {
          label: '균등회비 총액 (모든 기관 동일 금액)',
          value: won(equalPool),
          formula: `${won(unit)} × ${n} = ${won(equalPool)} → 실제 비율 ${equalInfo.actualPercent} (설정 ${bpToPercent(equalRateBp)}%, 차이 ${equalInfo.gapPercent})`,
        },
      );
    }
  }
  if (perfPool < 0n) issues.push({ level: 'error', message: `균등회비 총액이 분기 총액보다 커서 실적회비 총액이 음수(${won(perfPool)})입니다.` });

  // ── 2. 실적회비: 인정 실적 비율로 배분 ───────────────────────────
  for (const r of rows) {
    r.recognized = recognized.reduce((a, id) => a + (r.counts[id] || 0), 0);
  }
  const W = BigInt(rows.reduce((a, r) => a + r.recognized, 0));
  const recognizedNames = recognized.map((id) => itemName[id]).join(' + ');
  let R = 0n;
  const remainders = {};
  if (W === 0n && n > 0) {
    issues.push({ level: 'error', message: '전체 기관의 인정 실적 합계가 0건이라 실적회비를 배분할 수 없습니다.' });
  } else if (n > 0) {
    for (const r of rows) {
      const w = BigInt(r.recognized);
      r.perfFloor = perfPool >= 0n ? (perfPool * w) / W : 0n;
      remainders[r.id] = perfPool >= 0n ? (perfPool * w) % W : 0n;
    }
    R = perfPool - rows.reduce((a, r) => a + r.perfFloor, 0n);
    // 남은 원(R)을 1원씩 배정할 순서
    let order;
    if (perfRemainder.mode === 'manual') {
      order = (perfRemainder.orgIds || []).filter((id) => byId[id]);
      if (R > 0n && order.length === 0) {
        issues.push({ level: 'warn', message: `실적회비 원 단위 잔액 ${won(R)}을 받을 기관을 골라 주세요.` });
      }
    } else if (perfRemainder.mode === 'largestPerf') {
      order = rows.map((r, i) => ({ id: r.id, i, w: r.recognized })).sort((a, b) => b.w - a.w || a.i - b.i).map((x) => x.id);
    } else {
      order = rows
        .map((r, i) => ({ id: r.id, i, rem: remainders[r.id] }))
        .sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i))
        .map((x) => x.id);
    }
    for (let left = R, k = 0; left > 0n && order.length; left -= 1n, k = (k + 1) % order.length) {
      byId[order[k]].perfRemainderAdj += 1n;
    }
  }
  for (const r of rows) {
    const w = BigInt(r.recognized);
    const countLines = items.map((i) => ({
      label: `${i.name}${recognized.includes(i.id) ? '' : ' (인정 안 함)'}`,
      value: `${num(r.counts[i.id] || 0)}건`,
    }));
    r.trace.perf.push(
      { label: '전체 실적회비 총액', value: won(perfPool), formula: `분기 전체 회비 ${won(T)} − 균등회비 총액 ${won(equalPool)}` },
      ...countLines,
      { label: '인정 실적', value: `${num(r.recognized)}건`, formula: recognized.length ? `${recognizedNames}` : '인정 항목 없음' },
      { label: '전체 기관의 인정 실적 합계', value: `${num(W)}건` },
      { label: '실적 점유율', value: W ? percent(w, W, 4) : '-', formula: W ? `${num(w)} ÷ ${num(W)}` : '' },
      {
        label: '원 단위 처리 전 실적회비',
        value: W ? `${fraction(perfPool * w, W, 4)}원` : '-',
        formula: W ? `${won(perfPool)} × (${num(w)} ÷ ${num(W)})` : '',
      },
      { label: '원 단위 처리 후 실적회비 (원 미만 버림)', value: won(r.perfFloor) },
      {
        label: '원 단위 잔액 배정',
        value: r.perfRemainderAdj ? signedWon(r.perfRemainderAdj) : '없음',
        formula: R ? `버린 원 미만 합계 ${won(R)}을 ${REMAINDER_MODES[perfRemainder.mode]} 배정` : '잔액 없음',
      },
    );
    if (r.perfRemainderAdj) {
      r.trace.adjust.push({ kind: '실적회비', amount: toNumber(r.perfRemainderAdj), reason: `실적회비 원 단위 잔액 배정 (${REMAINDER_MODES[perfRemainder.mode]})` });
    }
  }

  // ── 3. 우체국 특수 처리: 최종 회비 10원 단위, 차액은 지정 기관 실적회비에서 반대로 ──
  const sumFinal = () => rows.reduce((a, r) => a + r.equalBase + r.equalAdj + r.perfFloor + r.perfRemainderAdj + r.perfPostOfficeAdj, 0n);
  const totalBeforePO = sumFinal();
  const po = { enabled: Boolean(postOffice?.enabled), applied: false };
  if (po.enabled) {
    const p = byId[postOffice.orgId];
    if (!p) {
      issues.push({ level: 'warn', message: '우체국 특수 처리가 켜져 있지만 대상 기관(우체국)이 분담 대상에 없습니다.' });
    } else {
      const before = p.equalBase + p.equalAdj + p.perfFloor + p.perfRemainderAdj;
      const mod = ((before % 10n) + 10n) % 10n;
      const delta = mod === 0n ? 0n : postOffice.direction === 'down' ? -mod : 10n - mod;
      let cp = null;
      if (postOffice.counterpartMode === 'manual') {
        cp = byId[postOffice.counterpartOrgId] && postOffice.counterpartOrgId !== p.id ? byId[postOffice.counterpartOrgId] : null;
      } else {
        // 자동: 우체국을 뺀 기관 중 실적회비가 가장 큰 기관 (같으면 목록 순서)
        cp = rows
          .map((r, i) => ({ r, i, v: Number(r.perfFloor + r.perfRemainderAdj) }))
          .filter((x) => x.r.id !== p.id)
          .sort((a, b) => b.v - a.v || a.i - b.i)[0]?.r ?? null;
      }
      Object.assign(po, {
        orgId: p.id,
        orgName: p.name,
        direction: postOffice.direction,
        before: toNumber(before),
        delta: toNumber(delta),
        after: toNumber(before + delta),
        counterpartId: cp?.id ?? null,
        counterpartName: cp?.name ?? null,
        counterpartMode: postOffice.counterpartMode,
      });
      if (delta !== 0n && !cp) {
        issues.push({ level: 'warn', message: `우체국 보정 차액 ${won(delta)}을 반영할 다른 기관을 골라 주세요.` });
      } else if (delta !== 0n) {
        const cpPerf = cp.perfFloor + cp.perfRemainderAdj;
        if (cpPerf - delta < 0n) {
          issues.push({ level: 'error', message: `${cp.name}의 실적회비(${won(cpPerf)})로는 우체국 보정 차액 ${won(delta)}을 감당할 수 없습니다.` });
        } else {
          p.perfPostOfficeAdj = delta;
          cp.perfPostOfficeAdj = -delta;
          po.applied = true;
          const dirText = postOffice.direction === 'down' ? '내림' : '올림';
          p.trace.adjust.push({
            kind: '실적회비',
            amount: toNumber(delta),
            reason: `우체국 청구금액 10원 단위 ${dirText}: ${won(before)} → ${won(before + delta)}. 차액은 ${cp.name} 실적회비에서 반대로 조정`,
            target: cp.name,
          });
          cp.trace.adjust.push({
            kind: '실적회비',
            amount: toNumber(-delta),
            reason: `우체국 회비를 10원 단위로 ${dirText}(${signedWon(delta)})하면서 생긴 차액을 이 기관 실적회비에서 반대로 조정해 전체 합계를 유지`,
            target: p.name,
          });
        }
      }
    }
  }

  // ── 4. 최종 금액과 산출 근거 마무리 ─────────────────────────────
  const out = rows.map((r) => {
    const equalFinal = r.equalBase + r.equalAdj;
    const perfFinal = r.perfFloor + r.perfRemainderAdj + r.perfPostOfficeAdj;
    const final = equalFinal + perfFinal;
    const adjustment = r.equalAdj + r.perfRemainderAdj + r.perfPostOfficeAdj;
    if (final < 0n) issues.push({ level: 'error', message: `${r.name}의 최종 회비가 음수(${won(final)})입니다.` });
    if (r.perfPostOfficeAdj) {
      r.trace.perf.push({
        label: '우체국 특수 처리 조정',
        value: signedWon(r.perfPostOfficeAdj),
      });
    }
    const parts = [`원 미만 버림 ${won(r.perfFloor)}`];
    if (r.perfRemainderAdj) parts.push(`잔액 배정 ${signedWon(r.perfRemainderAdj)}`);
    if (r.perfPostOfficeAdj) parts.push(`우체국 보정 ${signedWon(r.perfPostOfficeAdj)}`);
    r.trace.perf.push({ label: '최종 실적회비', value: won(perfFinal), formula: parts.length > 1 ? parts.join(' / ') : '' });
    r.trace.equal.push({ label: '최종 균등회비', value: won(equalFinal) });
    return {
      id: r.id,
      name: r.name,
      counts: r.counts,
      hasData: r.hasData,
      recognized: r.recognized,
      sharePercent: W ? percent(BigInt(r.recognized), W, 4) : '-',
      shareExact: W ? `${fraction(perfPool * BigInt(r.recognized), W, 4)}` : '-',
      equalBase: toNumber(r.equalBase),
      equalAdj: toNumber(r.equalAdj),
      equalFinal: toNumber(equalFinal),
      perfFloor: toNumber(r.perfFloor),
      perfRemainderAdj: toNumber(r.perfRemainderAdj),
      perfPostOfficeAdj: toNumber(r.perfPostOfficeAdj),
      perfFinal: toNumber(perfFinal),
      adjustment: toNumber(adjustment),
      final: toNumber(final),
      trace: r.trace,
    };
  });

  const equalSum = out.reduce((a, r) => a + r.equalFinal, 0);
  const perfSum = out.reduce((a, r) => a + r.perfFinal, 0);
  const finalSum = out.reduce((a, r) => a + r.final, 0);
  const totalN = toNumber(T);

  // ── 5. 검증 (8장) ───────────────────────────────────────────────
  const checks = [];
  const problems = issues.filter((i) => i.level !== 'info').map((i) => i.message).join(' ');
  const check = (id, label, expected, actual, cause, targets) => {
    checks.push({ id, label, expected, actual, diff: actual - expected, status: expected === actual ? 'ok' : 'fail', cause: expected === actual ? '' : cause, targets: targets || '' });
  };
  check('sumParts', '기관별 균등회비 합계 + 실적회비 합계 = 분기 청구 대상 총액', totalN, equalSum + perfSum,
    problems || '원 단위 차액이 배정되지 않았습니다.');
  check('sumFinal', '전체 기관 회비 합계 = 분기 청구 대상 총액', totalN, finalSum,
    problems || '원 단위 차액이 배정되지 않았습니다.');
  if (equal.method === 'A') {
    check('equalPool', '균등회비 방식 A: 기관별 균등회비 합계 = 설정된 균등회비 총액', toNumber(equalPool), equalSum,
      '균등회비 원 단위 차액을 받을 기관이 부족합니다.', (equalInfo.targets || []).map((id) => byId[id]?.name).join(', '));
  } else {
    checks.push({
      id: 'equalSame', label: '균등회비 방식 B: 모든 기관의 균등회비가 같음', expected: toNumber(unit), actual: toNumber(unit),
      diff: 0, status: out.every((r) => r.equalFinal === toNumber(unit)) ? 'ok' : 'fail', cause: '', targets: '',
    });
  }
  if (po.enabled) {
    check('poTotal', '우체국 보정 전후 전체 회비 합계 유지', toNumber(totalBeforePO), finalSum, '우체국 보정 차액이 다른 기관에 반영되지 않았습니다.', po.counterpartName || '');
    const poRow = out.find((r) => r.id === po.orgId);
    if (poRow) {
      checks.push({
        id: 'poUnit', label: '우체국 최종 회비 1원 자리 = 0', expected: 0, actual: poRow.final % 10, diff: poRow.final % 10,
        status: poRow.final % 10 === 0 ? 'ok' : 'warn', cause: poRow.final % 10 ? '보정 대상 기관을 정하지 않아 10원 단위로 맞추지 못했습니다.' : '', targets: po.counterpartName || '',
      });
    }
  }
  checks.push({
    id: 'rate', label: '균등회비 비율 + 실적회비 비율 = 100%', expected: 10000, actual: equalRateBp + perfRateBp, diff: equalRateBp + perfRateBp - 10000,
    status: equalRateBp + perfRateBp === 10000 ? 'ok' : 'fail', cause: equalRateBp + perfRateBp === 10000 ? '' : '비율을 다시 입력해 주세요.', targets: '', unit: 'bp',
  });
  const negatives = out.filter((r) => r.final < 0 || r.perfFinal < 0);
  checks.push({
    id: 'negative', label: '음수 회비 없음', expected: 0, actual: negatives.length, diff: negatives.length,
    status: negatives.length ? 'fail' : 'ok', cause: negatives.length ? '음수 금액이 있습니다.' : '', targets: negatives.map((r) => r.name).join(', '), unit: 'count',
  });
  const noData = out.filter((r) => !r.hasData);
  checks.push({
    id: 'missingData', label: '모든 분담 기관에 실적 데이터 있음', expected: out.length, actual: out.length - noData.length, diff: -noData.length,
    status: noData.length ? 'warn' : 'ok', cause: noData.length ? '실적 데이터가 없는 기관은 0건으로 계산했습니다.' : '', targets: noData.map((r) => r.name).join(', '), unit: 'count',
  });

  return {
    total: totalN,
    orgCount: n,
    equal: { ...equalInfo, pool: toNumber(equalPool), unit: toNumber(unit) },
    perf: { pool: toNumber(perfPool), totalRecognized: toNumber(W), remainder: toNumber(R), recognizedItemIds: recognized, recognizedNames },
    postOffice: po,
    rows: out,
    totals: { equal: equalSum, perf: perfSum, adjustment: out.reduce((a, r) => a + r.adjustment, 0), final: finalSum },
    checks,
    issues,
  };
}
