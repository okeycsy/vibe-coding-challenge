import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Calculator, CircleCheck, CircleX, FileText, LoaderCircle, Sparkles, TriangleAlert, WandSparkles } from 'lucide-react';
import { api, apiEnabled } from '../utils/api';
import { fmt } from '../utils/fee';
import { generateFormulaLocally } from '../utils/formulaGenerator';
import { FORMULA_SAMPLES, MAX_FORMULA_LENGTH, compileFormula, evaluateFormula, lines, parseSkill, replaceFormula, splitSkill } from '../utils/skill';

const VARIABLES = [
  { name: '#finalCount', desc: '최종 인정 건수' },
  { name: '#totalCount', desc: '전체 기관 인정 건수 합계' },
  { name: '#institutionCount', desc: '참가기관 수' },
  { name: '#periodScale', desc: '기간 환산 비율 (분기 = 1)' },
  { name: '#rawCount', desc: '기본 건수' },
  { name: '#deductedCount', desc: 'AI 차감 건수' },
];
const SOURCE_LABEL = { AI: 'AI(LLM) 생성', RULE: '내장 변환기', RULE_FALLBACK: 'AI 실패 → 내장 변환기' };
const SIM_FIELDS = [
  { key: 'rawCount', label: '기본건수' },
  { key: 'deductedCount', label: '차감건수' },
  { key: 'totalCount', label: '전체건수(모든 기관 인정 합계)' },
  { key: 'institutionCount', label: '기관수' },
  { key: 'periodScale', label: '기간비율(분기 = 1)', step: 0.01 },
];

const Card = ({ no, title, icon: Icon, children, right }) => (
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

// [② AI 계산식 빌더] "## 1. 비즈니스 규칙 요약"을 읽어 "## 3. 정산 수식"을 생성(서버 AI 또는 내장 변환기)·검증·시뮬레이션한 뒤 skill.md에 반영한다.
export default function SkillFormulaBuilder({ detail, saveContent, notify, onDirty, onGoDocument }) {
  const current = detail.formula ?? '';
  const [formula, setFormula] = useState(current);
  const [result, setResult] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [sim, setSim] = useState({ rawCount: 1_000_000, deductedCount: 100_000, totalCount: 9_000_000, institutionCount: 8, periodScale: 1 });
  const editor = useRef(null);
  const changed = formula.trim() !== current.trim();
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
    } catch (e) {
      setGenError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  // 변수 칩: 편집기 커서 위치에 넣는다
  const insert = (token) => {
    const el = editor.current;
    const start = el?.selectionStart ?? formula.length;
    const end = el?.selectionEnd ?? formula.length;
    const next = formula.slice(0, start) + token + formula.slice(end);
    setFormula(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  // ── 3단계 검증 (저장 때 서버·Mock 이 하는 검증과 같은 순서): 섹션 → SpEL 구문 → 시험 계산 2벌 ──
  const checks = useMemo(() => {
    const f = formula.trim();
    const content = f ? replaceFormula(detail.content, f) : detail.content;
    const step = (fn) => {
      try {
        return { ok: true, value: fn() };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    };
    const section = step(() => parseSkill(detail.taskCode, content) && '1번 요약 · 3번 formula 블록 확인');
    const syntax = step(() => {
      if (!f) throw new Error('수식이 비어 있습니다.');
      if (f.length > MAX_FORMULA_LENGTH) throw new Error(`수식은 ${MAX_FORMULA_LENGTH.toLocaleString('ko-KR')}자 이하로 작성해 주세요.`);
      compileFormula(f);
      return '연산자 · 괄호 · 변수만 사용';
    });
    const trial = syntax.ok
      ? step(() => FORMULA_SAMPLES.map((v) => Math.round(evaluateFormula(f, v))))
      : { ok: false, message: '구문 검사를 먼저 통과해야 합니다.' };
    return { section, syntax, trial, all: section.ok && syntax.ok && trial.ok };
  }, [formula, detail.content, detail.taskCode]);

  const simResult = useMemo(() => {
    const finalCount = Math.max(0, (Number(sim.rawCount) || 0) - (Number(sim.deductedCount) || 0));
    try {
      return { finalCount, fee: evaluateFormula(formula.trim(), { ...sim, finalCount }) };
    } catch (e) {
      return { finalCount, error: e.message };
    }
  }, [formula, sim]);

  const apply = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await saveContent(replaceFormula(detail.content, formula.trim()), `${detail.taskName} skill.md의 '## 3. 정산 수식'을 새 수식으로 반영했습니다.`);
    } catch (e) {
      setSaveError(e.message);
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Panel 1 */}
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
        <p className="mt-1.5 text-[11px] text-slate-400">
          {apiEnabled
            ? '서버에 AI 키가 있으면 AI(LLM)가, 없거나 AI 결과가 검증을 통과하지 못하면 내장 변환기가 수식을 만듭니다.'
            : '서버 미연결(Mock) 모드: 서버와 같은 내장 변환기로 만듭니다.'}{' '}
          알아듣는 산정 패턴: 균등(%) + 실적비례(%) 혼합 · 구간별 차등 단가 · 기본료 + 건당 단가 · 단가 + 최저/최고 한도 · 총액 대비 실적 비율
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
                {result.model ? ` · ${result.model}` : ''}
              </span>
            </p>
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
            {result.note && <p className="mt-1 text-[11px] text-amber-700">{result.note}</p>}
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
        <textarea
          ref={editor}
          value={formula}
          onChange={(e) => setFormula(e.target.value)}
          spellCheck={false}
          rows={6}
          aria-label="정산 수식 (SpEL) 편집기"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono text-xs leading-5 text-emerald-200 caret-emerald-300 focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
        <div className="mt-2 grid gap-2 md:grid-cols-2 text-[11px]">
          <div>
            <p className="text-slate-400">현재 skill.md에 적용 중인 수식</p>
            <pre className="whitespace-pre-wrap break-all rounded bg-slate-100 p-2 font-mono text-slate-500">{current || '(없음)'}</pre>
          </div>
          <p className="self-end text-slate-400 leading-relaxed">
            T(...) 타입 참조 · 메서드 호출 · 생성자는 쓸 수 없고(SimpleEvaluationContext), 숫자 · 변수 · 사칙연산 · 비교 · 삼항 연산자만 됩니다.
            총액은 <code>300000000.0</code>처럼 소수점을 붙이고, 나눌 때는 <code>(#totalCount == 0 ? 0 : …)</code>로 0 나누기를 막으세요. 끝전 처리는
            4번 최종 정산 특이사항에 적습니다.
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
                </>
              )}
            </p>
            <p className="text-[11px] text-slate-400">원 미만은 산출 때 엔진이 버림 후 합계를 맞추고, 4번 특이사항은 그 뒤에 적용됩니다.</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-brand-800 mb-2">저장 전 3단계 검증</p>
            <ul className="space-y-2">
              <Check label="① 섹션 유효성" result={checks.section} />
              <Check label="② SpEL 구문 검사" result={checks.syntax} />
              <Check
                label="③ 시험 계산 2벌 (정상 · 실적 0)"
                result={checks.trial.ok ? { ok: true, value: `정상 ${fmt(checks.trial.value[0])}원 · 실적 0 ${fmt(checks.trial.value[1])}원` } : checks.trial}
              />
            </ul>
            <p className="mt-1.5 text-[11px] text-slate-400">
              정상 = 기본 100만 · 차감 10만 · 전체 900만 건 · 8개 기관 · 한 분기, 실적 0 = 모든 건수 0 · 8개 기관 · 반 분기
            </p>
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
            이 수식을 skill.md에 확정 반영
          </button>
        </div>
      </Card>
    </div>
  );
}

function Check({ label, result }) {
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
