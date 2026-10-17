// 회비 분담기준 규칙(JSON)의 형태와 검증.
// AI가 학습한 결과든 관리자가 직접 쓴 것이든, 저장·계산 전에 반드시 여기를 거친다.

export const METHODS = {
  equal: '균등 분담',
  proportional: '실적 비례',
  tiered: '구간(등급)별 가중치',
};

export const ROUNDING_UNITS = [1, 10, 100, 1000];

// Claude 구조화 출력(output_config.format)에 그대로 쓰는 JSON 스키마.
export const RULE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'basis', 'items', 'components', 'rounding', 'notes'],
  properties: {
    summary: { type: 'string', description: '기준을 한 문장으로 요약' },
    basis: {
      type: 'object',
      description: '어느 기간의 실적으로 산정하는지. 산출 분기에서 lag분기 전을 끝으로 count개 분기. 산출 분기 실적이면 lag 0, count 1. 직전 분기면 lag 1, count 1.',
      additionalProperties: false,
      required: ['lag', 'count'],
      properties: {
        lag: { type: 'integer', enum: [0, 1, 2, 3, 4] },
        count: { type: 'integer', enum: [1, 2, 3, 4] },
      },
    },
    items: {
      type: 'array',
      description: '회비 산정에 반영할 실적 항목과 가중치. 기준에 항목 구분이 없으면 빈 배열(모든 항목 가중치 1).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'weight'],
        properties: {
          name: { type: 'string', description: '실적 파일의 항목(열) 이름. 예: 압류, 조회' },
          weight: { type: 'number', description: '건당 가중치. 1이면 그대로, 0.5면 절반만 반영' },
        },
      },
    },
    components: {
      type: 'array',
      description: '총회비를 나누는 구성요소. ratio 합계는 1.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'ratio', 'method', 'tiers'],
        properties: {
          name: { type: 'string', description: '예: 기본회비, 실적회비' },
          ratio: { type: 'number', description: '총회비 중 이 구성요소의 비율(0~1)' },
          method: { type: 'string', enum: Object.keys(METHODS) },
          tiers: {
            type: 'array',
            description: 'method가 tiered일 때만 사용. 분기 반영실적이 min 이상인 구간 중 가장 높은 구간의 weight 적용. 그 외 method는 빈 배열.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['min', 'weight'],
              properties: {
                min: { type: 'number' },
                weight: { type: 'number' },
              },
            },
          },
        },
      },
    },
    rounding: {
      type: 'object',
      additionalProperties: false,
      required: ['unit'],
      properties: {
        unit: { type: 'integer', enum: ROUNDING_UNITS, description: '금액 산정 단위(원). 원 미만 절사면 1' },
      },
    },
    notes: {
      type: 'array',
      description: '해석하면서 둔 가정, 기준에서 모호했던 점',
      items: { type: 'string' },
    },
  },
};

const EPS = 1e-9;

// 규칙을 정리해서 돌려준다. 잘못된 곳이 있으면 errors에 담는다.
export function validateRule(input) {
  const errors = [];
  const rule = {
    summary: String(input?.summary ?? '').trim(),
    basis: { lag: Number(input?.basis?.lag ?? 0), count: Number(input?.basis?.count ?? 1) },
    items: [],
    components: [],
    rounding: { unit: Number(input?.rounding?.unit ?? 1) },
    notes: Array.isArray(input?.notes) ? input.notes.map(String) : [],
  };

  const seen = new Set();
  for (const it of input?.items ?? []) {
    const name = String(it?.name ?? '').trim();
    const weight = Number(it?.weight);
    if (!name) { errors.push('실적 항목 이름이 비어 있습니다.'); continue; }
    if (seen.has(name)) { errors.push(`실적 항목 '${name}'이 중복됩니다.`); continue; }
    if (!Number.isFinite(weight) || weight < 0) { errors.push(`실적 항목 '${name}'의 가중치가 올바르지 않습니다.`); continue; }
    seen.add(name);
    rule.items.push({ name, weight });
  }

  let ratioSum = 0;
  for (const c of input?.components ?? []) {
    const name = String(c?.name ?? '').trim() || '회비';
    const ratio = Number(c?.ratio);
    const method = c?.method;
    if (!METHODS[method]) { errors.push(`'${name}'의 산정 방식(${method})을 알 수 없습니다.`); continue; }
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1 + EPS) { errors.push(`'${name}'의 비율이 0 초과 1 이하가 아닙니다.`); continue; }
    let tiers = [];
    if (method === 'tiered') {
      tiers = (c.tiers ?? [])
        .map((t) => ({ min: Number(t?.min), weight: Number(t?.weight) }))
        .filter((t) => Number.isFinite(t.min) && Number.isFinite(t.weight));
      if (!tiers.length) errors.push(`'${name}'은 구간 방식인데 구간이 없습니다.`);
      if (tiers.some((t) => t.weight < 0)) errors.push(`'${name}'의 구간 가중치는 음수일 수 없습니다.`);
      tiers.sort((a, b) => a.min - b.min);
    }
    ratioSum += ratio;
    rule.components.push({ name, ratio, method, tiers });
  }
  if (!rule.components.length) errors.push('구성요소가 하나도 없습니다.');
  else if (Math.abs(ratioSum - 1) > 1e-6) errors.push(`구성요소 비율 합계가 ${round6(ratioSum * 100)}%입니다. 100%여야 합니다.`);

  if (![0, 1, 2, 3, 4].includes(rule.basis.lag) || ![1, 2, 3, 4].includes(rule.basis.count)) {
    errors.push('실적 기준 기간(basis)은 lag 0~4, count 1~4 분기여야 합니다.');
  }
  if (!ROUNDING_UNITS.includes(rule.rounding.unit)) {
    errors.push(`금액 단위는 ${ROUNDING_UNITS.join(', ')}원 중 하나여야 합니다.`);
  }

  return { rule, errors };
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

// 화면·엑셀에 보여줄 사람이 읽는 설명
export function describeRule(rule) {
  const lines = rule.components.map((c) => {
    const pct = `${round6(c.ratio * 100)}%`;
    if (c.method === 'tiered') {
      const t = c.tiers.map((x) => `${x.min.toLocaleString('ko-KR')}건 이상 ×${x.weight}`).join(', ');
      return `${c.name} ${pct}: ${METHODS[c.method]} (${t})`;
    }
    return `${c.name} ${pct}: ${METHODS[c.method]}`;
  });
  const items = rule.items.length
    ? `반영 항목: ${rule.items.map((i) => `${i.name}×${i.weight}`).join(', ')}`
    : '반영 항목: 전체 항목 (가중치 1)';
  lines.push(items);
  lines.push(`실적 기준: ${describeBasis(rule.basis)}`);
  lines.push(rule.rounding.unit === 1 ? '금액: 원 미만 절사 후 잔여액 배분' : `금액: ${rule.rounding.unit}원 단위 절사 후 잔여액 배분`);
  return lines;
}

export function describeBasis({ lag, count } = { lag: 0, count: 1 }) {
  if (lag === 0 && count === 1) return '산출 분기 실적';
  if (lag === 0) return `산출 분기를 포함한 최근 ${count}개 분기 실적`;
  if (count === 1) return lag === 1 ? '직전 분기 실적' : `${lag}분기 전 실적`;
  return `${lag}분기 전까지 ${count}개 분기 실적`;
}
