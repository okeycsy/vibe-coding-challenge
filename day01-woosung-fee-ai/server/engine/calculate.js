// 학습된 분담기준(규칙)으로 분기 회비를 산출한다. 계산은 전부 결정적 코드로 하고 AI는 관여하지 않는다.
import { allocate, toScaled, WEIGHT_SCALE } from './allocate.js';
import { basisMonths } from './period.js';
import { describeBasis, validateRule } from './rules.js';

/**
 * @param {object} p
 * @param {object} p.rule       분담기준 규칙
 * @param {Array}  p.records    [{ institution, month:'YYYY-MM', item, count }]
 * @param {number} p.year
 * @param {number} p.quarter
 * @param {number|string} p.totalFee  분기 총회비(원, 정수)
 */
export function calculateFees({ rule: rawRule, records, year, quarter, totalFee }) {
  const { rule, errors } = validateRule(rawRule);
  if (errors.length) throw new Error(`분담기준이 올바르지 않습니다: ${errors.join(' ')}`);

  const total = parseAmount(totalFee);
  const months = basisMonths(year, quarter, rule.basis);
  const monthSet = new Set(months);
  const warnings = [];

  // 반영 항목과 가중치. 규칙에 항목이 없으면 데이터의 모든 항목을 가중치 1로 본다.
  const dataItems = [...new Set(records.map((r) => r.item))];
  const weights = new Map(rule.items.length ? rule.items.map((i) => [i.name, i.weight]) : dataItems.map((n) => [n, 1]));
  if (rule.items.length) {
    const missing = rule.items.filter((i) => !dataItems.includes(i.name)).map((i) => i.name);
    const ignored = dataItems.filter((n) => !weights.has(n));
    if (missing.length) warnings.push(`실적 파일에 없는 항목은 0건으로 봤습니다: ${missing.join(', ')}`);
    if (ignored.length) warnings.push(`분담기준에 없는 항목은 산정에서 뺐습니다: ${ignored.join(', ')}`);
  }

  const inst = new Map();
  const outOfPeriod = new Set();
  for (const r of records) {
    if (!monthSet.has(r.month)) { outOfPeriod.add(r.month); continue; }
    const count = Number(r.count);
    if (!Number.isFinite(count) || count < 0) throw new Error(`${r.institution} ${r.month} ${r.item} 건수가 올바르지 않습니다: ${r.count}`);
    if (!inst.has(r.institution)) inst.set(r.institution, { monthly: Object.fromEntries(months.map((m) => [m, 0])), metric: 0n });
    const row = inst.get(r.institution);
    const w = weights.get(r.item);
    if (w === undefined) continue;
    if (w > 0) row.monthly[r.month] += count;
    row.metric += BigInt(Math.round(count)) * toScaled(w);
  }
  const basisText = `${describeBasis(rule.basis)}(${months[0]}~${months.at(-1)})`;
  if (outOfPeriod.size) warnings.push(`실적 기준 기간 밖의 실적(${[...outOfPeriod].sort().join(', ')})은 제외했습니다. 기준: ${basisText}`);
  if (!inst.size) throw new Error(`실적 기준 기간(${basisText})에 해당하는 실적이 없습니다. 기간과 파일을 확인하세요.`);
  const seenMonths = new Set(records.map((r) => r.month));
  const missingMonths = months.filter((m) => !seenMonths.has(m));
  if (missingMonths.length) warnings.push(`실적 파일에 ${missingMonths.join(', ')} 실적이 없어 0건으로 봤습니다.`);

  const names = [...inst.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  const unit = BigInt(rule.rounding.unit);

  // 1) 총회비를 구성요소별로
  const compAmounts = allocate(total, rule.components.map((c, i) => ({ key: i, weight: toScaled(c.ratio) })));

  // 2) 구성요소별로 기관에 안분
  const perComp = rule.components.map((c, i) => {
    const amount = compAmounts.get(i);
    let entries = names.map((n) => ({ key: n, weight: componentWeight(c, inst.get(n).metric) }));
    if (entries.every((e) => e.weight === 0n)) {
      warnings.push(`'${c.name}'의 반영실적이 모두 0이라 균등 분담했습니다.`);
      entries = names.map((n) => ({ key: n, weight: 1n }));
    }
    return { name: c.name, method: c.method, amount, shares: allocate(amount, entries, unit) };
  });

  const rows = names.map((n) => {
    const { monthly, metric } = inst.get(n);
    const components = perComp.map((pc) => pc.shares.get(n));
    const fee = components.reduce((s, v) => s + v, 0n);
    return {
      institution: n,
      monthly: months.map((m) => monthly[m]),
      totalCount: months.reduce((s, m) => s + monthly[m], 0),
      metric: Number(metric) / WEIGHT_SCALE,
      components: components.map(Number),
      fee: Number(fee),
      share: total === 0n ? 0 : Number((fee * 1000000n) / total) / 10000, // %
    };
  });

  const sum = rows.reduce((s, r) => s + BigInt(r.fee), 0n);
  if (sum !== total) throw new Error(`내부 오류: 산출 합계(${sum})가 총회비(${total})와 다릅니다.`);

  return {
    period: { year: Number(year), quarter: Number(quarter), months, basis: rule.basis, basisText },
    totalFee: Number(total),
    components: perComp.map((pc) => ({ name: pc.name, method: pc.method, amount: Number(pc.amount) })),
    rows,
    totals: {
      monthly: months.map((_, i) => rows.reduce((s, r) => s + r.monthly[i], 0)),
      totalCount: rows.reduce((s, r) => s + r.totalCount, 0),
      metric: rows.reduce((s, r) => s + r.metric, 0),
      components: perComp.map((pc) => Number(pc.amount)),
      fee: Number(sum),
    },
    warnings,
  };
}

function componentWeight(c, metric) {
  if (c.method === 'equal') return 1n;
  if (c.method === 'proportional') return metric;
  // tiered: 반영실적이 min 이상인 구간 중 가장 높은 구간
  const count = Number(metric) / WEIGHT_SCALE;
  let w = 0;
  for (const t of c.tiers) if (count >= t.min) w = t.weight;
  return toScaled(w);
}

export function parseAmount(v) {
  const s = String(v ?? '').replace(/[,\s원]/g, '');
  if (!/^\d+$/.test(s)) throw new Error('총회비는 0 이상의 정수(원)로 입력하세요.');
  return BigInt(s);
}
