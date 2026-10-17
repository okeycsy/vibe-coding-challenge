// 회비 분담기준 '학습': 관리자가 입력한 기준 문장을 산출 규칙(JSON)으로 바꾼다.
// ANTHROPIC_API_KEY가 있으면 Claude가 해석하고, 없으면 정형화된 문장만 읽는 규칙 기반 해석기로 대신한다.
// 어느 쪽이든 결과는 validateRule을 통과해야 하고, 관리자가 확인한 뒤에야 저장된다.
import Anthropic from '@anthropic-ai/sdk';
import { RULE_JSON_SCHEMA, validateRule } from './rules.js';

export const MODEL = process.env.FEE_AI_MODEL || 'claude-opus-5-5';

const SYSTEM = `너는 금융결제원 회비자동산출시스템의 '회비 분담기준 해석기'다.
관리자가 붙여 넣은 업무별 회비 분담기준(규정 문구, 메모, 표 등)을 읽고, 계산 엔진이 실행할 규칙 JSON으로 옮긴다.
계산 엔진의 동작:
- 분기 총회비를 components의 ratio대로 나눈 뒤, 각 구성요소를 참가기관에 안분한다.
- method equal: 참가기관 수로 균등 분담.
- method proportional: 기관별 '반영실적'(= 실적 항목별 건수 × 항목 가중치의 분기 합계)에 비례.
- method tiered: 기관별 분기 반영실적이 tiers의 min 이상인 구간 중 가장 높은 구간의 weight를 가중치로 삼아 비례 배분.
- 금액은 rounding.unit 단위로 절사하고, 남는 금액은 최대잔여법으로 배분해 합계를 총회비와 정확히 맞춘다.
규칙:
- 기준에 적힌 내용만 옮기고, 적혀 있지 않은 숫자를 지어내지 않는다. 불가피한 가정은 notes에 적는다.
- 엔진이 표현할 수 없는 조항(최저회비, 상한, 기관별 감면 등)은 근사하지 말고 notes에 '미반영: …'으로 남긴다.
- 실적 항목명은 기준에 나온 표현을 그대로 쓴다(실적 파일 열 이름과 맞춰야 하므로).
- ratio 합계는 정확히 1이 되게 한다.`;

export async function learnCriteria({ workName, text, hint }) {
  const source = String(text ?? '').trim();
  if (!source) throw new Error('분담기준 내용을 입력하세요.');
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    return learnWithClaude({ workName, text: source, hint });
  }
  const parsed = parseCriteriaText(source);
  parsed.notes.unshift('ANTHROPIC_API_KEY가 없어 규칙 기반 해석기로 읽었습니다. 정형 문장(예: "25% 균등, 75% 건수 비례")만 이해합니다.');
  const { rule, errors } = validateRule(parsed);
  return { engine: 'rule-based', rule, errors };
}

async function learnWithClaude({ workName, text, hint }) {
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: RULE_JSON_SCHEMA },
    },
    messages: [{
      role: 'user',
      content: [
        `업무명: ${workName}`,
        hint ? `참고(실적 파일의 항목 이름): ${hint}` : '',
        '회비 분담기준:',
        '<criteria>',
        text,
        '</criteria>',
      ].filter(Boolean).join('\n'),
    }],
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('AI가 이 기준을 해석하지 않았습니다. 문구를 확인해 주세요.');
  }
  if (response.stop_reason === 'max_tokens') throw new Error('AI 응답이 길이 제한에 걸려 잘렸습니다.');
  const out = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let json;
  try { json = JSON.parse(out); } catch { throw new Error('AI 응답을 규칙으로 읽지 못했습니다.'); }
  const { rule, errors } = validateRule(json);
  return { engine: response.model ?? MODEL, rule, errors };
}

// ── 규칙 기반 해석기 (API 키 없을 때) ──────────────────────────────
// 이해하는 문장 예:
//   "25%는 참가기관 균등 분담, 75%는 건수 비례"
//   "실적 항목: 송금 1, 조회 0.2"
//   "30% 구간별 가중치 - 0건 이상 1, 10,000건 이상 2, 50,000건 이상 3"
//   "10원 미만 절사"
export function parseCriteriaText(text) {
  const rule = { summary: '', items: [], components: [], rounding: { unit: 1 }, notes: [] };
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);

  for (const line of lines) {
    const itemLine = line.match(/^(?:[-*·•]\s*)?(?:실적\s*)?(?:항목|가중치)\s*[:：]\s*(.+)$/);
    if (itemLine) {
      for (const m of itemLine[1].matchAll(/([가-힣A-Za-z][가-힣A-Za-z0-9 ]*?)\s*(?:건수)?\s*[×x*]?\s*(\d+(?:\.\d+)?)/g)) {
        rule.items.push({ name: m[1].trim(), weight: Number(m[2]) });
      }
      continue;
    }
    // 한 줄에 여러 구성요소가 있을 수 있어 '%'를 기준으로 쪼갠다.
    const parts = line.split(/(?<![\d.])(?=\d+(?:\.\d+)?\s*%)/).filter((p) => /%/.test(p));
    for (const p of parts) {
      const pct = Number(p.match(/(\d+(?:\.\d+)?)\s*%/)[1]);
      const method = /구간|등급/.test(p) ? 'tiered'
        : /균등|정액|동일|기본/.test(p) ? 'equal'
          : /비례|안분|실적|건수|이용/.test(p) ? 'proportional' : null;
      if (!method) { rule.notes.push(`해석 못 함: "${p.trim()}"`); continue; }
      const tiers = method === 'tiered'
        ? [...p.matchAll(/([\d,]+)\s*건\s*이상\s*(?:가중치\s*)?[×x*]?\s*(\d+(?:\.\d+)?)/g)].map((m) => ({ min: Number(m[1].replace(/,/g, '')), weight: Number(m[2]) }))
        : [];
      const name = method === 'equal' ? '기본회비' : method === 'proportional' ? '실적회비' : '등급회비';
      rule.components.push({ name, ratio: pct / 100, method, tiers });
    }
    const r = line.match(/(\d+)\s*원\s*(?:미만|단위)/);
    if (r) rule.rounding.unit = Number(r[1]);
  }
  rule.summary = rule.components.map((c) => `${Math.round(c.ratio * 1e6) / 1e4}% ${c.method === 'equal' ? '균등' : c.method === 'proportional' ? '실적비례' : '구간가중'}`).join(' + ');
  return rule;
}
