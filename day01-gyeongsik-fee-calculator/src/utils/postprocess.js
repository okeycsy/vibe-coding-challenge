// "## 4. 최종 정산 특이사항"의 ```postprocess 블록(후처리 스크립트): 문법(파서)·실행기·자연어 → 스크립트 내장 변환기.
// 서버 PostprocessScript / PostprocessEngine / SpecialRuleConverter 와 같은 문법·같은 실행 규칙이라 금액이 1원까지 같다.
// 산출 때 AI 는 쓰지 않는다: 스크립트는 [AI 계산식 빌더]에서 AI(서버) 또는 내장 변환기로 만들어 확정하고, 산출은 그대로 실행만 한다.
//
//   allocate(fee)                                   # 원 단위 배분(최대잔여법). fee 면 균등분담분도 따로 배분
//   roundHalf(equal)  roundHalf(perf)               # 구성요소별 반올림(정수화)
//   roundUp(fee, 10, "우체국", addTo=perf)          # 10원 단위 절상, 늘어난 금액은 실적분담분에
//   roundDown(fee, 10)                              # 10원 미만 절사(전체 기관)
//   fixSum(equal, 25%, over=perfDesc, under=perfAsc) # 합계를 목표에 맞춰 1원씩 보정
//   spreadDiff(perf, others, perfDesc)              # 마지막 spreadDiff 뒤에 생긴 차이분을 나머지 기관에 1원씩 되돌림
//   min(fee, 300000)  max(fee, 100000000, "토스뱅크") # 최저·최고
//   add(perf, -5%, "토스뱅크")  set(fee, 0, "우체국")  # 가감·고정
//   assert sum(equal) == 25%   assert fee("우체국") % 10 == 0   assert all(fee >= 0)   assert sum(fee) == before
//
// 구성요소: equal(균등분담분) · perf(실적분담분) · fee(회비 = equal + perf). 대상: all · first · last · others(직전 대상의 나머지) ·
// "기관명"(기관명·기관 ID·기관코드·별칭). 정렬: perfDesc/perfAsc · countDesc/countAsc · feeDesc/feeAsc · equalDesc/equalAsc · codeAsc.
// 금액은 모두 백만분의 1원(micro) 단위 정수로 다룬다 (회비 합계 9조원 미만까지 정확).
import { lines } from './skill';

export const MICRO = 1_000_000;
export const PREFIX = '특이사항 반영: ';
export const MAX_LINES = 50;
export const MAX_LINE_LENGTH = 200;
export const MAX_UNIT = 100_000_000;
export const MAX_AMOUNT = 1_000_000_000_000;
export const MAX_PCT = 1000;

const COMPONENTS = ['equal', 'perf', 'fee'];
const ORDERS = {
  perfdesc: 'PERF_DESC',
  perfasc: 'PERF_ASC',
  countdesc: 'COUNT_DESC',
  countasc: 'COUNT_ASC',
  feedesc: 'FEE_DESC',
  feeasc: 'FEE_ASC',
  equaldesc: 'EQUAL_DESC',
  equalasc: 'EQUAL_ASC',
  codeasc: 'CODE_ASC',
};
export const ORDER_NAMES = ['perfDesc', 'perfAsc', 'countDesc', 'countAsc', 'feeDesc', 'feeAsc', 'equalDesc', 'equalAsc', 'codeAsc'];
const CALL = /^([A-Za-z_]\w*)\s*\((.*)\)$/;
const ARG = /\s*(?:([A-Za-z_]\w*)\s*=\s*)?("[^"]*"|-?[\d,]+(?:\.\d+)?\s*%?|[A-Za-z_]\w*)\s*(?:,|$)/y;
const ASSERT_SUM = /^sum\(\s*(equal|perf|fee)\s*\)\s*(==|!=|<=|>=|<|>)\s*(before|-?[\d,]+(?:\.\d+)?\s*%?)$/;
const ASSERT_MOD = /^(equal|perf|fee)\(\s*("[^"]*"|first|last)\s*\)\s*%\s*(\d+)\s*==\s*0$/;
const ASSERT_ALL = /^all\(\s*(equal|perf|fee)\s*(==|!=|<=|>=|<|>)\s*(-?[\d,]+(?:\.\d+)?)\s*\)$/;

export class ScriptError extends Error {
  constructor(line, message) {
    super(`후처리 스크립트 ${line}행: ${message}`);
    this.line = line;
    this.script = true;
  }
}
const error = (line, message) => new ScriptError(line, message);

const n0 = (n) => n.toLocaleString('ko-KR');
export const trimPct = (v) => String(v);
const amountLabel = (a) => (a.pct != null ? `${trimPct(a.pct)}%` : `${n0(a.won)}원`);

// ── 파서 (서버 PostprocessScript.parse) ──
class Quoted {
  constructor(text) {
    this.text = text;
  }
}
class Pct {
  constructor(value) {
    this.value = value;
  }
}

function stripComment(row) {
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === '"') quoted = !quoted;
    else if (c === '#' && !quoted) return row.slice(0, i);
  }
  return row;
}

export function parseScript(script) {
  const ops = [];
  if (!script || !script.trim()) return ops;
  const rows = script.replace(/\r\n/g, '\n').split('\n');
  let count = 0;
  rows.forEach((row, i) => {
    const text = stripComment(row).trim();
    if (!text) return;
    if (++count > MAX_LINES) throw error(i + 1, `후처리 스크립트는 ${MAX_LINES}줄 이하로 작성해 주세요.`);
    if (text.length > MAX_LINE_LENGTH) throw error(i + 1, `한 줄은 ${MAX_LINE_LENGTH}자 이하로 작성해 주세요.`);
    ops.push(parseLine(i + 1, text));
  });
  return ops;
}

const base = (line, text, kind) => ({
  line,
  text,
  kind,
  comp: null,
  unit: 1,
  rounding: null,
  selector: { type: 'ALL', names: [] },
  addTo: null,
  amount: null,
  order: null,
  over: null,
  under: null,
  step: 1,
  assertion: null,
});

function parseLine(line, text) {
  if (/^assert[ \t]/.test(text)) {
    return { ...base(line, text, 'ASSERT'), assertion: parseAssert(line, text.slice(6).trim()) };
  }
  const m = text.match(CALL);
  if (!m) throw error(line, `'연산(인자, ...)' 또는 'assert 조건' 형식이어야 합니다: ${text}`);
  const name = m[1];
  const args = parseArgs(line, m[2]);
  const positional = (index, required) => {
    let k = 0;
    for (const a of args) {
      if (a[0] == null) {
        if (k === index) return a[1];
        k++;
      }
    }
    if (required) throw error(line, `${index + 1}번째 인자가 필요합니다.`);
    return null;
  };
  const keyword = (key) => {
    for (const a of args) {
      if (a[0] != null) {
        if (a[0] === key) return a[1];
        if (!['addTo', 'over', 'under', 'step'].includes(a[0])) throw error(line, `알 수 없는 키워드 인자입니다: ${a[0]}`);
      }
    }
    return null;
  };
  const noMore = (from) => {
    if (positional(from, false) != null) throw error(line, '인자가 너무 많습니다.');
  };
  const comp = (v) => {
    if (typeof v === 'string' && COMPONENTS.includes(v)) return v.toUpperCase();
    throw error(line, `구성요소는 equal · perf · fee 중 하나여야 합니다: ${show(v)}`);
  };
  const order = (v) => {
    if (typeof v === 'string' && ORDERS[v.toLowerCase()]) return ORDERS[v.toLowerCase()];
    throw error(line, `정렬은 perfDesc · perfAsc · countDesc · countAsc · feeDesc · feeAsc · equalDesc · equalAsc · codeAsc 중 하나여야 합니다: ${show(v)}`);
  };
  const amount = (v) => {
    if (typeof v === 'number') return { won: v, pct: null };
    if (v instanceof Pct) return { won: 0, pct: v.value };
    throw error(line, `금액(원) 또는 비율(N%)이 필요합니다: ${show(v)}`);
  };
  // index 부터 이어지는 위치 인자를 대상으로 읽는다: all · first · last · others · "기관명"(여러 개). 없으면 all
  const selector = (index) => {
    const first = positional(index, false);
    if (first == null) return { type: 'ALL', names: [] };
    if (first instanceof Quoted) {
      const names = [];
      let k = index;
      let v;
      while ((v = positional(k++, false)) instanceof Quoted) names.push(v.text);
      return { type: 'NAMED', names };
    }
    if (typeof first === 'string') {
      if (first === 'all') return { type: 'ALL', names: [] };
      if (first === 'first') return { type: 'FIRST', names: [] };
      if (first === 'last') return { type: 'LAST', names: [] };
      if (first === 'others') return { type: 'OTHERS', names: [] };
      throw error(line, `대상은 all · first · last · others · "기관명" 중 하나여야 합니다: ${first}`);
    }
    throw error(line, `대상은 all · first · last · others · "기관명" 중 하나여야 합니다: ${show(first)}`);
  };
  const consumed = (sel) => (sel.type === 'NAMED' ? sel.names.length : 1);

  switch (name) {
    case 'allocate': {
      const c = comp(positional(0, true));
      noMore(1);
      return { ...base(line, text, 'ALLOCATE'), comp: c };
    }
    case 'roundUp':
    case 'roundDown':
    case 'roundHalf': {
      const rounding = name === 'roundUp' ? 'UP' : name === 'roundDown' ? 'DOWN' : 'HALF_UP';
      const c = comp(positional(0, true));
      let unit = 1;
      let next = 1;
      const second = positional(1, false);
      if (typeof second === 'number') {
        unit = second;
        if (unit < 1 || unit > MAX_UNIT) throw error(line, `단위는 1원 이상 ${n0(MAX_UNIT)}원 이하여야 합니다.`);
        next = 2;
      }
      const sel = selector(next);
      if (positional(next, false) != null) noMore(next + consumed(sel));
      const addToRaw = keyword('addTo');
      const addTo = addToRaw == null ? null : comp(addToRaw);
      if (addTo != null && c !== 'FEE') throw error(line, 'addTo 는 fee 를 다룰 때만 쓸 수 있습니다.');
      if (addTo === 'FEE') throw error(line, 'addTo 는 equal 또는 perf 여야 합니다.');
      return { ...base(line, text, 'ROUND'), comp: c, unit, rounding, selector: sel, addTo: addTo ?? 'PERF' };
    }
    case 'fixSum': {
      const c = comp(positional(0, true));
      const target = amount(positional(1, true));
      noMore(2);
      const over = keyword('over') == null ? 'PERF_DESC' : order(keyword('over'));
      const under = keyword('under') == null ? 'PERF_ASC' : order(keyword('under'));
      return { ...base(line, text, 'FIX_SUM'), comp: c, amount: target, over, under };
    }
    case 'spreadDiff': {
      const c = comp(positional(0, true));
      if (c === 'FEE') throw error(line, 'spreadDiff 는 equal 또는 perf 에만 쓸 수 있습니다.');
      let sel = null;
      let ord = null;
      let idx = 1;
      let a;
      while ((a = positional(idx, false)) != null) {
        if (typeof a === 'string' && ORDERS[a.toLowerCase()] && ord == null) {
          ord = order(a);
          idx++;
        } else if (sel == null) {
          sel = selector(idx);
          idx += consumed(sel);
        } else {
          throw error(line, 'spreadDiff 인자가 너무 많습니다.');
        }
      }
      let step = 1;
      const st = keyword('step');
      if (typeof st === 'number') {
        step = st;
        if (step < 1 || step > MAX_UNIT) throw error(line, 'step 은 1원 이상이어야 합니다.');
      }
      return { ...base(line, text, 'SPREAD_DIFF'), comp: c, selector: sel ?? { type: 'OTHERS', names: [] }, order: ord ?? 'PERF_DESC', step };
    }
    case 'min':
    case 'max':
    case 'add':
    case 'set': {
      const kind = name.toUpperCase();
      const c = comp(positional(0, true));
      const amt = amount(positional(1, true));
      if (amt.pct != null && kind !== 'ADD') throw error(line, `${name} 의 금액은 원 단위여야 합니다.`);
      if (kind !== 'ADD' && amt.won < 0) throw error(line, `${name} 의 금액은 0 이상이어야 합니다.`);
      const sel = selector(2);
      if (positional(2, false) != null) noMore(2 + consumed(sel));
      return { ...base(line, text, kind), comp: c, amount: amt, selector: sel };
    }
    default:
      throw error(line, `지원하지 않는 연산입니다: ${name} (allocate · roundUp · roundDown · roundHalf · fixSum · spreadDiff · min · max · add · set · assert)`);
  }
}

function parseAssert(line, cond) {
  const c = cond.replace(/\s+/g, ' ');
  if (c === 'integer') return { form: 'INTEGER' };
  let m = c.match(ASSERT_SUM);
  if (m) {
    const before = m[3] === 'before';
    return { form: 'SUM', comp: m[1].toUpperCase(), op: m[2], value: before ? null : toAmount(line, numberOrPct(line, m[3])), before };
  }
  m = c.match(ASSERT_MOD);
  if (m) {
    const mod = Number(m[3]);
    if (mod < 2 || mod > MAX_UNIT) throw error(line, '나누는 단위는 2 이상이어야 합니다.');
    const sel = m[2];
    const selector = sel.startsWith('"') ? { type: 'NAMED', names: [sel.slice(1, -1)] } : { type: sel === 'first' ? 'FIRST' : 'LAST', names: [] };
    return { form: 'MOD', comp: m[1].toUpperCase(), op: '==', mod, selector };
  }
  m = c.match(ASSERT_ALL);
  if (m) return { form: 'ALL', comp: m[1].toUpperCase(), op: m[2], value: toAmount(line, numberOrPct(line, m[3])) };
  throw error(line, 'assert 는 \'sum(구성요소) == 금액|N%|before\', \'구성요소("기관명") % N == 0\', \'all(구성요소 >= 0)\', \'integer\' 형식만 됩니다.');
}

const toAmount = (line, v) => {
  if (typeof v === 'number') return { won: v, pct: null };
  if (v instanceof Pct) return { won: 0, pct: v.value };
  throw error(line, `금액(원) 또는 비율(N%)이 필요합니다: ${show(v)}`);
};

function parseArgs(line, body) {
  const args = [];
  if (!body.trim()) return args;
  let pos = 0;
  while (pos < body.length) {
    ARG.lastIndex = pos;
    const m = ARG.exec(body);
    if (!m) throw error(line, `인자를 읽을 수 없습니다: ${body.slice(pos)}`);
    args.push([m[1] ?? null, value(line, m[2].trim())]);
    pos = ARG.lastIndex;
    if (pos < body.length && body[pos - 1] !== ',') throw error(line, `인자 사이에 쉼표가 필요합니다: ${body}`);
  }
  return args;
}

function value(line, raw) {
  if (raw.startsWith('"')) {
    const s = raw.slice(1, -1).trim();
    if (!s) throw error(line, '기관명이 비어 있습니다.');
    return new Quoted(s);
  }
  if (/^-?[\d,]+(?:\.\d+)?\s*%?$/.test(raw)) return numberOrPct(line, raw);
  return raw;
}

function numberOrPct(line, raw) {
  let s = raw.replace(/,/g, '').replace(/ /g, '');
  const pct = s.endsWith('%');
  if (pct) s = s.slice(0, -1);
  const v = Number(s);
  if (!Number.isFinite(v)) throw error(line, `숫자를 읽을 수 없습니다: ${raw}`);
  if (pct) {
    if (Math.abs(v) > MAX_PCT) throw error(line, `비율은 ±${MAX_PCT}% 이내여야 합니다.`);
    return new Pct(v);
  }
  if (s.includes('.')) throw error(line, `금액은 원 단위 정수여야 합니다: ${raw}`);
  if (Math.abs(v) > MAX_AMOUNT) throw error(line, `금액이 너무 큽니다: ${raw}`);
  return v;
}

const show = (v) => (v instanceof Quoted ? `"${v.text}"` : v instanceof Pct ? `${trimPct(v.value)}%` : String(v));

// ── 실행기 (서버 PostprocessEngine) ──
// lines: [{ institutionId, code, name, aliases, finalCount, equalMicro, perfMicro }]
// → { items: [{ equalFee, perfFee, fee, beforeSpecialFee, reason, applied, adjustment }], checks: [{ expression, label, passed, actual }], notes }

const floorDiv = (a, b) => Math.floor(a / b);
const floorMod = (a, b) => a - Math.floor(a / b) * b;

// 원 단위 배분(최대잔여법). micro 배열 → 원 배열. 서버 PostprocessEngine.allocateMicro 와 같다
export function allocateMicro(micro) {
  const fees = micro.map((m) => floorDiv(m, MICRO));
  const frac = micro.map((m) => floorMod(m, MICRO));
  const left = Math.floor((frac.reduce((s, f) => s + f, 0) + MICRO / 2) / MICRO);
  frac
    .map((f, idx) => ({ idx, f }))
    .sort((a, b) => b.f - a.f || a.idx - b.idx)
    .slice(0, Math.min(Math.max(0, left), micro.length))
    .forEach(({ idx }) => fees[idx]++);
  return fees;
}

const roundTo = (v, unit, mode) =>
  mode === 'UP' ? floorDiv(v + unit - 1, unit) * unit : mode === 'HALF_UP' ? floorDiv(v + Math.floor(unit / 2), unit) * unit : floorDiv(v, unit) * unit;

const compare = (a, op, b) =>
  op === '==' ? a === b : op === '!=' ? a !== b : op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;

const ROUND_LABEL = { UP: '절상', DOWN: '절사', HALF_UP: '반올림' };
export const COMP_LABEL = { EQUAL: '균등분담분', PERF: '실적분담분', FEE: '회비' };
const orderLabel = (o) =>
  o === 'FEE_DESC' || o === 'FEE_ASC' ? '회비순' : o === 'EQUAL_DESC' || o === 'EQUAL_ASC' ? '균등분담분순' : o === 'CODE_ASC' ? '기관코드순' : '실적순';
const SELECTOR_LABEL = { ALL: '전체 기관', FIRST: '첫 번째 기관', LAST: '마지막 기관', OTHERS: '나머지 기관' };
const selectorLabel = (s) => (s.type === 'NAMED' ? s.names.join('·') : SELECTOR_LABEL[s.type]);
// micro → "1,234원" (원 미만이 있으면 소수 둘째 자리까지)
const won = (micro) =>
  micro % MICRO === 0 ? `${n0(micro / MICRO)}원` : `${(micro / MICRO).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}원`;
const signed = (micro) => `${micro > 0 ? '+' : '-'}${won(Math.abs(micro))}`;

export function runScript(script, lineRows) {
  const ops = typeof script === 'string' ? parseScript(script) : script;
  const n = lineRows.length;
  const eq = lineRows.map((l) => l.equalMicro);
  const pf = lineRows.map((l) => l.perfMicro);
  const rawTotalMicro = eq.reduce((s, v, i) => s + v + pf[i], 0);
  const reasons = lineRows.map(() => []);
  const checks = [];
  const notes = [];
  let before = null;
  let captured = false;
  let pending = 0;
  let pendingLabel = null;
  let lastTargets = null;

  const get = (c, i) => (c === 'EQUAL' ? eq[i] : c === 'PERF' ? pf[i] : eq[i] + pf[i]);
  const change = (c, addTo, i, delta) => {
    const target = c === 'FEE' ? addTo ?? 'PERF' : c;
    if (target === 'EQUAL') eq[i] += delta;
    else pf[i] += delta;
  };
  const allInteger = () => eq.every((v, i) => v % MICRO === 0 && pf[i] % MICRO === 0);
  const capture = () => {
    if (!captured && allInteger()) {
      captured = true;
      before = eq.map((v, i) => (v + pf[i]) / MICRO);
    }
  };
  const all = () => lineRows.map((_, i) => i);
  const indexOf = (name) => {
    let i = lineRows.findIndex((l) => name === l.name || name === l.institutionId || name === l.code);
    if (i < 0) i = lineRows.findIndex((l) => (l.aliases ?? []).includes(name));
    return i;
  };
  const targets = (sel, line) => {
    let idx = [];
    if (sel.type === 'ALL') idx = all();
    else if (sel.type === 'FIRST') idx = n > 0 ? [0] : [];
    else if (sel.type === 'LAST') idx = n > 0 ? [n - 1] : [];
    else if (sel.type === 'OTHERS') {
      const prev = lastTargets ?? [];
      idx = all().filter((i) => !prev.includes(i));
    } else {
      sel.names.forEach((name) => {
        const i = indexOf(name);
        if (i < 0) notes.push(`${line}행: '${name}' 기관이 산출 대상에 없어 건너뛰었습니다.`);
        else if (!idx.includes(i)) idx.push(i);
      });
    }
    if (sel.type !== 'OTHERS') lastTargets = idx;
    return idx;
  };
  const codeOf = (i) => lineRows[i].code ?? '';
  const key = (order, i) =>
    order === 'PERF_DESC' ? -pf[i]
      : order === 'PERF_ASC' ? pf[i]
        : order === 'COUNT_DESC' ? -lineRows[i].finalCount
          : order === 'COUNT_ASC' ? lineRows[i].finalCount
            : order === 'FEE_DESC' ? -(eq[i] + pf[i])
              : order === 'FEE_ASC' ? eq[i] + pf[i]
                : order === 'EQUAL_DESC' ? -eq[i]
                  : order === 'EQUAL_ASC' ? eq[i]
                    : 0;
  // 동률은 기관코드 오름차순, 그래도 같으면 원래 순서 (서버와 같다)
  const ordered = (idx, order) =>
    idx.slice().sort((a, b) => key(order, a) - key(order, b) || (codeOf(a) < codeOf(b) ? -1 : codeOf(a) > codeOf(b) ? 1 : 0) || a - b);
  // 비율 목표 = 보정 전 총액(원) × N% 를 원 단위 반올림. 서버와 같은 순서의 double 연산
  const targetMicro = (a) => (a.pct == null ? a.won * MICRO : Math.round((rawTotalMicro / MICRO) * a.pct / 100) * MICRO);

  const allocate = (c) => {
    if (c === 'FEE') {
      const feeW = allocateMicro(eq.map((v, i) => v + pf[i]));
      const eqW = allocateMicro(eq);
      for (let i = 0; i < n; i++) {
        eq[i] = Math.min(eqW[i], feeW[i]) * MICRO;
        pf[i] = feeW[i] * MICRO - eq[i];
      }
    } else if (c === 'EQUAL') {
      allocateMicro(eq).forEach((w, i) => (eq[i] = w * MICRO));
    } else {
      allocateMicro(pf).forEach((w, i) => (pf[i] = w * MICRO));
    }
  };

  const round = (op) => {
    const unitMicro = op.unit * MICRO;
    const t = targets(op.selector, op.line);
    const record = op.unit > 1 || captured;
    let total = 0;
    t.forEach((i) => {
      const cur = get(op.comp, i);
      const delta = roundTo(cur, unitMicro, op.rounding) - cur;
      if (delta === 0) return;
      change(op.comp, op.addTo, i, delta);
      total += delta;
      if (record) reasons[i].push(`${n0(op.unit)}원 단위 ${ROUND_LABEL[op.rounding]} (${signed(delta)})`);
    });
    if (record) {
      pending += total;
      pendingLabel = ROUND_LABEL[op.rounding];
    }
  };

  const adjust = (op) => {
    const t = targets(op.selector, op.line);
    const a = op.amount;
    let total = 0;
    t.forEach((i) => {
      const cur = get(op.comp, i);
      let next;
      if (op.kind === 'MIN') next = Math.max(cur, a.won * MICRO);
      else if (op.kind === 'MAX') next = Math.min(cur, a.won * MICRO);
      else if (op.kind === 'SET') next = a.won * MICRO;
      else next = a.pct != null ? cur + Math.round((cur / MICRO) * a.pct / 100) * MICRO : cur + a.won * MICRO;
      if (next < 0) next = 0;
      const delta = next - cur;
      if (delta === 0) return;
      change(op.comp, null, i, delta);
      total += delta;
      const what =
        op.kind === 'MIN' ? `최저 ${COMP_LABEL[op.comp]} ${amountLabel(a)} 적용`
          : op.kind === 'MAX' ? `최고 ${COMP_LABEL[op.comp]} ${amountLabel(a)} 적용`
            : op.kind === 'SET' ? `${COMP_LABEL[op.comp]} ${amountLabel(a)} 고정`
              : `${COMP_LABEL[op.comp]} ${a.pct != null ? `${trimPct(Math.abs(a.pct))}%` : `${n0(Math.abs(a.won))}원`}${delta > 0 ? ' 가산' : ' 감액'}`;
      reasons[i].push(`${what} (${signed(delta)})`);
    });
    pending += total;
    pendingLabel =
      op.kind === 'MIN' ? `최저 ${COMP_LABEL[op.comp]}` : op.kind === 'MAX' ? `최고 ${COMP_LABEL[op.comp]}` : op.kind === 'SET' ? `${COMP_LABEL[op.comp]} 고정` : `${COMP_LABEL[op.comp]} 가감`;
  };

  const fixSum = (op) => {
    const target = targetMicro(op.amount);
    const sum = all().reduce((s, i) => s + get(op.comp, i), 0);
    const diff = sum - target;
    if (diff === 0) return;
    if (!allInteger() || target % MICRO !== 0) throw error(op.line, 'fixSum 은 금액을 정수로 만든 뒤(allocate · roundHalf) 써야 합니다.');
    const delta = new Array(n).fill(0);
    let left = Math.abs(diff);
    const step = diff > 0 ? -MICRO : MICRO;
    const order = ordered(all(), diff > 0 ? op.over : op.under);
    while (left > 0) {
      let moved = false;
      for (const i of order) {
        if (left === 0) break;
        if (step < 0 && get(op.comp, i) + step < 0) continue;
        change(op.comp, null, i, step);
        delta[i] += step;
        left -= MICRO;
        moved = true;
      }
      if (!moved) {
        notes.push(`${op.line}행 fixSum: 0원 미만으로 내릴 수 없어 ${n0(left / MICRO)}원이 남았습니다.`);
        break;
      }
    }
    // 합계 보정은 그 자체로 완결된 단계라 되돌릴 차이분(pending)을 만들지 않는다
    delta.forEach((d, i) => {
      if (d !== 0) reasons[i].push(`${COMP_LABEL[op.comp]} 합계 ${amountLabel(op.amount)} 보정 (${signed(d)})`);
    });
  };

  const spreadDiff = (op) => {
    if (pending === 0) return;
    const t = targets(op.selector, op.line);
    const order = ordered(t, op.order);
    const stepMicro = op.step * MICRO;
    const step = pending > 0 ? -stepMicro : stepMicro;
    let left = Math.abs(pending);
    const delta = new Array(n).fill(0);
    while (left > 0) {
      let moved = false;
      for (const i of order) {
        if (left === 0) break;
        const d = step < 0 ? -Math.min(stepMicro, left) : Math.min(stepMicro, left);
        if (d < 0 && get(op.comp, i) + d < 0) continue;
        change(op.comp, null, i, d);
        delta[i] += d;
        left -= Math.abs(d);
        moved = true;
      }
      if (!moved) {
        notes.push(`${op.line}행 spreadDiff: 0원 미만으로 내릴 수 없어 차이분 ${n0(left / MICRO)}원을 되돌리지 못했습니다.`);
        break;
      }
    }
    const what = `${pendingLabel == null ? '' : `${pendingLabel} `}차이분 ${orderLabel(op.order)}${step < 0 ? ' 절삭' : ' 가산'}`;
    order.forEach((i) => {
      if (delta[i] !== 0) reasons[i].push(`${what} (${signed(delta[i])})`);
    });
    pending = 0;
    pendingLabel = null;
  };

  const assertion = (op) => {
    const a = op.assertion;
    const expr = op.text.slice(6).trim();
    if (a.form === 'INTEGER') {
      const ok = allInteger();
      checks.push({ expression: expr, label: '모든 금액이 원 단위 정수', passed: ok, actual: ok ? '정수' : '원 미만 있음' });
    } else if (a.form === 'SUM') {
      const sum = all().reduce((s, i) => s + get(a.comp, i), 0);
      const target = a.before ? Math.round(rawTotalMicro / MICRO) * MICRO : targetMicro(a.value);
      const targetLabel = a.before ? `보정 전 총액 ${won(target)}` : a.value.pct != null ? `${amountLabel(a.value)} (${won(target)})` : won(target);
      checks.push({ expression: expr, label: `${COMP_LABEL[a.comp]} 합계 ${a.op} ${targetLabel}`, passed: compare(sum, a.op, target), actual: won(sum) });
    } else if (a.form === 'MOD') {
      const t = targets(a.selector, op.line);
      if (!t.length) {
        // 대상 기관이 이번 산출에 없으면 확인할 금액이 없다 (해당 단계도 건너뛰고 참고로 남는다)
        checks.push({ expression: expr, label: `${selectorLabel(a.selector)} ${COMP_LABEL[a.comp]} ${n0(a.mod)}원 단위`, passed: true, actual: '대상 기관 없음 · 확인 생략' });
        return;
      }
      let ok = true;
      const actual = [];
      t.forEach((i) => {
        const v = get(a.comp, i);
        ok &&= v % (a.mod * MICRO) === 0;
        actual.push(`${lineRows[i].name} ${won(v)}`);
      });
      checks.push({ expression: expr, label: `${selectorLabel(a.selector)} ${COMP_LABEL[a.comp]} ${n0(a.mod)}원 단위`, passed: ok, actual: actual.join(', ') });
    } else {
      const limit = a.value.won * MICRO;
      let ok = true;
      let worst = n === 0 ? 0 : get(a.comp, 0);
      for (let i = 0; i < n; i++) {
        const v = get(a.comp, i);
        if (!compare(v, a.op, limit)) {
          ok = false;
          worst = v;
        }
      }
      checks.push({ expression: expr, label: `모든 기관 ${COMP_LABEL[a.comp]} ${a.op} ${won(limit)}`, passed: ok, actual: ok ? '전 기관 통과' : `위반 금액 ${won(worst)}` });
    }
  };

  capture();
  for (const op of ops) {
    if (op.kind === 'ALLOCATE') allocate(op.comp);
    else if (op.kind === 'ROUND') round(op);
    else if (op.kind === 'FIX_SUM') fixSum(op);
    else if (op.kind === 'SPREAD_DIFF') spreadDiff(op);
    else if (op.kind === 'ASSERT') assertion(op);
    else adjust(op);
    capture();
  }
  if (!captured) {
    allocate('EQUAL');
    allocate('PERF');
    notes.push('스크립트가 원 미만을 정리하지 않아 균등분담분·실적분담분을 각각 원 단위로 배분했습니다 (allocate 또는 roundHalf 를 넣어 주세요).');
    capture();
  }
  const items = lineRows.map((_, i) => {
    const fee = (eq[i] + pf[i]) / MICRO;
    const reason = reasons[i].length ? PREFIX + reasons[i].join(', ') : null;
    return {
      equalFee: eq[i] / MICRO,
      perfFee: pf[i] / MICRO,
      fee,
      beforeSpecialFee: before[i],
      reason,
      applied: reason != null || fee !== before[i],
      adjustment: fee - before[i],
    };
  });
  return { items, checks, notes, allPassed: checks.every((c) => c.passed) };
}

// ── 시험 실행 (서버 PostprocessEngine.sampleLines / trial) ──
// 시험용 기관 7곳: 총액 3억원을 균등 30% + 실적 70%로 나눈 원시값(원 미만 포함). 저장 전 시험 실행과 빌더 시뮬레이션에 쓴다
export function sampleLines() {
  const names = ['국민은행', '신한은행', '우리은행', '하나은행', 'NH농협은행', '우체국', '카카오뱅크'];
  const codes = ['004', '088', '020', '081', '011', '071', '090'];
  const counts = [2_400_017, 2_100_003, 1_500_011, 1_200_007, 900_013, 300_001, 150_019];
  const total = counts.reduce((s, c) => s + c, 0);
  const totalFeeMicro = 300_000_000 * MICRO;
  const equalMicro = Math.round((totalFeeMicro * 0.3) / names.length);
  return names.map((name, i) => ({
    institutionId: `S${codes[i]}`,
    code: codes[i],
    name,
    aliases: [],
    finalCount: counts[i],
    equalMicro,
    perfMicro: Math.round(totalFeeMicro * 0.7 * (counts[i] / total)),
  }));
}
export const zeroLines = () => sampleLines().map((l) => ({ ...l, finalCount: 0, perfMicro: 0 }));

// 문법 검사 + 시험 실행 2벌(정상·실적 0). 문법·실행 오류는 ScriptError, assert 실패는 오류가 아니다
export function trialScript(script) {
  const ops = parseScript(script);
  const normal = runScript(ops, sampleLines());
  runScript(ops, zeroLines());
  return normal;
}

// ── 자연어 → 스크립트 내장 변환기 (서버 SpecialRuleConverter.convert) ──
// institutions: [{ name, aliases }]. → { script, steps, unsupported }
export const AMOUNT = String.raw`\d[\d,]*(?:\.\d+)?\s*(?:억|만|천)?(?:\s*\d[\d,]*\s*(?:만|천))?\s*원`;
const UNITS = { 억: 100_000_000, 만: 10_000, 천: 1_000 };
const ROUNDING = /(\d[\d,]*)\s*원\s*(?:단위|미만)\s*(?:로|으로|에서)?\s*(반올림|절상|올림|절사|절삭|버림|내림)/;
const CLAMP = new RegExp(String.raw`(최저|최소|최고|최대)\s*(?:회비|금액|한도)?\s*(?:는|은)?\s*(${AMOUNT})`, 'g');
// "균등분담회비 합계가 총액의 25%와 다르면 … 보정" · "실적분담 합계를 목표 75%에 맞춘다" (비율 앞뒤 어디든 목표·총액·합계 + 보정 동사)
const FIX_SUM = /(균등|실적)[^\n]*?(\d+(?:\.\d+)?)\s*%/;
const FIX_SUM_KEY = /목표|총액|합계/;
const FIX_SUM_VERB = /보정|맞|일치|유지|다르|차이/;
// 합계 목표 보정 문장 (검증용 "합계 = 총액의 25%" 는 제외)
const isFixSum = (rule) => !rule.includes('=') && FIX_SUM.test(rule) && FIX_SUM_KEY.test(rule) && FIX_SUM_VERB.test(rule);
const DIFF = /차이|차액|초과|증액|증가/;
const CUT = /절삭|차감|1원씩/;
const ASC = /(작은|적은)\s*(순|기관)/;
const HALF_EACH = /소수점?[^\n]*반올림/;
const OVER = /(큰|많은)\s*(기관|경우)[^\n]*(감액|차감|빼)/;
const UNDER = /(작은|적은)\s*(기관|경우)[^\n]*(증액|가산|더)/;
const KEEP_TOTAL = /총액[^\n]*(변하지|변동|유지)|합계\s*=\s*총액/;
const NON_NEGATIVE = /0\s*원\s*이상/;
const ADD_TO_EQUAL = /균등[^\n]*가산/;
const NOISE = /^\[.*\]$|기관코드\s*(오름차순|순)|정수|검증|반복/;

// "50만원", "1억 2,000만원", "900,000원" → 원
export function parseAmount(text) {
  let total = 0;
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(억|만|천)?/g)) {
    total += Number(m[1].replace(/,/g, '')) * (m[2] ? UNITS[m[2]] : 1);
  }
  return Math.round(total);
}

// 총액이 바뀌면 안 된다는 뜻의 문장이 있는지 (총액 유지 · 차이분 되돌리기)
const keepsTotal = (rules) => rules.some((r) => KEEP_TOTAL.test(r) || isShareBack(r));

// "차이분 … 실적 … 1원씩 절삭" 처럼 늘어난 금액을 다른 기관에서 되돌리는 문장인지
export const isShareBack = (rule) => DIFF.test(rule) && rule.includes('실적') && CUT.test(rule);

// 문장에 이름·별칭이 나온 기관 이름 (더 긴 이름 안에 든 별칭은 뺀다: '하나온은행' 안의 '하나')
export function named(rule, institutions) {
  const found = [];
  institutions.forEach((inst) => {
    const hit = rule.includes(inst.name) ? inst.name : (inst.aliases ?? []).filter((a) => rule.includes(a)).sort((a, b) => b.length - a.length)[0];
    if (hit) found.push({ name: inst.name, hit });
  });
  const result = [];
  found.forEach((f) => {
    const inside = found.some((g) => g !== f && g.hit.length > f.hit.length && g.hit.includes(f.hit));
    if (!inside && !result.includes(f.name)) result.push(f.name);
  });
  return result;
}

const quoted = (names) => names.map((n) => `, "${n}"`).join('');

export function convertSpecialRules(specialRules, institutions) {
  const rules = lines(specialRules);
  const script = [];
  const steps = [];
  const asserts = [];
  const used = rules.map(() => false);
  const all = rules.join('\n');
  const perfOrder = all.includes('실적분담');

  // 0) 정수화
  const halfLine = rules.findIndex((r) => HALF_EACH.test(r));
  if (halfLine >= 0) {
    script.push('roundHalf(equal)', 'roundHalf(perf)');
    steps.push(`'${rules[halfLine]}' → 균등분담분·실적분담분을 각각 원 단위로 반올림: roundHalf(equal), roundHalf(perf)`);
    used[halfLine] = true;
  } else {
    script.push('allocate(fee)');
    steps.push('회비를 원 단위로 배분(최대잔여법): allocate(fee)');
  }

  // 1) 최저·최고
  rules.forEach((r, k) => {
    for (const m of r.matchAll(CLAMP)) {
      const min = m[1] === '최저' || m[1] === '최소';
      const names = named(r, institutions);
      const amt = parseAmount(m[2]);
      script.push(`${min ? 'min' : 'max'}(fee, ${amt}${quoted(names)})`);
      steps.push(`'${r}' → ${min ? '최저' : '최고'} 회비 ${n0(amt)}원${names.length ? ` (${names.join('·')})` : ' (전체 기관)'}`);
      used[k] = true;
    }
  });

  // 2) 합계 목표 보정
  for (let k = 0; k < rules.length; k++) {
    const m = rules[k].match(FIX_SUM);
    if (!isFixSum(rules[k]) || !m) continue;
    const comp = m[1] === '균등' ? 'equal' : 'perf';
    const pct = m[2];
    const desc = perfOrder ? 'perfDesc' : 'countDesc';
    const asc = perfOrder ? 'perfAsc' : 'countAsc';
    script.push(`fixSum(${comp}, ${pct}%, over=${desc}, under=${asc})`);
    steps.push(
      `'${rules[k]}' → ${comp === 'equal' ? '균등분담분' : '실적분담분'} 합계를 총액의 ${pct}%에 맞춤 (초과면 ${perfOrder ? '실적분담분' : '인정 건수'} 큰 기관부터 1원씩 감액, 미달이면 작은 기관부터 1원씩 증액)`,
    );
    asserts.push(`assert sum(${comp}) == ${pct}%`);
    // 다른 쪽도 나머지 비율로 맞춰야 반올림 오차 없이 총액이 유지된다 (총액 유지 문장이 있을 때)
    const other = comp === 'equal' ? 'perf' : 'equal';
    const rest = String(100 - Number(pct));
    if (keepsTotal(rules) && Number(pct) < 100) {
      script.push(`fixSum(${other}, ${rest}%, over=${desc}, under=${asc})`);
      steps.push(`총액 유지 → ${other === 'equal' ? '균등분담분' : '실적분담분'} 합계도 나머지 ${rest}%에 맞춰 반올림 오차를 없앰`);
    }
    used[k] = true;
    break;
  }
  rules.forEach((r, k) => {
    if (OVER.test(r) || UNDER.test(r)) used[k] = true;
  });

  // 3) 끝전 처리 (+ 차이분 되돌리기)
  const shareBackLines = rules.map((r, k) => (isShareBack(r) ? k : -1)).filter((k) => k >= 0);
  let shareBack = false;
  rules.forEach((r, k) => {
    const m = r.match(ROUNDING);
    if (!m) return;
    const unit = Number(m[1].replace(/,/g, ''));
    if (unit <= 1 || unit > MAX_UNIT) return;
    const mode = m[2];
    const fn = mode === '절상' || mode === '올림' ? 'roundUp' : mode === '반올림' ? 'roundHalf' : 'roundDown';
    const raise = fn !== 'roundDown';
    const sb = raise && shareBackLines.length > 0;
    const names = named(r, institutions);
    const target = names.length ? quoted(names) : sb ? ', first' : '';
    const addTo = ADD_TO_EQUAL.test(all) ? ', addTo=equal' : '';
    script.push(`${fn}(fee, ${unit}${target}${addTo})`);
    const who = names.length ? names.join('·') : sb ? '첫 번째 기관' : '전체 기관';
    steps.push(`'${r}' → ${who} 회비를 ${unit}원 단위로 ${ROUND_LABEL[fn === 'roundUp' ? 'UP' : fn === 'roundHalf' ? 'HALF_UP' : 'DOWN']}${addTo ? ' (차이는 균등분담분에)' : ' (차이는 실적분담분에)'}`);
    used[k] = true;
    if (names.length) asserts.push(`assert fee("${names[0]}") % ${unit} == 0`);
    if (sb) {
      const asc = shareBackLines.some((i) => ASC.test(rules[i]));
      const order = perfOrder ? (asc ? 'perfAsc' : 'perfDesc') : asc ? 'countAsc' : 'countDesc';
      script.push(`spreadDiff(perf, others, ${order})`);
      steps.push(`'${rules[shareBackLines[0]]}' → 늘어난 금액만큼 나머지 기관의 실적분담분을 ${perfOrder ? '실적분담분' : '인정 건수'}가 ${asc ? '작은' : '큰'} 순서대로 1원씩 차감 (합계 유지)`);
      shareBack = true;
    }
  });
  if (shareBack) {
    shareBackLines.forEach((i) => (used[i] = true));
    asserts.push('assert sum(fee) == before');
  }

  // 4) 검증 문장
  rules.forEach((r, k) => {
    if (KEEP_TOTAL.test(r)) {
      if (!asserts.includes('assert sum(fee) == before')) asserts.push('assert sum(fee) == before');
      used[k] = true;
    }
    if (NON_NEGATIVE.test(r)) used[k] = true;
    if (r.includes('가산') && (r.includes('증액') || r.includes('증가'))) used[k] = true;
    if (r.includes('일의 자리') && r.includes('0')) used[k] = true;
    if (r.includes('=') && FIX_SUM.test(r) && FIX_SUM_KEY.test(r)) used[k] = true;
    if (NOISE.test(r)) used[k] = true;
  });
  if (!asserts.includes('assert all(fee >= 0)')) asserts.push('assert all(fee >= 0)');
  script.push(...asserts);
  steps.push(`검증: ${asserts.map((a) => a.slice(7)).join(' · ')}`);

  return { script: script.join('\n'), steps, unsupported: rules.filter((_, k) => !used[k]) };
}

// 산출에 실행할 스크립트 (서버 FeeCalculationService.scriptOf 와 같다):
// skill.md 에 postprocess 블록이 있으면 그것(SCRIPT), 블록 없이 자연어만 있으면 내장 변환기로 바꾼 것(AUTO_RULE, 문법 오류면 DEFAULT),
// 4번이 비어 있으면 기본 배분(DEFAULT)
export const DEFAULT_POSTPROCESS = 'allocate(fee)';
export function scriptOf(skill, institutions) {
  if (skill.postprocess && skill.postprocess.trim()) return { text: skill.postprocess, source: 'SCRIPT' };
  if (skill.specialRules?.length) {
    const converted = convertSpecialRules(skill.specialRulesRaw, institutions).script;
    try {
      parseScript(converted);
      return { text: converted, source: 'AUTO_RULE' };
    } catch {
      return { text: DEFAULT_POSTPROCESS, source: 'DEFAULT' };
    }
  }
  return { text: DEFAULT_POSTPROCESS, source: 'DEFAULT' };
}

export const SOURCE_LABEL = {
  SCRIPT: '확정 스크립트 적용',
  AUTO_RULE: '자동 변환 적용 (스크립트 미확정)',
  DEFAULT: '특이사항 없음 · 기본 배분',
};

// 서버 미연결(Mock) 모드의 generate-postprocess: 내장 변환기 + 시험 실행 (서버 PostprocessGeneratorService.response 와 같은 모양)
export function generatePostprocessLocally(taskCode, specialRulesText, institutions) {
  const rules = (specialRulesText ?? '').replace(/\r\n/g, '\n').trim();
  if (!rules) throw new Error("'## 4. 최종 정산 특이사항'에 문장을 먼저 적어 주세요.");
  const c = convertSpecialRules(rules, institutions);
  let passed = true;
  let message = '문법 검사와 시험 실행 2벌(정상·실적 0)을 통과했습니다.';
  let sample = [];
  let checks = [];
  let notes = [];
  try {
    const r = trialScript(c.script);
    const sl = sampleLines();
    sample = r.items.map((it, i) => ({ name: sl[i].name, finalCount: sl[i].finalCount, ...it }));
    checks = r.checks;
    notes = r.notes;
    if (!r.allPassed) {
      message += ` 단, 시험 데이터에서 검증(assert) ${r.checks.filter((ch) => !ch.passed).length}건이 실패했습니다 (실제 기관 데이터로 산출해 확인해 주세요).`;
    }
  } catch (e) {
    passed = false;
    message = e.message;
  }
  return {
    taskCode,
    generatedScript: c.script,
    explanation: c.steps,
    unsupported: c.unsupported,
    validationPassed: passed,
    validationMessage: message,
    sample,
    checks,
    notes,
    source: 'RULE',
    model: null,
    note: '서버 미연결(Mock) 모드: 브라우저에 AI 키를 둘 수 없어 서버와 같은 내장 변환기로 만들었습니다.',
  };
}
