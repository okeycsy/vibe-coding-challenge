import { trialScript } from './postprocess';

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
// "## 3." 제목부터 다음 "## " 제목(보통 "## 4. 최종 정산 특이사항") 직전까지. 수식은 이 범위 안에서만 찾는다
const FORMULA_SECTION = new RegExp(String.raw`^##\s*3\.[^\n]*\n([\s\S]*?)` + END, 'm');
const FORMULA = /```formula(?::(equal|perf))?[ \t]*\n([\s\S]*?)```/g;
const POSTPROCESS = /[ \t]*```postprocess[ \t]*\n([\s\S]*?)```[ \t]*\n?/;
const SPECIAL = new RegExp(String.raw`^##\s*4\.\s*최종 정산 특이사항[ \t]*\n([\s\S]*?)` + END, 'm');
const TITLE = /^#\s+(.+)$/m;
const CALC_TYPE = /^[-*]\s*산정 유형\s*:\s*(.+)$/m;
const RATE_UNIT = /^[-*]\s*표시 단위\s*:\s*(.+)$/m;

// 마크다운 목록 → 글머리표를 뗀 줄 목록 (빈 줄 제외). 서버 SkillEngineService.lines 와 같다
export const lines = (text) =>
  (text ?? '')
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^([-*]|\d+\.)\s+/, ''));

// 서버 SkillEngineService.parse 와 같은 규칙. 1번 요약·3번 수식이 없으면 Error, 2번·4번은 선택
export function parseSkill(taskCode, markdown) {
  const md = markdown.replace(/\r\n/g, '\n');
  const summaryText = md.match(SUMMARY)?.[1]?.trim();
  if (!summaryText) throw new Error("'## 1. 비즈니스 규칙 요약' 섹션을 찾을 수 없습니다.");
  // "## 3." 섹션이 있으면 그 안의 ```formula 블록만 (4번 특이사항에 코드 블록이 있어도 수식으로 읽지 않게)
  const section3 = md.match(FORMULA_SECTION)?.[1];
  const f = formulas(section3 ?? md);
  // 4번: 자연어 특이사항 + ```postprocess 후처리 스크립트 블록(선택). 자연어 원문(specialRulesRaw)에서는 블록을 뺀다
  const section4 = md.match(SPECIAL)?.[1];
  let postprocess = '';
  let specialRulesRaw = '';
  if (section4 != null) {
    const pm = section4.match(POSTPROCESS);
    if (pm) {
      postprocess = pm[1].trim();
      specialRulesRaw = (section4.slice(0, pm.index) + section4.slice(pm.index + pm[0].length)).trim();
    } else {
      specialRulesRaw = section4.trim();
    }
  }
  return {
    taskCode,
    title: md.match(TITLE)?.[1]?.trim() ?? taskCode,
    calcType: md.match(CALC_TYPE)?.[1]?.trim() ?? 'skill.md 수식',
    rateUnit: md.match(RATE_UNIT)?.[1]?.trim() ?? '%',
    summaryText,
    summary: lines(summaryText),
    aiGuide: md.match(AI_GUIDE)?.[1]?.trim() ?? '',
    formula: f.total,
    equalFormula: f.equal,
    perfFormula: f.perf,
    postprocess,
    specialRulesRaw,
    specialRules: lines(specialRulesRaw),
    markdown: md,
  };
}

export const MAX_FORMULA_LENGTH = 2000;
export const isSplit = (skill) => skill.equalFormula != null;

// 3번 섹션의 수식 블록들 (서버 SkillEngineService.formulas 와 같다). total 은 늘 있고(분리형이면 "(균등) + (실적)" 표시용),
// equal·perf 는 ```formula:equal / ```formula:perf 분리형일 때만. 총액 또는 (균등 + 실적)이 있어야 한다
export function formulas(section3) {
  let total = null;
  let equal = null;
  let perf = null;
  for (const m of section3.matchAll(FORMULA)) {
    const body = m[2].trim();
    if (body.length > MAX_FORMULA_LENGTH) throw new Error(`수식은 ${MAX_FORMULA_LENGTH.toLocaleString('ko-KR')}자 이하로 작성해 주세요.`);
    if (m[1] == null) total ??= body;
    else if (m[1] === 'equal') equal ??= body;
    else perf ??= body;
  }
  if ((equal == null) !== (perf == null)) throw new Error('```formula:equal(균등분담분)과 ```formula:perf(실적분담분) 블록은 함께 있어야 합니다.');
  if (equal != null && (!equal || !perf)) throw new Error('```formula:equal 또는 ```formula:perf 블록이 비어 있습니다.');
  if (equal == null && !total) throw new Error("'## 3. 정산 수식'의 ```formula 코드 블록을 찾을 수 없습니다.");
  if (!total) total = `(${equal}) + (${perf})`;
  return { total, equal, perf };
}

// ── [기준 문서 편집] 섹션별 폼: skill.md ↔ 섹션 값 ──
// 머리말(제목·업무명·산정 유형·표시 단위)과 1·2·4번은 폼으로 고치고, 3번 섹션은 원문 그대로 둔다(수식은 [AI 계산식 빌더]에서).
const META = (label) => new RegExp(String.raw`^[-*][ \t]*${label}[ \t]*:[ \t]*(.*)$`, 'm');
const section = (re, md) => md.match(re)?.[1]?.trim() ?? '';

export function splitSkill(markdown) {
  const md = markdown.replace(/\r\n/g, '\n');
  const firstSection = md.search(/^##\s/m);
  const header = firstSection < 0 ? md : md.slice(0, firstSection);
  return {
    title: md.match(TITLE)?.[1]?.trim() ?? '',
    taskName: header.match(META('업무명'))?.[1]?.trim() ?? '',
    calcType: header.match(META('산정 유형'))?.[1]?.trim() ?? '',
    rateUnit: header.match(META('표시 단위'))?.[1]?.trim() ?? '',
    // 제목·세 항목 말고 머리말에 더 적힌 줄은 그대로 둔다
    headerExtra: header
      .split('\n')
      .filter((l) => l.trim() && !/^#\s/.test(l) && !/^[-*][ \t]*(업무명|산정 유형|표시 단위)[ \t]*:/.test(l))
      .join('\n'),
    summary: section(SUMMARY, md),
    aiGuide: section(AI_GUIDE, md),
    formulaSection: section(FORMULA_SECTION, md),
    // 4번은 자연어(special)와 후처리 스크립트(postprocess)로 나눈다. 스크립트는 [AI 계산식 빌더]에서 만든다
    special: section(SPECIAL, md).replace(POSTPROCESS, '').trim(),
    postprocess: section(SPECIAL, md).match(POSTPROCESS)?.[1]?.trim() ?? '',
  };
}

// 4번 섹션 본문: 자연어 + (있으면) ```postprocess 블록
export const composeSpecial = (special, postprocess) =>
  [special?.trim() ?? '', postprocess?.trim() ? '```postprocess\n' + postprocess.trim() + '\n```' : ''].filter(Boolean).join('\n\n');

const meta = (label, v) => `- ${label}:${v ? ` ${v}` : ''}`;
const block = (heading, body) => (body ? `${heading}\n\n${body}\n` : `${heading}\n`);

// 표준 4섹션 마크다운으로 합친다. 업무명을 바꾸면 "# {업무명} 회비 산정 기준 ({코드})" 제목도 따라 바꾼다
export function composeSkill(parts, taskCode) {
  const m = parts.title.match(/^(.*) 회비 산정 기준 \(([A-Za-z0-9_]+)\)$/);
  const title = m || !parts.title ? `${parts.taskName || m?.[1] || taskCode} 회비 산정 기준 (${m?.[2] ?? taskCode})` : parts.title;
  return [
    `# ${title}\n`,
    [meta('업무명', parts.taskName), meta('산정 유형', parts.calcType), meta('표시 단위', parts.rateUnit), parts.headerExtra]
      .filter(Boolean)
      .join('\n') + '\n',
    block('## 1. 비즈니스 규칙 요약', parts.summary.trim()),
    block('## 2. AI 예외 차감 지침', parts.aiGuide.trim()),
    block('## 3. 정산 수식', parts.formulaSection.trim() || '```formula\n```'),
    block('## 4. 최종 정산 특이사항', composeSpecial(parts.special, parts.postprocess)),
  ].join('\n');
}

// 3번 섹션의 수식 블록을 바꾼다. formulas: { total, equal, perf } (없는 값은 null).
// 블록마다 제자리에서 본문만 바꿔 "### 3-1. 균등분담 수식" 같은 소제목·설명 줄은 그대로 둔다. 필요 없는 블록(분리형 → 단일형이면
// formula:equal/perf, total 이 null 이면 ```formula)은 지우고, 없는 블록은 마지막 수식 블록 뒤(없으면 섹션 앞)에 만든다.
// 섹션이 없으면 "## 3." 제목을 4번 앞(없으면 끝)에 만든다
const ANY_FORMULA_BLOCK = /```formula(?::(equal|perf))?[ \t]*\n[\s\S]*?```[ \t]*\n?/g;
const fenceOf = (kind, body) => '```formula' + (kind === 'total' ? '' : ':' + kind) + '\n' + body.trim() + '\n```\n';
export function formulaBlocks({ total, equal, perf }) {
  return ['equal', 'perf', 'total']
    .filter((k) => ({ total, equal, perf })[k]?.trim())
    .map((k) => fenceOf(k, { total, equal, perf }[k]))
    .join('\n');
}
export function replaceFormulas(markdown, formulas) {
  const md = markdown.replace(/\r\n/g, '\n');
  const want = { total: formulas.total?.trim() || null, equal: formulas.equal?.trim() || null, perf: formulas.perf?.trim() || null };
  const s3 = md.match(/^##\s*3\.[^\n]*$/m);
  if (!s3) {
    const fence = formulaBlocks(want);
    const s4 = md.match(/^##\s*4\.[^\n]*$/m);
    if (s4) return `${md.slice(0, s4.index)}## 3. 정산 수식\n\n${fence}\n${md.slice(s4.index)}`;
    return `${md.trimEnd()}\n\n## 3. 정산 수식\n\n${fence}`;
  }
  const from = s3.index + s3[0].length;
  const next = md.slice(from).search(/^##\s/m);
  const end = next < 0 ? md.length : from + next;
  let body = md.slice(from, end);
  const placed = new Set();
  let lastEnd = -1;
  let firstRemoved = -1;
  let out = '';
  let cursor = 0;
  for (const m of body.matchAll(ANY_FORMULA_BLOCK)) {
    const kind = m[1] ?? 'total';
    out += body.slice(cursor, m.index);
    if (want[kind] && !placed.has(kind)) {
      placed.add(kind);
      out += fenceOf(kind, want[kind]);
      lastEnd = out.length;
    } else if (firstRemoved < 0) {
      firstRemoved = out.length;
    }
    cursor = m.index + m[0].length;
  }
  out += body.slice(cursor);
  const missing = ['equal', 'perf', 'total'].filter((k) => want[k] && !placed.has(k));
  if (missing.length) {
    const add = missing.map((k) => fenceOf(k, want[k])).join('\n');
    if (lastEnd >= 0) out = out.slice(0, lastEnd) + '\n' + add + out.slice(lastEnd);
    else if (firstRemoved >= 0) out = out.slice(0, firstRemoved) + add + out.slice(firstRemoved);
    else out = '\n\n' + add + out.replace(/^\n+/, '\n');
  }
  // 지운 블록 자리에 남은 빈 줄 정리
  body = out.replace(/\n{3,}/g, '\n\n');
  if (next >= 0 && !body.endsWith('\n\n')) body = body.replace(/\n*$/, '\n\n');
  return md.slice(0, from) + body + md.slice(end);
}
export const replaceFormula = (markdown, formula) => replaceFormulas(markdown, { total: formula });

// 4번 섹션의 ```postprocess 블록만 바꾼다(자연어 문장은 그대로). 블록이 없으면 섹션 끝에 만들고, 섹션이 없으면 문서 끝에 만든다.
// script 가 비어 있으면 블록을 지운다
export function replacePostprocess(markdown, script) {
  const md = markdown.replace(/\r\n/g, '\n');
  const s4 = md.match(/^##\s*4\.[^\n]*$/m);
  const fence = script?.trim() ? '```postprocess\n' + script.trim() + '\n```\n' : '';
  if (!s4) return fence ? `${md.trimEnd()}\n\n## 4. 최종 정산 특이사항\n\n${fence}` : md;
  const from = s4.index + s4[0].length;
  const next = md.slice(from).search(/^##\s/m);
  const end = next < 0 ? md.length : from + next;
  const body = md.slice(from, end);
  const special = body.replace(POSTPROCESS, '').replace(/\s+$/, '');
  const newBody = (special.trim() ? special + '\n' : '\n') + (fence ? '\n' + fence : '') + (next < 0 ? '' : '\n');
  return md.slice(0, from) + newBody + md.slice(end);
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

// 수식을 읽어 계산 함수로 만든다. 구문이 틀리면 Error (계산은 하지 않는다: [AI 계산식 빌더]의 구문 검사)
// SpEL 처럼 삼항 연산자는 고른 쪽만, and/or 는 필요한 쪽만 계산한다 (#totalCount == 0 ? 0 : x / #totalCount 가 0 나누기 오류를 내지 않게)
export function compileFormula(formula) {
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
    if (tk.t === 'num') return () => ({ v: tk.v, int: tk.int });
    if (tk.t === 'bool') return () => ({ v: tk.v });
    if (tk.t === 'var') {
      return (vars) => {
        if (!(tk.v in vars)) throw new Error(`알 수 없는 변수입니다: #${tk.v}`);
        return { v: vars[tk.v], int: Number.isInteger(vars[tk.v]) && tk.v !== 'periodScale' };
      };
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
      const f = unary();
      return (vars) => {
        const v = num(f(vars));
        return { v: -v.v, int: v.int };
      };
    }
    if (isOp('!')) {
      i++;
      const f = unary();
      return (vars) => ({ v: !f(vars).v });
    }
    return primary();
  };
  const binary = (next, ops, combine) => () => {
    let a = next();
    while (isOp(...ops)) {
      const op = tokens[i++].v;
      const left = a;
      const right = next();
      a = (vars) => combine(op, left, right, vars);
    }
    return a;
  };
  const mul = binary(unary, ['*', '/', '%'], (op, a, b, vars) => arith(op, a(vars), b(vars)));
  const add = binary(mul, ['+', '-'], (op, a, b, vars) => arith(op, a(vars), b(vars)));
  const rel = () => {
    const a = add();
    if (!isOp('<', '>', '<=', '>=')) return a;
    const op = tokens[i++].v;
    const b = add();
    return (vars) => {
      const x = a(vars).v;
      const y = b(vars).v;
      return { v: op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y };
    };
  };
  const eq = binary(rel, ['==', '!='], (op, a, b, vars) => ({ v: op === '==' ? a(vars).v === b(vars).v : a(vars).v !== b(vars).v }));
  const and = binary(eq, ['&&'], (_, a, b, vars) => ({ v: !!a(vars).v && !!b(vars).v }));
  const or = binary(and, ['||'], (_, a, b, vars) => ({ v: !!a(vars).v || !!b(vars).v }));
  const ternary = () => {
    const c = or();
    if (!isOp('?')) return c;
    i++;
    const a = ternary();
    expect(':');
    const b = ternary();
    return (vars) => (c(vars).v ? a(vars) : b(vars));
  };

  if (!tokens.length) throw new Error('수식이 비어 있습니다.');
  const root = ternary();
  if (i < tokens.length) throw new Error(`수식 끝에 남은 부분이 있습니다: ${tokens[i].v}`);
  return root;
}

export function evaluateFormula(formula, vars) {
  const result = compileFormula(formula)(vars);
  if (typeof result.v !== 'number' || !Number.isFinite(result.v)) throw new Error('수식 결과가 숫자가 아닙니다.');
  if (result.v < 0) throw new Error(`수식 결과가 음수입니다: ${result.v}`);
  return result.v;
}

// 원 → 백만분의 1원(micro) 정수. 정수부와 원 미만(백만분의 1원 단위로 반올림)을 따로 구해 서버 SkillEngineService.toMicro 와 같은 값이 된다
export const MICRO = 1_000_000;
export function toMicro(v) {
  const floor = Math.floor(v);
  const frac = Math.round((v - floor) * MICRO);
  return floor * MICRO + frac;
}

// 균등(참가기관 수) + 실적(인정 건수) 혼합형 수식인지 (서버 SkillEngineService.isMixed 와 같다)
export const isMixed = (formula) => formula.includes('#institutionCount') && formula.includes('#finalCount');

// Step 1 원시값 (서버 SkillEngineService.computeRaw 와 같다): rows [{ baseCount, deduction, finalCount }] →
// { equalMicro[], perfMicro[] } (백만분의 1원 단위 정수, 원 미만 포함). 분리형(formula:equal/perf)이면 각 수식을 그대로 계산하고,
// 단일 수식이면 혼합형일 때 실적이 0일 때의 값(같은 수식에 #rawCount·#deductedCount·#finalCount = 0)을 균등분담분으로 본다(회비보다 크면 회비까지).
// 원 단위 정수화·배분은 4번 후처리 스크립트(postprocess.js)가 한다
export function computeRaw(skill, rows, scale) {
  const totalCount = rows.reduce((s, r) => s + r.finalCount, 0);
  const vars = (r) => ({
    rawCount: r.baseCount,
    deductedCount: r.deduction,
    finalCount: r.finalCount,
    totalCount,
    institutionCount: rows.length,
    periodScale: scale,
  });
  if (isSplit(skill)) {
    return {
      equalMicro: rows.map((r) => toMicro(evaluateFormula(skill.equalFormula, vars(r)))),
      perfMicro: rows.map((r) => toMicro(evaluateFormula(skill.perfFormula, vars(r)))),
    };
  }
  const mixed = isMixed(skill.formula);
  const equalMicro = mixed ? toMicro(evaluateFormula(skill.formula, vars({ baseCount: 0, deduction: 0, finalCount: 0 }))) : 0;
  const equal = [];
  const perf = [];
  rows.forEach((r) => {
    const fee = toMicro(evaluateFormula(skill.formula, vars(r)));
    const e = Math.min(equalMicro, fee);
    equal.push(e);
    perf.push(fee - e);
  });
  return { equalMicro: equal, perfMicro: perf };
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

// ── 업무 목록: 업무 1개 = md 파일 1개 (서버 SkillFileService 의 tasks.json 과 같은 모양) ──
export const businessIdOf = (taskCode) => Object.keys(TASK_CODES).find((id) => TASK_CODES[id] === taskCode);

// 기본 제공 업무 (초기 기준 skill.md 가 있다)
export const builtInTasks = (businesses) =>
  businesses.map((b) => ({
    taskCode: TASK_CODES[b.id],
    businessId: b.id,
    name: b.name,
    fileName: `${TASK_CODES[b.id]}.md`,
    builtIn: true,
    createdAt: null,
    createdBy: null,
  }));

// 새로 추가한 업무의 skill.md: 기본 템플릿에서 반드시 있어야 하는 뼈대만
// (# 제목, 업무명·산정 유형·표시 단위, ## 1~4 섹션 제목, 빈 formula 블록). 서버 SkillFileService.skeletonTemplate 과 같다
export const skeletonTemplate = (task) =>
  [
    `# ${task.name} 회비 산정 기준 (${task.taskCode})`,
    '',
    `- 업무명: ${task.name}`,
    '- 산정 유형:',
    '- 표시 단위:',
    '',
    '## 1. 비즈니스 규칙 요약',
    '',
    '## 2. AI 예외 차감 지침',
    '',
    '## 3. 정산 수식',
    '',
    '```formula',
    '```',
    '',
    '## 4. 최종 정산 특이사항',
    '',
  ].join('\n');

const defaultContent = (task) => (task.builtIn ? DEFAULT_SKILLS[task.taskCode] : skeletonTemplate(task));
const contentOf = (task, overrides) => overrides[task.taskCode]?.content ?? defaultContent(task);
const isReady = (task, content) => {
  try {
    parseSkill(task.taskCode, content);
    return true;
  } catch {
    return false;
  }
};

// 업무 추가 입력 검사 (서버 SkillFileService.create 와 같은 규칙). 문제가 있으면 Error, 통과하면 정리한 값
const NEW_CODE = /^[A-Z][A-Z0-9_]{1,29}$/;
const FILE_BASE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/;
export function checkNewTask(tasks, form) {
  const taskCode = form.taskCode.trim().toUpperCase();
  const name = form.name.trim();
  if (!NEW_CODE.test(taskCode)) {
    throw Object.assign(new Error('업무 코드는 영문 대문자로 시작하는 영문 대문자·숫자·밑줄(_) 2~30자로 입력해 주세요.'), { field: 'taskCode' });
  }
  if (!name || name.length > 50) throw Object.assign(new Error('업무명은 1~50자로 입력해 주세요.'), { field: 'name' });
  const base = (form.fileName.trim() || taskCode).replace(/\.md$/i, '');
  if (!FILE_BASE.test(base)) {
    throw Object.assign(
      new Error('md 파일명은 영문·숫자로 시작하는 영문·숫자·밑줄(_)·하이픈(-) 50자 이하로 입력해 주세요. (예: NEW_TASK.md)'),
      { field: 'fileName' },
    );
  }
  const fileName = `${base}.md`;
  const businessId = taskCode.toLowerCase();
  for (const t of tasks) {
    if (t.taskCode === taskCode || t.businessId.toLowerCase() === businessId) {
      throw Object.assign(new Error(`이미 있는 업무 코드입니다: ${taskCode}`), { field: 'taskCode' });
    }
    if (t.name === name) throw Object.assign(new Error(`이미 있는 업무명입니다: ${name}`), { field: 'name' });
    if (t.fileName.toLowerCase() === fileName.toLowerCase()) {
      throw Object.assign(
        new Error(`${fileName} 파일은 이미 ${t.name} 업무에 연결되어 있습니다. 한 파일은 한 업무에만 연결할 수 있습니다.`),
        { field: 'fileName' },
      );
    }
  }
  return { taskCode, businessId, name, fileName };
}

// ── 서버가 없을 때(Mock): 업무 목록 + 화면에서 고친 내용(overrides)으로 서버 API와 같은 모양을 만든다 ──
export function localTaskList(tasks, overrides, members) {
  return tasks.map((t) => {
    const content = contentOf(t, overrides);
    return {
      ...t,
      lastModified: overrides[t.taskCode]?.lastModified ?? t.createdAt,
      size: new Blob([content]).size,
      ready: isReady(t, content),
      memberCount: members.filter((m) => m.role === 'operator' && m.tasks.includes(t.businessId)).length,
    };
  });
}

export function localSkillList(tasks, allowedTasks, overrides) {
  return tasks.map((t) => {
    const content = contentOf(t, overrides);
    return {
      taskCode: t.taskCode,
      taskName: t.name,
      businessId: t.businessId,
      fileName: t.fileName,
      accessible: allowedTasks.includes(t.businessId),
      lastModified: overrides[t.taskCode]?.lastModified ?? t.createdAt,
      size: new Blob([content]).size,
      modified: content !== defaultContent(t),
    };
  });
}

// 섹션이 덜 채워진 파일(막 추가한 업무)도 열 수 있게 parseError 로 알려 준다 (서버 SkillDetailResponse 와 같다)
export function localSkillDetail(task, overrides) {
  const code = task.taskCode;
  const content = contentOf(task, overrides);
  let parsed;
  let parseError = null;
  try {
    parsed = parseSkill(code, content);
  } catch (e) {
    parseError = e.message;
    parsed = { taskCode: code, formula: '', equalFormula: null, perfFormula: null, postprocess: '', summary: [], aiGuide: '', specialRules: [], specialRulesRaw: '', calcType: '', rateUnit: '' };
  }
  return {
    ...parsed,
    taskName: task.name,
    businessId: task.businessId,
    fileName: task.fileName,
    content,
    parseError,
    lastModified: overrides[code]?.lastModified ?? task.createdAt,
    updatedBy: overrides[code]?.updatedBy ?? task.createdBy,
    size: new Blob([content]).size,
    modified: content !== defaultContent(task),
  };
}

// 저장 전 검증(서버 SkillFileService.save → SkillEngineService.validateSkill 과 같은 순서): 섹션(1·3번 필수) → 수식 구문 →
// 시험 계산 2벌(총액 수식 또는 균등·실적 분리 수식) → 4번 후처리 스크립트 문법 + 시험 실행 2벌. 실패하면 Error
export const FORMULA_SAMPLES = [
  { rawCount: 1_000_000, deductedCount: 100_000, finalCount: 900_000, totalCount: 9_000_000, institutionCount: 8, periodScale: 1 },
  { rawCount: 0, deductedCount: 0, finalCount: 0, totalCount: 0, institutionCount: 8, periodScale: 0.5 },
];

export function validateFormula(formula) {
  try {
    FORMULA_SAMPLES.forEach((v) => evaluateFormula(formula, v));
  } catch (e) {
    const err = new Error(`수식(formula) 구문 오류가 발견되었습니다. (${e.message})`);
    err.formula = true;
    throw err;
  }
}

export function validateSkill(taskCode, content) {
  const parsed = parseSkill(taskCode, content);
  if (isSplit(parsed)) {
    validateFormula(parsed.equalFormula);
    validateFormula(parsed.perfFormula);
  } else {
    validateFormula(parsed.formula);
  }
  if (parsed.postprocess) trialScript(parsed.postprocess);
  return parsed;
}
