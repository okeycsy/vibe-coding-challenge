import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Calculator, CircleCheck, CircleX, FileText, LoaderCircle, Sparkles, TriangleAlert, WandSparkles } from 'lucide-react';
import { api, apiEnabled } from '../utils/api';
import { AiStatusLine, SOURCE_LABEL, SourceNote } from './AiStatus';
import { fmt } from '../utils/fee';
import { generateFormulaLocally } from '../utils/formulaGenerator';
import { FORMULA_SAMPLES, MAX_FORMULA_LENGTH, compileFormula, evaluateFormula, lines, parseSkill, replaceFormulas, splitSkill } from '../utils/skill';
import SkillPostprocessBuilder from './SkillPostprocessBuilder';

const VARIABLES = [
  { name: '#finalCount', desc: '최종 인정 건수' },
  { name: '#totalCount', desc: '전체 기관 인정 건수 합계' },
  { name: '#institutionCount', desc: '참가기관 수' },
  { name: '#periodScale', desc: '기간 환산 비율 (분기 = 1)' },
  { name: '#rawCount', desc: '기본 건수' },
  { name: '#deductedCount', desc: 'AI 차감 건수' },
];
const SIM_FIELDS = [
  { key: 'rawCount', label: '기본건수' },
  { key: 'deductedCount', label: '차감건수' },
  { key: 'totalCount', label: '전체건수(모든 기관 인정 합계)' },
  { key: 'institutionCount', label: '기관수' },
  { key: 'periodScale', label: '기간비율(분기 = 1)', step: 0.01 },
];

export const Card = ({ no, title, icon: Icon, children, right }) => (
  <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
    <div className="flex items-center gap-2.5 px-5 py-3 border-b border-slate-100">
      <span className="rounded-md bg-violet-600 text-white text-[11px] font-bold px-2 py-0.5">Panel {no}</span>
      <Icon className="w-4 h-4 text-violet-500" />
      <h3 className="font-semibold text-brand-900">{title}</h3>
      <div className="ml-auto">{right}</div>
    </div>
    <div className="p-5">{children}</div>
  </section>
);

const TABS = [
  { id: 'formula', label: '3번 정산 수식', desc: '1번 규칙으로 정산 수식 생성' },
  { id: 'postprocess', label: '4번 후처리 스크립트', desc: '4번 특이사항 → 반올림·합계 보정·끝전 처리·검증 스크립트' },
];

// [② AI 계산식 빌더] 3번 정산 수식과 4번 후처리 스크립트를 각각 생성(서버 AI 또는 내장 변환기)·검증·시뮬레이션한 뒤 skill.md에 반영한다.
export default function SkillFormulaBuilder({ tab = 'formula', onTab, ...props }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="빌더 대상">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onTab?.(t.id)}
            className={`rounded-xl border px-4 py-2 text-left ${
              tab === t.id ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-200' : 'border-slate-200 bg-white hover:border-violet-300'
            }`}
          >
            <span className={`block text-sm font-semibold ${tab === t.id ? 'text-violet-800' : 'text-slate-600'}`}>{t.label}</span>
            <span className="block text-[11px] text-slate-500">{t.desc}</span>
          </button>
        ))}
      </div>
      {tab === 'postprocess' ? <SkillPostprocessBuilder {...props} /> : <FormulaBuilder {...props} />}
    </div>
  );
}

// 3번 정산 수식: "## 1. 비즈니스 규칙 요약"을 읽어 수식을 만든다. 분리형이면 ```formula:equal / ```formula:perf (+ 선택 ```formula 통합식)
function FormulaBuilder({ detail, saveContent, onDirty, onGoDocument }) {
  const savedSplit = detail.equalFormula != null;
  const current = detail.formula ?? '';
  // 분리형의 통합식(```formula)은 선택. 분리형인데 통합식 블록이 없으면 서버는 "(균등) + (실적)"을 formula 로 준다
  const savedTotal = savedSplit && current === `(${detail.equalFormula}) + (${detail.perfFormula})` ? '' : current;
  const [split, setSplit] = useState(savedSplit);
  const [formula, setFormula] = useState(savedTotal);
  const [equal, setEqual] = useState(detail.equalFormula ?? '');
  const [perf, setPerf] = useState(detail.perfFormula ?? '');
  const [focus, setFocus] = useState('total');
  const [result, setResult] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [sim, setSim] = useState({ rawCount: 1_000_000, deductedCount: 100_000, totalCount: 9_000_000, institutionCount: 8, periodScale: 1 });
  const editors = { total: useRef(null), equal: useRef(null), perf: useRef(null) };
  const values = { total: formula, equal, perf };
  const setters = { total: setFormula, equal: setEqual, perf: setPerf };
  const changed =
    split !== savedSplit ||
    formula.trim() !== savedTotal.trim() ||
    (split && (equal.trim() !== (detail.equalFormula ?? '').trim() || perf.trim() !== (detail.perfFormula ?? '').trim()));
  // skill.md 에 넣을 블록들
  const want = split ? { equal, perf, total: formula.trim() || null } : { total: formula };
  // 저장된 skill.md 의 1번 섹션 원문 (요청 바디 businessRulesText 로 그대로 보낸다)
  const rulesText = useMemo(() => splitSkill(detail.content).summary, [detail.content]);
  const rules = lines(rulesText);

  useEffect(() => onDirty(changed), [changed, onDirty]);

  const generate = async () => {
    setGenError(null);
    setGenerating(true);
    try {
      const res = apiEnabled
        ? await api.generateFormula(detail.taskCode, rulesText)
        : generateFormulaLocally(detail.taskCode, rulesText);
      setResult(res);
      setFormula(res.generatedFormula);
      if (res.equalFormula && res.perfFormula) {
        setSplit(true);
        setEqual(res.equalFormula);
        setPerf(res.perfFormula);
      } else {
        setSplit(false);
      }
    } catch (e) {
      setGenError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  // 변수 칩: 마지막으로 누른 편집기의 커서 위치에 넣는다
  const insert = (token) => {
    const key = split ? focus : 'total';
    const el = editors[key].current;
    const text = values[key];
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + token + text.slice(end);
    setters[key](next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  // ── 3단계 검증 (저장 때 서버·Mock 이 하는 검증과 같은 순서): 섹션 → SpEL 구문 → 시험 계산 2벌 ──
  // 분리형은 균등·실적 수식을 각각 검사하고, 통합식이 있으면 균등 + 실적과 같은 값인지도 본다
  const checks = useMemo(() => {
    const list = split
      ? [['균등', equal.trim()], ['실적', perf.trim()], ...(formula.trim() ? [['통합', formula.trim()]] : [])]
      : [['', formula.trim()]];
    const step = (fn) => {
      try {
        return { ok: true, value: fn() };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    };
    const section = step(() => {
      parseSkill(detail.taskCode, replaceFormulas(detail.content, want));
      return '1번 요약 · 3번 정산 수식 확인';
    });
    const syntax = step(() => {
      list.forEach(([name, f]) => {
        const who = name ? `${name} 수식: ` : '';
        if (!f) throw new Error(`${who}수식이 비어 있습니다.`);
        if (f.length > MAX_FORMULA_LENGTH) throw new Error(`${who}수식은 ${MAX_FORMULA_LENGTH.toLocaleString('ko-KR')}자 이하로 작성해 주세요.`);
        try {
          compileFormula(f);
        } catch (e) {
          throw new Error(who + e.message);
        }
      });
      return '연산자 · 괄호 · 변수만 사용';
    });
    const trial = syntax.ok
      ? step(() =>
          FORMULA_SAMPLES.map((v) => {
            const r = Object.fromEntries(list.map(([name, f]) => [name, evaluateFormula(f, v)]));
            if (!split) return Math.round(r['']);
            const sum = r['균등'] + r['실적'];
            if ('통합' in r && Math.abs(r['통합'] - sum) > 0.5) {
              throw new Error(`통합 수식(${fmt(r['통합'])}원)이 균등 + 실적(${fmt(sum)}원)과 다릅니다. 산출은 균등·실적 수식으로 하니 통합 수식을 맞추거나 비워 두세요.`);
            }
            return Math.round(sum);
          }),
        )
      : { ok: false, message: '구문 검사를 먼저 통과해야 합니다.' };
    return { section, syntax, trial, all: section.ok && syntax.ok && trial.ok };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formula, equal, perf, split, detail.content, detail.taskCode]);

  const simResult = useMemo(() => {
    const finalCount = Math.max(0, (Number(sim.rawCount) || 0) - (Number(sim.deductedCount) || 0));
    const vars = { ...sim, finalCount };
    try {
      if (split) {
        const e = evaluateFormula(equal.trim(), vars);
        const p = evaluateFormula(perf.trim(), vars);
        return { finalCount, fee: e + p, equal: e, perf: p };
      }
      return { finalCount, fee: evaluateFormula(formula.trim(), vars) };
    } catch (e) {
      return { finalCount, error: e.message };
    }
  }, [formula, equal, perf, split, sim]);

  const apply = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await saveContent(
        replaceFormulas(detail.content, want),
        `${detail.taskName} 정산 수식을 반영했습니다.`,
      );
    } catch (e) {
      setSaveError(e.message);
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Panel 1 (3번) */}
      <Card
        no={1}
        title="기준 규칙 확인"
        icon={FileText}
        right={
          <button onClick={onGoDocument} className="flex items-center gap-1 text-xs text-slate-500 hover:text-brand-700">
            <ArrowLeft className="w-3.5 h-3.5" /> 기준 문서 편집에서 1번 규칙 고치기
          </button>
        }
      >
        <p className="text-xs text-slate-500 mb-1.5">
          {detail.taskName} · <span className="font-mono">{detail.fileName ?? `${detail.taskCode}.md`}</span> 의 ## 1. 비즈니스 규칙 요약 (저장된 내용)
        </p>
        {rules.length ? (
          <ul className="list-disc pl-5 space-y-1 rounded-lg bg-slate-50 border border-slate-200 py-3 pr-3 text-sm text-slate-700">
            {rules.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            {detail.parseError ?? "'## 1. 비즈니스 규칙 요약'이 비어 있습니다."} 기준 문서 편집에서 1번 규칙을 먼저 작성해 저장해 주세요.
          </p>
        )}
        <button
          onClick={generate}
          disabled={generating || !rules.length}
          className="mt-3 flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-violet-700 disabled:bg-slate-300"
        >
          {generating ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <WandSparkles className="w-4 h-4" />}
          ✨ 1번 비즈니스 규칙 읽고 계산식 자동 생성
        </button>
        <AiStatusLine />
        <p className="mt-1.5 text-[11px] text-slate-400">
          지원 패턴: 균등(%) + 실적비례(%) 혼합 · 구간별 차등 단가 · 기본료 + 건당 단가 · 단가 + 최저/최고 한도 · 총액 대비 실적 비율
        </p>
        {genError && (
          <p role="alert" className="mt-2 flex gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <TriangleAlert className="w-4 h-4 shrink-0" /> {genError}
          </p>
        )}
      </Card>

      {/* Panel 2 */}
      <Card no={2} title="AI 생성 수식 및 해석 결과" icon={Sparkles}>
        {result && (
          <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-sky-600">감지된 산정 유형</span>
              <b>{result.detectedPattern}</b>
              <span className="rounded-full border border-sky-300 bg-white px-2 py-0.5 text-[10px] text-sky-700">
                {SOURCE_LABEL[result.source] ?? result.source}
              </span>
            </p>
            <SourceNote result={result} />
            <p className="mt-2 text-xs text-sky-600">규칙-수식 매핑 설명</p>
            <ol className="mt-1 list-decimal pl-5 space-y-0.5 text-xs">
              {result.explanation.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ol>
            <p className="mt-2 text-xs">
              {result.validationPassed ? '✅ ' : '⚠️ '}
              {result.validationMessage} · 정상 예시 <b>{result.sampleResultNormal == null ? '-' : `${fmt(result.sampleResultNormal)}원`}</b> · 실적 0
              예시 <b>{result.sampleResultZero == null ? '-' : `${fmt(result.sampleResultZero)}원`}</b>
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <span className="text-[11px] text-slate-500">변수 넣기:</span>
          {VARIABLES.map((v) => (
            <button
              key={v.name}
              onClick={() => insert(v.name)}
              title={v.desc}
              className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 font-mono text-[11px] text-violet-700 hover:bg-violet-100"
            >
              {v.name}
            </button>
          ))}
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs" role="radiogroup" aria-label="수식 형태">
          {[
            [false, '단일 수식 (회비 총액)'],
            [true, '분리 수식 (균등분담 + 실적분담)'],
          ].map(([v, label]) => (
            <button
              key={label}
              role="radio"
              aria-checked={split === v}
              onClick={() => setSplit(v)}
              className={`rounded-full border px-3 py-1 ${split === v ? 'border-violet-500 bg-violet-600 text-white' : 'border-slate-300 text-slate-600 hover:border-violet-300'}`}
            >
              {label}
            </button>
          ))}
          <span className="text-[11px] text-slate-400">
            {split
              ? '균등분담분·실적분담분을 따로 계산합니다.'
              : '회비 총액을 하나의 수식으로 계산합니다.'}
          </span>
        </div>
        {split ? (
          <div className="space-y-2">
            <FormulaEditor label="균등분담회비 (기관 1곳)" refEl={editors.equal} value={equal} onChange={setEqual} onFocus={() => setFocus('equal')} rows={3} />
            <FormulaEditor label="실적분담회비 (기관 1곳)" refEl={editors.perf} value={perf} onChange={setPerf} onFocus={() => setFocus('perf')} rows={3} />
            <FormulaEditor
              label="통합 회비 (선택 · 균등 + 실적과 같아야 함)"
              refEl={editors.total}
              value={formula}
              onChange={setFormula}
              onFocus={() => setFocus('total')}
              rows={2}
            />
          </div>
        ) : (
          <FormulaEditor label="회비 총액 (기관 1곳)" refEl={editors.total} value={formula} onChange={setFormula} onFocus={() => setFocus('total')} rows={6} />
        )}
        <div className="mt-2 grid gap-2 md:grid-cols-2 text-[11px]">
          <div>
            <p className="text-slate-400">현재 적용 중인 수식</p>
            <pre className="whitespace-pre-wrap break-all rounded bg-slate-100 p-2 font-mono text-slate-500">
              {savedSplit ? `균등: ${detail.equalFormula}\n실적: ${detail.perfFormula}${savedTotal ? `\n통합: ${savedTotal}` : ''}` : current || '(없음)'}
            </pre>
          </div>
          <p className="self-end text-slate-400 leading-relaxed">
            숫자 · 변수 · 사칙연산 · 비교 · 삼항 연산자를 쓸 수 있습니다. 나눌 때는 <code>(#totalCount == 0 ? 0 : …)</code>로 0 나누기를 막으세요.
          </p>
        </div>
      </Card>

      {/* Panel 3 */}
      <Card no={3} title="실시간 시뮬레이션 & 3단계 검증기" icon={Calculator}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-brand-800 mb-2">테스트 값 (한 기관)</p>
            <div className="grid grid-cols-2 gap-2">
              {SIM_FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="block text-[11px] text-slate-500">{f.label}</span>
                  <input
                    type="number"
                    step={f.step ?? 1}
                    value={sim[f.key]}
                    onChange={(e) => setSim((v) => ({ ...v, [f.key]: Number(e.target.value) }))}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm tabular-nums"
                  />
                </label>
              ))}
            </div>
            <p className="mt-3 text-sm">
              최종 인정 건수 <b className="tabular-nums">{fmt(simResult.finalCount)}</b>건 →{' '}
              {simResult.error ? (
                <span className="text-rose-600">{simResult.error}</span>
              ) : (
                <>
                  계산 결과 <b className="text-lg text-brand-800 tabular-nums">{fmt(simResult.fee)}원</b>
                  {split && (
                    <span className="block text-xs text-slate-500">
                      균등 {fmt(simResult.equal)}원 + 실적 {fmt(simResult.perf)}원
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-brand-800 mb-2">저장 전 3단계 검증</p>
            <ul className="space-y-2">
              <Check label="① 섹션 유효성" result={checks.section} />
              <Check label="② 수식 구문 검사" result={checks.syntax} />
              <Check
                label="③ 시험 계산 2벌 (정상 · 실적 0)"
                result={checks.trial.ok ? { ok: true, value: `정상 ${fmt(checks.trial.value[0])}원 · 실적 0 ${fmt(checks.trial.value[1])}원` } : checks.trial}
              />
            </ul>
          </div>
        </div>
        {saveError && (
          <p role="alert" className="mt-3 flex gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <TriangleAlert className="w-4 h-4 shrink-0" /> {saveError}
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-3">
          {!changed && <span className="text-[11px] text-slate-400">현재 적용 중인 수식과 같습니다.</span>}
          <button
            onClick={apply}
            disabled={!checks.all || !changed || saving}
            className="flex items-center gap-1.5 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:bg-slate-300"
          >
            {saving ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <CircleCheck className="w-4 h-4" />}
            이 수식을 확정 반영
          </button>
        </div>
      </Card>
    </div>
  );
}

function FormulaEditor({ label, refEl, value, onChange, onFocus, rows }) {
  return (
    <label className="block">
      <span className="block font-mono text-[11px] text-slate-500 mb-0.5">{label}</span>
      <textarea
        ref={refEl}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        spellCheck={false}
        rows={rows}
        aria-label={label}
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono text-xs leading-5 text-emerald-200 caret-emerald-300 focus:outline-none focus:ring-2 focus:ring-violet-300"
      />
    </label>
  );
}

export function Check({ label, result }) {
  return (
    <li
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
        result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'
      }`}
    >
      {result.ok ? <CircleCheck className="w-4 h-4 shrink-0" /> : <CircleX className="w-4 h-4 shrink-0" />}
      <span>
        <b>{label}</b> <span className="ml-1 rounded-full bg-white/70 px-1.5 text-[10px] font-semibold">{result.ok ? '통과' : '실패'}</span>
        <span className="block mt-0.5 break-all">{result.ok ? result.value : result.message}</span>
      </span>
    </li>
  );
}
