// 업무별 skill.md(회비 산정 기준) 읽기·계산.
// 서버(VITE_API_BASE_URL)가 있으면 서버의 skill.md와 SkillEngineService 결과를 쓰고,
// 없으면 아래에서 묶어 온 원본 skill.md를 같은 규칙으로 해석해 브라우저에서 계산한다.

// 백엔드 원본 파일을 그대로 가져온다 (backend/src/main/resources/skills/*.md)
const files = import.meta.glob('../../backend/src/main/resources/skills/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// 업무 ID(BUSINESSES[].id) → skill.md 업무 코드
export const TASK_CODES = {
  openbanking: 'OPEN_BANKING',
  fininfo: 'FIN_INFO',
  cms: 'CMS',
  cd: 'CD_NET',
  interbank: 'INTERBANK',
};

export const DEFAULT_SKILLS = Object.fromEntries(
  Object.entries(files).map(([path, md]) => [path.split('/').pop().replace(/\.md$/, ''), md.replace(/\r\n/g, '\n')]),
);

const END = String.raw`(?=^##\s|(?![\s\S]))`;
const SUMMARY = new RegExp(String.raw`^##\s*1\.\s*비즈니스 규칙 요약[ \t]*\n([\s\S]*?)` + END, 'm');
const AI_GUIDE = new RegExp(String.raw`^##\s*2\.\s*AI 예외 차감 지침[ \t]*\n([\s\S]*?)` + END, 'm');
const FORMULA = /```formula[ \t]*\n([\s\S]*?)```/;
const TITLE = /^#\s+(.+)$/m;
const CALC_TYPE = /^[-*]\s*산정 유형\s*:\s*(.+)$/m;
const RATE_UNIT = /^[-*]\s*표시 단위\s*:\s*(.+)$/m;

// 서버 SkillEngineService.parse 와 같은 규칙. 섹션이 없으면 Error
export function parseSkill(taskCode, markdown) {
  const md = markdown.replace(/\r\n/g, '\n');
  const summaryText = md.match(SUMMARY)?.[1]?.trim();
  if (!summaryText) throw new Error("'## 1. 비즈니스 규칙 요약' 섹션을 찾을 수 없습니다.");
  const formula = md.match(FORMULA)?.[1]?.trim();
  if (!formula) throw new Error("'## 3. 정산 수식'의 ```formula 코드 블록을 찾을 수 없습니다.");
  return {
    taskCode,
    title: md.match(TITLE)?.[1]?.trim() ?? taskCode,
    calcType: md.match(CALC_TYPE)?.[1]?.trim() ?? 'skill.md 수식',
    rateUnit: md.match(RATE_UNIT)?.[1]?.trim() ?? '%',
    summaryText,
    summary: summaryText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^([-*]|\d+\.)\s+/, '')),
    aiGuide: md.match(AI_GUIDE)?.[1]?.trim() ?? '',
    formula,
    markdown: md,
  };
}

// ── SpEL 수식 중 회비 계산에 쓰는 부분만 계산하는 작은 해석기 ──
// 숫자, #변수, + - * / %, 비교, and/or/not, 삼항(? :), 괄호. 정수끼리 나누면 SpEL처럼 소수점을 버린다.
// 타입 참조·메서드 호출은 지원하지 않는다 (서버도 막는다).
const TOKEN = /\s*(?:(\d+\.\d+|\d+)|#([A-Za-z_]\w*)|(==|!=|<=|>=|&&|\|\||[-+*/%()<>?:!])|([A-Za-z_]\w*))/y;
const WORD_OPS = { and: '&&', or: '||', not: '!', eq: '==', ne: '!=', lt: '<', gt: '>', le: '<=', ge: '>=', div: '/', mod: '%' };

function tokenize(src) {
  const tokens = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    if (/^\s*$/.test(src.slice(TOKEN.lastIndex))) break;
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`수식을 읽을 수 없습니다: ${src.slice(at, at + 12)}`);
    if (m[1]) tokens.push({ t: 'num', v: Number(m[1]), int: !m[1].includes('.') });
    else if (m[2]) tokens.push({ t: 'var', v: m[2] });
    else if (m[3]) tokens.push({ t: 'op', v: m[3] });
    else if (WORD_OPS[m[4].toLowerCase()]) tokens.push({ t: 'op', v: WORD_OPS[m[4].toLowerCase()] });
    else if (/^(true|false)$/i.test(m[4])) tokens.push({ t: 'bool', v: m[4].toLowerCase() === 'true' });
    else throw new Error(`지원하지 않는 이름입니다: ${m[4]}`);
  }
  return tokens;
}

export function evaluateFormula(formula, vars) {
  const tokens = tokenize(formula);
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (...ops) => peek()?.t === 'op' && ops.includes(peek().v);
  const expect = (op) => {
    if (!isOp(op)) throw new Error(`'${op}'가 필요합니다.`);
    i++;
  };
  const num = (x) => {
    if (typeof x.v !== 'number') throw new Error('숫자가 아닌 값으로 계산할 수 없습니다.');
    return x;
  };
  const arith = (op, a, b) => {
    num(a);
    num(b);
    const int = a.int && b.int;
    if (op === '+') return { v: a.v + b.v, int };
    if (op === '-') return { v: a.v - b.v, int };
    if (op === '*') return { v: a.v * b.v, int };
    if ((op === '/' || op === '%') && int && b.v === 0) throw new Error('0으로 나눌 수 없습니다.');
    if (op === '/') return { v: int ? Math.trunc(a.v / b.v) : a.v / b.v, int };
    return { v: a.v % b.v, int };
  };

  const primary = () => {
    const tk = tokens[i++];
    if (!tk) throw new Error('수식이 끝나지 않았습니다.');
    if (tk.t === 'num') return { v: tk.v, int: tk.int };
    if (tk.t === 'bool') return { v: tk.v };
    if (tk.t === 'var') {
      if (!(tk.v in vars)) throw new Error(`알 수 없는 변수입니다: #${tk.v}`);
      return { v: vars[tk.v], int: Number.isInteger(vars[tk.v]) && tk.v !== 'periodScale' };
    }
    if (tk.t === 'op' && tk.v === '(') {
      const v = ternary();
      expect(')');
      return v;
    }
    throw new Error(`예상하지 못한 기호입니다: ${tk.v}`);
  };
  const unary = () => {
    if (isOp('-')) {
      i++;
      const v = num(unary());
      return { v: -v.v, int: v.int };
    }
    if (isOp('!')) {
      i++;
      return { v: !unary().v };
    }
    return primary();
  };
  const mul = () => {
    let a = unary();
    while (isOp('*', '/', '%')) a = arith(tokens[i++].v, a, unary());
    return a;
  };
  const add = () => {
    let a = mul();
    while (isOp('+', '-')) a = arith(tokens[i++].v, a, mul());
    return a;
  };
  const rel = () => {
    const a = add();
    if (!isOp('<', '>', '<=', '>=')) return a;
    const op = tokens[i++].v;
    const b = add();
    return { v: op === '<' ? a.v < b.v : op === '>' ? a.v > b.v : op === '<=' ? a.v <= b.v : a.v >= b.v };
  };
  const eq = () => {
    let a = rel();
    while (isOp('==', '!=')) {
      const op = tokens[i++].v;
      const b = rel();
      a = { v: op === '==' ? a.v === b.v : a.v !== b.v };
    }
    return a;
  };
  const and = () => {
    let a = eq();
    while (isOp('&&')) {
      i++;
      const b = eq();
      a = { v: !!a.v && !!b.v };
    }
    return a;
  };
  const or = () => {
    let a = and();
    while (isOp('||')) {
      i++;
      const b = and();
      a = { v: !!a.v || !!b.v };
    }
    return a;
  };
  const ternary = () => {
    const c = or();
    if (!isOp('?')) return c;
    i++;
    const a = ternary();
    expect(':');
    const b = ternary();
    return c.v ? a : b;
  };

  const result = ternary();
  if (i < tokens.length) throw new Error(`수식 끝에 남은 부분이 있습니다: ${tokens[i].v}`);
  if (typeof result.v !== 'number' || !Number.isFinite(result.v)) throw new Error('수식 결과가 숫자가 아닙니다.');
  if (result.v < 0) throw new Error(`수식 결과가 음수입니다: ${result.v}`);
  return result.v;
}

// 서버 SkillEngineService.allocate 와 같다: 원 미만 버림 → (결과 합계 반올림 - 버린 합계)를 원 미만이 큰 기관부터 1원씩
export function allocate(raw) {
  const fees = raw.map((v) => Math.floor(v + 1e-9));
  const left = Math.round(raw.reduce((s, v) => s + v, 0)) - fees.reduce((s, v) => s + v, 0);
  raw
    .map((v, idx) => ({ idx, rem: v - fees[idx] }))
    .sort((a, b) => b.rem - a.rem || a.idx - b.idx)
    .slice(0, Math.max(0, left))
    .forEach(({ idx }) => fees[idx]++);
  return fees;
}

// 결과 표의 '적용 단가/분담률' 문구
export function rateLabel(skill, fee, finalCount, feeSum) {
  if (skill.rateUnit.includes('건')) {
    const unit = finalCount ? fee / finalCount : 0;
    const digits = Number.isInteger(unit) ? 0 : 2;
    return `${unit.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}원/건`;
  }
  return `${(feeSum ? (fee / feeSum) * 100 : 0).toFixed(2)}%`;
}
