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
const VARIABLES_BLOCK = /```variables[ \t]*\n([\s\S]*?)```/;
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

// 서버 SkillEngineService.parse 와 같은 규칙. 1번 요약이 없으면 Error, 2번·4번은 선택.
// 3번 수식이 비어 있으면(초안) formula 를 ''로 두고 통과시킨다 — 저장해 두고 빌더에서 채울 수 있게. 산출은 computeRaw 가 막는다
export function parseSkill(taskCode, markdown) {
  const md = markdown.replace(/\r\n/g, '\n');
  const summaryText = md.match(SUMMARY)?.[1]?.trim();
  if (!summaryText) throw new Error("'## 1. 비즈니스 규칙 요약' 섹션을 찾을 수 없습니다.");
  // "## 3." 섹션이 있으면 그 안의 ```formula 블록만 (4번 특이사항에 코드 블록이 있어도 수식으로 읽지 않게)
  const section3 = md.match(FORMULA_SECTION)?.[1];
  const f = formulas(section3 ?? md);
  const vars = variablesIn(section3 ?? md);
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
    // 서버 SkillDetailResponse 와 같은 모양: variables = ```variables 블록 원문(없으면 ''), variableList = 해석한 변수, inputs = 실적 입력 변수
    variables: vars.text,
    variableList: vars.definitions.map(variableInfo),
    inputs: inputsOf(vars).map(variableInfo),
    postprocess,
    specialRulesRaw,
    specialRules: lines(specialRulesRaw),
    markdown: md,
  };
}

export const MAX_FORMULA_LENGTH = 2000;
export const isSplit = (skill) => skill.equalFormula != null;
// 3번 수식을 아직 안 쓴 초안이면 false (서버 ParsedSkill.hasFormula 와 같다)
export const hasFormula = (skill) => !!skill.formula?.trim();
export const FORMULA_MISSING =
  "'## 3. 정산 수식'이 아직 비어 있습니다. [AI 계산식 빌더]나 기준 문서 편집의 수식 생성으로 수식을 만들어 저장한 뒤 산출해 주세요.";

// 3번 섹션의 수식 블록들 (서버 SkillEngineService.formulas 와 같다). total 은 수식이 있으면 늘 있고(분리형이면 "(균등) + (실적)" 표시용),
// equal·perf 는 ```formula:equal / ```formula:perf 분리형일 때만. 블록이 없거나 비어 있으면(분리형은 균등·실적 중 하나라도)
// 수식 미작성 초안으로 { total: '', equal: null, perf: null }. 분리 블록이 한쪽만 있는 구조 오류만 Error
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
  if (equal != null ? !equal || !perf : !total) return { total: '', equal: null, perf: null };
  if (!total) total = `(${equal}) + (${perf})`;
  return { total, equal, perf };
}

// ── 3번 ```variables 변수 정의 (서버 SkillVariables 와 같은 규칙) ──
// 한 줄에 하나씩 `이름 = 값`. 값은 input("엑셀 열 설명")(기관별 실적 입력) · sum(#기관별변수)(전 기관 합계) · 숫자(상수) · 수식(앞에서 정의한 변수로).
// 기관별 값(input 또는 기관별 값을 쓰는 수식)과 공통값(상수·sum·공통 수식)으로 나뉜다. rawCount(기준 실적)를 정의하면 그 값에서
// 차감(deductedCount)·인정 건수(finalCount)·합계(totalCount)를 엔진이 만든다. rawCount 를 안 쓰면 input 이 하나일 때 그 값으로 보충한다.
export const RAW_COUNT = 'rawCount';
export const RESERVED = ['deductedCount', 'finalCount', 'totalCount', 'institutionCount', 'periodScale'];
const RESERVED_PER_INSTITUTION = ['rawCount', 'deductedCount', 'finalCount'];
export const DEFAULT_INPUT_LABEL = '기본 건수';
export const MAX_VARIABLES_LENGTH = 6000;
const MAX_VARIABLE_LINES = 30;
const MAX_VARIABLE_LINE_LENGTH = 300;
const MAX_INPUTS = 10;
const MAX_LABEL_LENGTH = 100;
const VAR_LINE = /^([^\s=]+)\s*=\s*(.+?)\s*$/;
const VAR_NAME = /^[a-z][A-Za-z0-9]{0,39}$/;
const INPUT_RE = /^input\(\s*(?:"([^"]*)"|'([^']*)')\s*\)$/;
const SUM_RE = /^sum\(\s*#?([A-Za-z_]\w*)\s*\)$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const REF_RE = /#([A-Za-z_]\w*)/g;

// 수식·변수 식 안에서 참조한 변수 이름 (등장 순서, 중복 없이)
export const referenced = (expr) => [...new Set([...String(expr ?? '').matchAll(REF_RE)].map((m) => m[1]))];

const typed = (v, int) => ({ v, int });
export const LEGACY_VARIABLES = Object.freeze({
  text: '',
  hasBlock: false,
  definitions: [{ name: RAW_COUNT, kind: 'INPUT', label: DEFAULT_INPUT_LABEL, expr: null, perInstitution: true, line: 0 }],
});
export const variableInfo = (d) => ({ name: d.name, kind: d.kind, label: d.label, expr: d.expr, perInstitution: d.perInstitution, auto: d.line === 0 });
export const inputsOf = (vars) => vars.definitions.filter((d) => d.kind === 'INPUT');
// 수식에서 쓸 수 있는 모든 변수 이름 (정의 + 예약)
export const variableNames = (vars) => [...new Set([...vars.definitions.map((d) => d.name), ...RESERVED])];
const perInstitutionNames = (vars) => new Set([...RESERVED_PER_INSTITUTION, ...vars.definitions.filter((d) => d.perInstitution).map((d) => d.name)]);
// 블록에 적는 한 줄 (서버 Definition.text 와 같다)
export const definitionText = (d) => (d.kind === 'INPUT' ? `${d.name} = input("${d.label}")` : d.kind === 'SUM' ? `${d.name} = sum(#${d.expr})` : `${d.name} = ${d.expr}`);

const varError = (line, message) => new Error(`변수 정의 ${line > 0 ? `${line}행: ` : ''}${message}`);

// 블록 본문 → { text, hasBlock, definitions[] }. null 이면 블록이 없는 예전 문서(rawCount 하나). 문법·순서·이름 규칙에 어긋나면 Error
export function parseVariables(block) {
  if (block == null) return LEGACY_VARIABLES;
  const normalized = block.replace(/\r\n/g, '\n').trim();
  const defs = [];
  const seen = new Set();
  const rows = normalized ? normalized.split('\n') : [];
  const find = (name) => defs.find((d) => d.name === name);
  const perInstOf = (ref) => {
    const source = find(ref);
    return source ? source.perInstitution : RESERVED_PER_INSTITUTION.includes(ref);
  };
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].trim();
    const no = i + 1;
    if (!row || row.startsWith('#') || row.startsWith('//')) continue;
    if (++count > MAX_VARIABLE_LINES) throw varError(no, `변수는 ${MAX_VARIABLE_LINES}개 이하로 정의해 주세요.`);
    if (row.length > MAX_VARIABLE_LINE_LENGTH) throw varError(no, `한 줄은 ${MAX_VARIABLE_LINE_LENGTH}자 이하로 적어 주세요.`);
    const m = row.match(VAR_LINE);
    if (!m) throw varError(no, `'이름 = 값' 형식이 아닙니다: ${row}`);
    const [, name, value] = m;
    if (!VAR_NAME.test(name)) throw varError(no, `변수 이름은 영문 소문자로 시작하는 영문·숫자(camelCase) 40자 이하여야 합니다: ${name}`);
    if (RESERVED.includes(name)) throw varError(no, `'${name}'은(는) 엔진이 정하는 예약 변수라 정의할 수 없습니다.`);
    if (seen.has(name)) throw varError(no, `변수 '${name}'이(가) 두 번 정의됐습니다.`);
    seen.add(name);
    const input = value.match(INPUT_RE);
    const sum = value.match(SUM_RE);
    if (input) {
      const label = (input[1] ?? input[2]).trim();
      if (!label) throw varError(no, 'input("설명")의 설명을 적어 주세요 (엑셀 열을 찾는 데 씁니다).');
      if (label.length > MAX_LABEL_LENGTH) throw varError(no, `input 설명은 ${MAX_LABEL_LENGTH}자 이하로 적어 주세요.`);
      defs.push({ name, kind: 'INPUT', label, expr: null, perInstitution: true, line: no });
    } else if (sum) {
      const src = sum[1];
      if (!find(src) && !RESERVED.includes(src) && src !== RAW_COUNT) throw varError(no, `sum(#${src})의 대상 변수가 앞에서 정의되지 않았습니다.`);
      if (!perInstOf(src)) throw varError(no, `sum()은 기관별 값(input 또는 기관별 수식)만 합칠 수 있습니다: #${src}`);
      if (name === RAW_COUNT) throw varError(no, 'rawCount 는 기관별 값이어야 합니다 (input 또는 input 을 쓰는 수식).');
      defs.push({ name, kind: 'SUM', label: null, expr: src, perInstitution: false, line: no });
    } else if (NUMBER_RE.test(value)) {
      if (name === RAW_COUNT) throw varError(no, 'rawCount 는 기관별 값이어야 합니다 (input 또는 input 을 쓰는 수식).');
      defs.push({ name, kind: 'NUMBER', label: null, expr: value, perInstitution: false, line: no });
    } else {
      try {
        compileFormula(value);
      } catch (e) {
        throw varError(no, `수식 구문 오류: ${e.message}`);
      }
      let perInst = false;
      for (const ref of referenced(value)) {
        if (ref === name) throw varError(no, `변수 '${name}'이(가) 자기 자신을 참조합니다.`);
        if (!find(ref) && !RESERVED.includes(ref) && ref !== RAW_COUNT) {
          throw varError(no, `#${ref} 은(는) 앞에서 정의되지 않은 변수입니다 (변수는 위에서 아래 순서로 정의합니다).`);
        }
        if (perInstOf(ref)) perInst = true;
      }
      if (name === RAW_COUNT && !perInst) throw varError(no, 'rawCount 는 기관별 값이어야 합니다 (input 또는 input 을 쓰는 수식).');
      defs.push({ name, kind: 'EXPR', label: null, expr: value, perInstitution: perInst, line: no });
    }
  }
  const inputs = defs.filter((d) => d.kind === 'INPUT');
  if (inputs.length > MAX_INPUTS) throw new Error(`변수 정의: 실적 입력(input)은 ${MAX_INPUTS}개 이하여야 합니다.`);
  if (!defs.some((d) => d.name === RAW_COUNT)) {
    if (inputs.length === 0) {
      defs.unshift({ name: RAW_COUNT, kind: 'INPUT', label: DEFAULT_INPUT_LABEL, expr: null, perInstitution: true, line: 0 });
    } else if (inputs.length === 1) {
      defs.splice(defs.indexOf(inputs[0]) + 1, 0, { name: RAW_COUNT, kind: 'EXPR', label: null, expr: `#${inputs[0].name}`, perInstitution: true, line: 0 });
    } else {
      throw new Error(
        `변수 정의: 실적 입력(input)이 2개 이상이면 기준 실적 rawCount 를 정의해 주세요 (예: rawCount = #${inputs[0].name} + #${inputs[1].name}).`,
      );
    }
  }
  // rawCount 보다 앞줄에서는 차감·인정 건수·합계를 쓸 수 없다
  let rawAt = -1;
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    if (d.name === RAW_COUNT) {
      rawAt = i;
      for (const ref of referenced(d.expr ?? '')) {
        if (['deductedCount', 'finalCount', 'totalCount'].includes(ref)) {
          throw varError(d.line, `rawCount 정의에는 #${ref} 을(를) 쓸 수 없습니다 (차감은 rawCount 가 정해진 뒤 계산합니다).`);
        }
      }
      continue;
    }
    if (rawAt >= 0) continue;
    const src = d.kind === 'SUM' ? `#${d.expr}` : d.kind === 'EXPR' ? d.expr : '';
    for (const ref of referenced(src)) {
      if (RESERVED_PER_INSTITUTION.includes(ref) || ref === 'totalCount') {
        throw varError(d.line, `#${ref} 은(는) rawCount 를 정의한 줄보다 뒤에서만 쓸 수 있습니다.`);
      }
    }
  }
  return { text: normalized, hasBlock: true, definitions: defs };
}

// 3번 섹션의 ```variables 블록 (서버 SkillEngineService.variables 와 같다)
export function variablesIn(section3) {
  const m = section3.match(VARIABLES_BLOCK);
  if (!m) return LEGACY_VARIABLES;
  if (m[1].length > MAX_VARIABLES_LENGTH) throw new Error(`변수 정의는 ${MAX_VARIABLES_LENGTH.toLocaleString('ko-KR')}자 이하로 작성해 주세요.`);
  return parseVariables(m[1]);
}

// 해석 결과(parseSkill·서버 응답)의 variables 원문 → 변수 정의. 블록이 없는 예전 문서('')는 rawCount 하나
export const variablesOf = (skill) => (skill.variables ? parseVariables(skill.variables) : LEGACY_VARIABLES);
export const skillInputs = (skill) => inputsOf(variablesOf(skill)).map(variableInfo);

// 수식이 정의되지 않은 변수를 쓰면 Error (서버 SkillVariables.checkFormula)
export function checkFormulaVariables(vars, formula) {
  const allowed = variableNames(vars);
  const unknown = referenced(formula).filter((r) => !allowed.includes(r)).map((r) => `#${r}`);
  if (unknown.length) {
    throw new Error(`수식에 정의되지 않은 변수가 있습니다: ${unknown.join(', ')} (쓸 수 있는 변수: ${allowed.map((n) => `#${n}`).join(', ')})`);
  }
}

// 균등(참가기관 수) + 실적(기관별 값) 혼합형 수식인지 (서버 SkillVariables.isMixed)
export function isMixedWith(vars, formula) {
  const refs = referenced(formula);
  if (!refs.includes('institutionCount')) return false;
  const per = perInstitutionNames(vars);
  return refs.some((r) => per.has(r));
}
export const isMixed = (formula) => isMixedWith(LEGACY_VARIABLES, formula);

function evaluateRaw(def, ctx) {
  let r;
  try {
    r = compileFormula(def.expr)(ctx);
  } catch (e) {
    throw new Error(`변수 '${def.name}'을(를) 계산할 수 없습니다: ${e.message}`);
  }
  if (typeof r.v !== 'number') throw new Error(`변수 '${def.name}'의 값이 숫자가 아닙니다: ${r.v}`);
  if (!Number.isFinite(r.v)) throw new Error(`변수 '${def.name}'의 값이 숫자가 아닙니다(0으로 나누기 등).`);
  return typed(r.v, !!r.int);
}
function toCount(x) {
  if (typeof x?.v !== 'number') throw new Error(`rawCount 값이 숫자가 아닙니다: ${x?.v}`);
  const d = Math.round(x.v);
  if (d < 0) throw new Error(`rawCount 값이 음수입니다: ${d}`);
  return d;
}

// 모든 기관의 변수를 정의 순서대로 계산한다 (서버 SkillVariables.bind). rows: [{ inputs: { 변수: 값 }, deductedCount }].
// 입력에 없는 실적 항목은 0, 음수는 0. rawCount 줄을 지나면 deductedCount(rawCount 를 넘지 않게)·finalCount·totalCount 를 넣는다.
// 값은 { v, int }(정수 여부를 들고 있어 SpEL 처럼 정수 나눗셈이 되게)이며, contexts[i] 는 기관 i 의 수식 변수(공통값 포함)
export function bindVariables(vars, rows, periodScale) {
  const n = rows.length;
  const globals = { institutionCount: typed(n, true), periodScale: typed(periodScale, false) };
  const contexts = rows.map(() => ({}));
  const rawCount = [];
  const deducted = [];
  const finalCount = [];
  let totalCount = 0;
  const rawIndex = vars.definitions.findIndex((d) => d.name === RAW_COUNT);
  vars.definitions.forEach((def, d) => {
    if (def.kind === 'INPUT') {
      rows.forEach((r, i) => {
        const v = r.inputs?.[def.name];
        contexts[i][def.name] = typed(v == null ? 0 : Math.max(0, Number(v) || 0), true);
      });
    } else if (def.kind === 'NUMBER') {
      globals[def.name] = typed(Number(def.expr), !def.expr.includes('.'));
    } else if (def.kind === 'SUM') {
      let int = true;
      let sum = 0;
      rows.forEach((_, i) => {
        const x = contexts[i][def.expr] ?? typed(0, true);
        if (!x.int) int = false;
        sum += x.v;
      });
      globals[def.name] = typed(sum, int);
    } else if (def.perInstitution) {
      rows.forEach((_, i) => {
        contexts[i][def.name] = evaluateRaw(def, { ...globals, ...contexts[i] });
      });
    } else {
      globals[def.name] = evaluateRaw(def, globals);
    }
    if (d === rawIndex) {
      rows.forEach((r, i) => {
        rawCount[i] = toCount(contexts[i][RAW_COUNT]);
        deducted[i] = Math.min(Math.max(0, Number(r.deductedCount) || 0), rawCount[i]);
        finalCount[i] = rawCount[i] - deducted[i];
        totalCount += finalCount[i];
        contexts[i].rawCount = typed(rawCount[i], true);
        contexts[i].deductedCount = typed(deducted[i], true);
        contexts[i].finalCount = typed(finalCount[i], true);
      });
      globals.totalCount = typed(totalCount, true);
    }
  });
  return { contexts: contexts.map((c) => ({ ...globals, ...c })), globals, rawCount, deducted, finalCount, totalCount };
}

// 실적이 0 인 가상의 기관 변수(기관별 값은 모두 0, 공통값은 실제 계산값): 혼합형 단일 수식의 균등분담분
export function zeroContext(vars, bound) {
  const ctx = {};
  for (const def of vars.definitions) {
    if (!def.perInstitution) continue;
    ctx[def.name] = def.kind === 'INPUT' ? typed(0, true) : evaluateRaw(def, { ...bound.globals, ...ctx });
    if (def.name === RAW_COUNT) {
      ctx.rawCount = typed(0, true);
      ctx.deductedCount = typed(0, true);
      ctx.finalCount = typed(0, true);
    }
  }
  return { ...bound.globals, ...ctx };
}

// 화면 표시용: { v, int } → 숫자
export const plainValues = (ctx) => Object.fromEntries(Object.entries(ctx).map(([k, x]) => [k, x?.v ?? x]));

// 실적 입력이 하나뿐인 기준인지 (아니면 실적 항목별 입력이 필요하다). 서버 SkillEngineService.requireSingleInput 와 같은 문구
export function requireSingleInput(vars) {
  const ins = inputsOf(vars);
  if (ins.length !== 1) {
    throw new Error(
      `이 업무는 실적 항목 ${ins.length}개(${ins.map((d) => d.label).join(', ')})를 각각 입력해야 합니다. 실적 엑셀을 올려 항목별 열을 연결한 뒤 산출해 주세요.`,
    );
  }
  return ins[0];
}

// 기관 8곳 시험 계산용 입력 (서버 SkillVariables.sampleRows). 첫 기관 차감 10만 건 → 최종 90만 건, 전체 900만 건.
// 입력이 여러 개면 기본 실적을 1:2:3… 비율로 나눠 넣는다. zero 면 모두 0
export const SAMPLE_RAW = [1_000_000, 1_200_000, 1_200_000, 1_200_000, 1_200_000, 1_100_000, 1_100_000, 1_100_000];
export const SAMPLE_DEDUCTED = [100_000, 0, 0, 0, 0, 0, 0, 0];
export const SAMPLE_SCALE = { normal: 1, zero: 0.5 };
export function sampleRows(vars, zero = false) {
  const ins = inputsOf(vars);
  const m = ins.length;
  const weightSum = (m * (m + 1)) / 2;
  return SAMPLE_RAW.map((raw, i) => ({
    inputs: Object.fromEntries(ins.map((d, k) => [d.name, zero ? 0 : m === 1 ? raw : Math.round((raw * (k + 1)) / weightSum)])),
    deductedCount: zero ? 0 : SAMPLE_DEDUCTED[i],
  }));
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

// 3번 섹션의 ```variables 블록만 바꾼다 (수식 블록·설명 줄은 그대로). 블록이 없으면 첫 수식 블록 앞(없으면 섹션 앞)에 만들고,
// block 이 비어 있으면 블록을 지운다. 섹션이 없으면 "## 3." 제목을 4번 앞(없으면 끝)에 만든다
const ANY_VARIABLES_BLOCK = /```variables[ \t]*\n[\s\S]*?```[ \t]*\n?/;
export function replaceVariables(markdown, block) {
  const md = markdown.replace(/\r\n/g, '\n');
  const fence = block?.trim() ? '```variables\n' + block.trim() + '\n```\n' : '';
  const s3 = md.match(/^##\s*3\.[^\n]*$/m);
  if (!s3) {
    if (!fence) return md;
    const s4 = md.match(/^##\s*4\.[^\n]*$/m);
    if (s4) return `${md.slice(0, s4.index)}## 3. 정산 수식\n\n${fence}\n${md.slice(s4.index)}`;
    return `${md.trimEnd()}\n\n## 3. 정산 수식\n\n${fence}`;
  }
  const from = s3.index + s3[0].length;
  const next = md.slice(from).search(/^##\s/m);
  const end = next < 0 ? md.length : from + next;
  let body = md.slice(from, end);
  const m = body.match(ANY_VARIABLES_BLOCK);
  if (m) body = body.slice(0, m.index) + fence + body.slice(m.index + m[0].length);
  else if (fence) {
    const f = body.search(/```formula/);
    body = f >= 0 ? body.slice(0, f) + fence + '\n' + body.slice(f) : '\n\n' + fence + body.replace(/^\n+/, '\n');
  }
  body = body.replace(/\n{3,}/g, '\n\n');
  if (next >= 0 && !body.endsWith('\n\n')) body = body.replace(/\n*$/, '\n\n');
  return md.slice(0, from) + body + md.slice(end);
}

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
        const x = vars[tk.v];
        // bindVariables 가 만든 { v, int } 값이면 정수 여부를 그대로 쓴다 (SpEL 의 Long/Double 구분과 같게)
        if (x !== null && typeof x === 'object' && 'v' in x) return { v: x.v, int: !!x.int };
        return { v: x, int: Number.isInteger(x) && tk.v !== 'periodScale' };
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

// 산출 행 → 변수 계산 입력. { inputs, deductedCount }(실적 항목별 값) 또는 예전 모양 { baseCount, deduction }(입력이 하나인 기준에서만)
function toRow(vars, r) {
  if (r.inputs && inputsOf(vars).some((d) => d.name in r.inputs)) return { inputs: r.inputs, deductedCount: r.deductedCount ?? r.deduction ?? 0 };
  const only = requireSingleInput(vars);
  return { inputs: { [only.name]: r.baseCount ?? r.rawCount ?? 0 }, deductedCount: r.deductedCount ?? r.deduction ?? 0 };
}

// Step 1 원시값 (서버 SkillEngineService.computeRaw 와 같다): rows [{ inputs: { 변수: 값 }, deductedCount }] →
// { equalMicro[], perfMicro[], bound } (백만분의 1원 단위 정수, 원 미만 포함. bound 는 변수 계산 결과: rawCount·deducted·finalCount·contexts).
// 3번 변수 정의로 기관별 변수를 계산한 뒤, 분리형(formula:equal/perf)이면 각 수식을 그대로 계산하고,
// 단일 수식이면 #institutionCount 와 기관별 변수를 함께 쓸 때 실적이 0 인 가상 기관의 값(기관별 변수 모두 0)을 균등분담분으로 본다(회비보다 크면 회비까지).
// 원 단위 정수화·배분은 4번 후처리 스크립트(postprocess.js)가 한다
export function computeRaw(skill, rows, scale) {
  if (!hasFormula(skill)) throw new Error(FORMULA_MISSING);
  const vars = variablesOf(skill);
  const bound = bindVariables(vars, rows.map((r) => toRow(vars, r)), scale);
  if (isSplit(skill)) {
    return {
      equalMicro: bound.contexts.map((c) => toMicro(evaluateFormula(skill.equalFormula, c))),
      perfMicro: bound.contexts.map((c) => toMicro(evaluateFormula(skill.perfFormula, c))),
      bound,
    };
  }
  const equalMicro = isMixedWith(vars, skill.formula) ? toMicro(evaluateFormula(skill.formula, zeroContext(vars, bound))) : 0;
  const equal = [];
  const perf = [];
  bound.contexts.forEach((c) => {
    const fee = toMicro(evaluateFormula(skill.formula, c));
    const e = Math.min(equalMicro, fee);
    equal.push(e);
    perf.push(fee - e);
  });
  return { equalMicro: equal, perfMicro: perf, bound };
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

// 회비 산출·권한 화면의 업무 목록 = 업무 관리 목록(tasks). 기본 업무는 BUSINESSES 정보(시연 실적·단가)를 쓰고,
// 업무 관리에서 추가한 업무는 업무명만 있어(method 없음) 업로드한 실적과 skill.md 로만 산출한다
export const taskBusinesses = (tasks, businesses) =>
  tasks.map((t) => ({
    ...(businesses.find((b) => b.id === t.businessId) ?? {
      id: t.businessId,
      name: t.name,
      method: null,
      revenueAccount: `회비수입-${t.name}`,
      summary: [],
    }),
    name: t.name,
    task: t,
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
    // 수식 미작성 초안도 저장은 되지만 산출 기준으로는 아직 작성 필요
    return hasFormula(parseSkill(task.taskCode, content));
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
    if (!hasFormula(parsed)) parseError = FORMULA_MISSING;
  } catch (e) {
    parseError = e.message;
    parsed = { taskCode: code, formula: '', equalFormula: null, perfFormula: null, variables: '', variableList: [], inputs: [], postprocess: '', summary: [], aiGuide: '', specialRules: [], specialRulesRaw: '', calcType: '', rateUnit: '' };
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

// 저장 전 검증(서버 SkillFileService.save → SkillEngineService.validateSkill 과 같은 순서): 섹션(1번 필수) → 변수 정의 → 수식 구문·변수 →
// 기관 8곳 시험 계산 2벌(정상 · 실적 0, 총액 수식 또는 균등·실적 분리 수식) → 4번 후처리 스크립트 문법 + 시험 실행 2벌. 실패하면 Error
// 수식 하나를 변수 정의와 함께 검사한다. 돌려주는 값은 두 벌의 첫 기관 결과(원) [정상, 실적 0]
export function validateFormula(formula, vars = LEGACY_VARIABLES) {
  try {
    if (!formula?.trim()) throw new Error('수식이 비어 있습니다.');
    if (formula.length > MAX_FORMULA_LENGTH) throw new Error(`수식은 ${MAX_FORMULA_LENGTH.toLocaleString('ko-KR')}자 이하로 작성해 주세요.`);
    compileFormula(formula);
    checkFormulaVariables(vars, formula);
    return [false, true].map((zero) => {
      const bound = bindVariables(vars, sampleRows(vars, zero), zero ? SAMPLE_SCALE.zero : SAMPLE_SCALE.normal);
      const first = bound.contexts.map((c) => evaluateFormula(formula, c))[0];
      if (isMixedWith(vars, formula)) evaluateFormula(formula, zeroContext(vars, bound));
      return first;
    });
  } catch (e) {
    const err = new Error(`수식(formula) 구문 오류가 발견되었습니다. (${e.message})`);
    err.formula = true;
    throw err;
  }
}

export function validateSkill(taskCode, content) {
  const parsed = parseSkill(taskCode, content);
  const vars = variablesOf(parsed);
  // 수식 미작성 초안은 저장을 허용하고 산출 때 막는다
  if (isSplit(parsed)) {
    validateFormula(parsed.equalFormula, vars);
    validateFormula(parsed.perfFormula, vars);
  } else if (hasFormula(parsed)) {
    validateFormula(parsed.formula, vars);
  }
  if (parsed.postprocess) trialScript(parsed.postprocess);
  return parsed;
}
