import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Calculator, CircleCheck, FileText, LoaderCircle, Sparkles, TriangleAlert, WandSparkles } from 'lucide-react';
import { api, apiEnabled } from '../utils/api';
import { fmt } from '../utils/fee';
import { INSTITUTIONS } from '../data/mockData';
import { computeRaw, lines, parseSkill, replacePostprocess, splitSkill } from '../utils/skill';
import { DEFAULT_POSTPROCESS, generatePostprocessLocally, parseScript, runScript, sampleLines, scriptOf, trialScript } from '../utils/postprocess';
import { Card, Check } from './SkillFormulaBuilder';

const SOURCE_LABEL = { AI: 'AI(LLM) 생성', RULE: '내장 변환기', RULE_FALLBACK: 'AI 실패 → 내장 변환기' };

// 편집기에 넣는 연산 예시 (한 줄 = 한 단계)
const OPS = [
  { label: 'allocate', text: 'allocate(fee)', desc: '원 단위 배분(최대잔여법, 합계 유지)' },
  { label: 'roundHalf', text: 'roundHalf(equal)\nroundHalf(perf)', desc: '균등·실적을 각각 원 단위 반올림' },
  { label: 'fixSum', text: 'fixSum(equal, 25%, over=perfDesc, under=perfAsc)', desc: '합계를 목표에 맞춰 1원씩 보정' },
  { label: 'roundUp', text: 'roundUp(fee, 10, "우체국", addTo=perf)', desc: 'N원 단위 절상 (roundDown 절사 · roundHalf 반올림)' },
  { label: 'spreadDiff', text: 'spreadDiff(perf, others, perfDesc)', desc: '앞 단계에서 늘거나 준 금액을 나머지 기관에서 1원씩 되돌림' },
  { label: 'min / max', text: 'min(fee, 300000)', desc: '최저·최고 회비 (기관명을 붙이면 그 기관만)' },
  { label: 'add / set', text: 'set(fee, 0, "기관명")', desc: '금액·비율 가감, 고정' },
  { label: 'assert', text: 'assert sum(fee) == before\nassert all(fee >= 0)', desc: '검증 (실패해도 산출은 되고 결과에 빨갛게 표시)' },
];

// 시뮬레이션용 예시 실적: 기관 순서대로 줄어드는 건수 (같은 화면에서 늘 같은 값)
const exampleCount = (i) => Math.round(3_000_000 / (i + 1)) + 17 * i + 3;

// [② AI 계산식 빌더 · 4번 후처리 스크립트] "## 4. 최종 정산 특이사항" 자연어를 후처리 스크립트로 만들고(서버 AI 또는 내장 변환기)
// 문법 검사 · 시험 실행 · 실제 기관 시뮬레이션 후 skill.md 4번의 ```postprocess 블록에 반영한다. 산출 때는 AI 없이 이 스크립트만 실행한다.
export default function SkillPostprocessBuilder({ detail, saveContent, onDirty, onGoDocument }) {
  const current = detail.postprocess ?? '';
  const [script, setScript] = useState(current);
  const [result, setResult] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [data, setData] = useState('institutions');
  const [institutions, setInstitutions] = useState(() => INSTITUTIONS.filter((i) => i.active !== false));
  const editor = useRef(null);
  const changed = script.trim() !== current.trim();
  const specialText = useMemo(() => splitSkill(detail.content).special, [detail.content]);
  const rules = lines(specialText);

  useEffect(() => onDirty(changed), [changed, onDirty]);

  // 서버 모드면 서버에 등록된 기관(사용 중) 목록으로 시뮬레이션한다 (기관 관리에서 추가한 '우체국' 등)
  useEffect(() => {
    if (!apiEnabled) return;
    let alive = true;
    api
      .institutions()
      .then((list) => alive && setInstitutions(list.filter((i) => i.active !== false && !i.uploadOnly)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const generate = async () => {
    setGenError(null);
    setGenerating(true);
    try {
      const res = apiEnabled
        ? await api.generatePostprocess(detail.taskCode, specialText)
        : generatePostprocessLocally(detail.taskCode, specialText, institutions);
      setResult(res);
      setScript(res.generatedScript);
    } catch (e) {
      setGenError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const insert = (text) => {
    const el = editor.current;
    const start = el?.selectionStart ?? script.length;
    const before = script.slice(0, start);
    const token = (before && !before.endsWith('\n') ? '\n' : '') + text + '\n';
    const next = before + token + script.slice(el?.selectionEnd ?? start);
    setScript(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  // ── 저장 전 검증 (저장 때 서버·Mock 이 하는 검증과 같다): 문법 → 시험 실행 2벌(시험용 기관 7곳 · 실적 0) ──
  const checks = useMemo(() => {
    const step = (fn) => {
      try {
        return { ok: true, value: fn() };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    };
    const syntax = step(() => {
      const n = parseScript(script).length;
      return n ? `${n}단계 · 허용 연산만 사용` : `비어 있음 → 산출 때 기본 배분(${DEFAULT_POSTPROCESS})`;
    });
    const trial = syntax.ok ? step(() => trialScript(script) && '정상 · 실적 0 실행 성공') : { ok: false, message: '문법 검사를 먼저 통과해야 합니다.' };
    return { syntax, trial, all: syntax.ok && trial.ok };
  }, [script]);

  // ── 시뮬레이션: 저장된 3번 수식 + 기관 목록 + 예시 실적으로 Step 1 원시값을 만들고 스크립트를 실행 ──
  const sim = useMemo(() => {
    let lineRows;
    let basis;
    try {
      if (data === 'sample') throw new Error('sample');
      const skill = parseSkill(detail.taskCode, detail.content);
      const rows = institutions.map((inst, i) => {
        const c = exampleCount(i);
        return { inst, baseCount: c, deduction: 0, finalCount: c };
      });
      const raw = computeRaw(skill, rows, 1);
      lineRows = rows.map(({ inst, finalCount }, i) => ({
        institutionId: inst.id,
        code: inst.code,
        name: inst.name,
        aliases: inst.aliases ?? [],
        finalCount,
        equalMicro: raw.equalMicro[i],
        perfMicro: raw.perfMicro[i],
      }));
      basis = `저장된 3번 수식 · 사용 중 기관 ${rows.length}곳 · 예시 실적 · 한 분기`;
    } catch (e) {
      lineRows = sampleLines();
      basis = e.message === 'sample' ? '시험용 기관 7곳 · 총액 3억원 (균등 30% + 실적 70%)' : `3번 수식을 읽지 못해 시험용 기관 7곳으로 실행 (${e.message})`;
    }
    try {
      const text = script.trim() ? script : DEFAULT_POSTPROCESS;
      const r = runScript(text, lineRows);
      return { basis, rows: lineRows, ...r };
    } catch (e) {
      return { basis, rows: lineRows, error: e.message };
    }
  }, [script, data, detail.content, detail.taskCode, institutions]);

  const apply = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await saveContent(
        replacePostprocess(detail.content, script),
        script.trim()
          ? `${detail.taskName} skill.md '## 4. 최종 정산 특이사항'에 후처리 스크립트를 반영했습니다. 다음 산출부터 이 스크립트대로 계산합니다.`
          : `${detail.taskName} skill.md의 후처리 스크립트를 지웠습니다.`,
      );
    } catch (e) {
      setSaveError(e.message);
      setSaving(false);
    }
  };

  const autoScript = !current && rules.length ? scriptOf({ postprocess: '', specialRules: rules, specialRulesRaw: specialText }, institutions) : null;
  const sum = (key) => (sim.items ?? []).reduce((s, it) => s + it[key], 0);

  return (
    <div className="space-y-4">
      {/* Panel 1 (4번) */}
      <Card
        no={1}
        title="4번 최종 정산 특이사항 확인"
        icon={FileText}
        right={
          <button onClick={onGoDocument} className="flex items-center gap-1 text-xs text-slate-500 hover:text-brand-700">
            <ArrowLeft className="w-3.5 h-3.5" /> 기준 문서 편집에서 4번 문장 고치기
          </button>
        }
      >
        <p className="text-xs text-slate-500 mb-1.5">
          {detail.taskName} · <span className="font-mono">{detail.fileName ?? `${detail.taskCode}.md`}</span> 의 ## 4. 최종 정산 특이사항 (저장된 자연어 문장)
        </p>
        {rules.length ? (
          <ul className="list-disc pl-5 space-y-1 rounded-lg bg-slate-50 border border-slate-200 py-3 pr-3 text-sm text-slate-700">
            {rules.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-500">
            4번 특이사항이 없습니다. 스크립트가 없으면 산출 때 기본 배분({DEFAULT_POSTPROCESS})만 합니다.
          </p>
        )}
        {autoScript && (
          <p className="mt-2 flex gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <TriangleAlert className="w-4 h-4 shrink-0" />
            아직 확정된 스크립트가 없어 산출 때 내장 변환기로 바꿔 실행합니다. 아래에서 스크립트를 만들어 확인한 뒤 확정 반영해 주세요.
          </p>
        )}
        <button
          onClick={generate}
          disabled={generating || !rules.length}
          className="mt-3 flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-violet-700 disabled:bg-slate-300"
        >
          {generating ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <WandSparkles className="w-4 h-4" />}
          ✨ 4번 특이사항 읽고 후처리 스크립트 자동 생성
        </button>
        <p className="mt-1.5 text-[11px] text-slate-400">
          {apiEnabled
            ? '서버에 AI 키가 있으면 AI(LLM)가 문장을 스크립트로 바꾸고, 없거나 결과가 문법 검사·시험 실행을 통과하지 못하면 내장 변환기가 만듭니다.'
            : '서버 미연결(Mock) 모드: 서버와 같은 내장 변환기로 만듭니다.'}{' '}
          AI 는 여기서 한 번만 쓰고, 산출 때는 확정된 스크립트를 코드가 그대로 실행합니다 (같은 입력이면 늘 같은 금액).
        </p>
        {genError && (
          <p role="alert" className="mt-2 flex gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <TriangleAlert className="w-4 h-4 shrink-0" /> {genError}
          </p>
        )}
      </Card>

      {/* Panel 2 */}
      <Card no={2} title="후처리 스크립트 편집" icon={Sparkles}>
        {result && (
          <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-sky-600">문장 → 단계 변환</span>
              <span className="rounded-full border border-sky-300 bg-white px-2 py-0.5 text-[10px] text-sky-700">
                {SOURCE_LABEL[result.source] ?? result.source}
                {result.model ? ` · ${result.model}` : ''}
              </span>
            </p>
            <ol className="mt-1 list-decimal pl-5 space-y-0.5 text-xs">
              {result.explanation.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ol>
            {result.unsupported?.length > 0 && (
              <p className="mt-2 text-xs text-rose-700">
                스크립트로 바꾸지 못한 문장 (직접 단계를 넣어 주세요): {result.unsupported.join(' / ')}
              </p>
            )}
            <p className="mt-2 text-xs">
              {result.validationPassed ? '✅ ' : '⚠️ '}
              {result.validationMessage}
            </p>
            {result.note && <p className="mt-1 text-[11px] text-amber-700">{result.note}</p>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <span className="text-[11px] text-slate-500">단계 넣기:</span>
          {OPS.map((o) => (
            <button
              key={o.label}
              onClick={() => insert(o.text)}
              title={`${o.desc}\n${o.text}`}
              className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 font-mono text-[11px] text-violet-700 hover:bg-violet-100"
            >
              {o.label}
            </button>
          ))}
        </div>
        <textarea
          ref={editor}
          value={script}
          onChange={(e) => setScript(e.target.value)}
          spellCheck={false}
          rows={Math.min(16, Math.max(6, script.split('\n').length + 1))}
          aria-label="후처리 스크립트 편집기"
          placeholder={'roundHalf(equal)\nroundHalf(perf)\nfixSum(equal, 25%, over=perfDesc, under=perfAsc)\nroundUp(fee, 10, "우체국", addTo=perf)\nspreadDiff(perf, others, perfDesc)\nassert sum(fee) == before'}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono text-xs leading-5 text-emerald-200 caret-emerald-300 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
        <details className="mt-2 text-[11px] text-slate-500">
          <summary className="cursor-pointer text-slate-600">문법 안내</summary>
          <div className="mt-1.5 grid gap-1 md:grid-cols-2 leading-relaxed">
            <p>
              한 줄 = 한 단계, 위에서 아래로 실행. <code>#</code> 뒤는 주석. 시작 값은 3번 수식의 균등분담분(<code>equal</code>)·실적분담분(<code>perf</code>)
              원시값(원 미만 포함)이고 <code>fee</code> = equal + perf.
            </p>
            <p>
              대상: <code>all</code> · <code>first</code> · <code>last</code> · <code>others</code>(바로 앞 단계 대상의 나머지) · <code>"기관명"</code>(기관명·별칭·기관코드).
              정렬: <code>perfDesc/perfAsc</code>(실적분담분) · <code>countDesc/countAsc</code>(인정 건수) · <code>feeDesc/feeAsc</code> · <code>codeAsc</code>. 동률은 기관코드 오름차순.
            </p>
            {OPS.map((o) => (
              <p key={o.label}>
                <code className="text-violet-700">{o.text.split('\n')[0]}</code> — {o.desc}
              </p>
            ))}
            <p>
              처음 모든 금액이 원 단위 정수가 된 시점의 회비가 '보정 전 금액'이고, 그 뒤 단계의 증감이 특이사항 보정액·사유로 남습니다.
              <code> before</code> 는 원시값 합계(원 단위 반올림)입니다.
            </p>
          </div>
        </details>
        <div className="mt-2 text-[11px]">
          <p className="text-slate-400">현재 skill.md에 확정된 스크립트</p>
          <pre className="whitespace-pre-wrap break-all rounded bg-slate-100 p-2 font-mono text-slate-500">
            {current || (autoScript ? `(미확정 · 산출 때 내장 변환기 결과로 실행)\n${autoScript.text}` : `(없음 · 기본 배분 ${DEFAULT_POSTPROCESS})`)}
          </pre>
        </div>
      </Card>

      {/* Panel 3 */}
      <Card no={3} title="시뮬레이션 & 검증" icon={Calculator}>
        <div className="flex flex-wrap items-center gap-2 mb-2 text-xs" role="radiogroup" aria-label="시뮬레이션 데이터">
          {[
            ['institutions', '사용 중 기관 + 저장된 3번 수식'],
            ['sample', '시험용 기관 7곳 (저장 검증과 같은 값)'],
          ].map(([id, label]) => (
            <button
              key={id}
              role="radio"
              aria-checked={data === id}
              onClick={() => setData(id)}
              className={`rounded-full border px-3 py-1 ${data === id ? 'border-violet-500 bg-violet-600 text-white' : 'border-slate-300 text-slate-600 hover:border-violet-300'}`}
            >
              {label}
            </button>
          ))}
          <span className="text-[11px] text-slate-400">{sim.basis}</span>
        </div>
        {sim.error ? (
          <p role="alert" className="flex gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <TriangleAlert className="w-4 h-4 shrink-0" /> {sim.error}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs tabular-nums">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    {['기관', '인정 건수', '균등분담분', '실적분담분', '보정 전', '최종 회비', '보정 사유'].map((h) => (
                      <th key={h} className="px-2 py-1.5 text-right first:text-left last:text-left font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sim.items.map((it, i) => (
                    <tr key={i} className={`border-t border-slate-100 ${it.applied ? 'bg-amber-50/50' : ''}`}>
                      <td className="px-2 py-1 text-left">{sim.rows[i].name}</td>
                      <td className="px-2 py-1 text-right">{fmt(sim.rows[i].finalCount)}</td>
                      <td className="px-2 py-1 text-right">{fmt(it.equalFee)}</td>
                      <td className="px-2 py-1 text-right">{fmt(it.perfFee)}</td>
                      <td className="px-2 py-1 text-right text-slate-400">{fmt(it.beforeSpecialFee)}</td>
                      <td className="px-2 py-1 text-right font-semibold text-brand-800">
                        {fmt(it.fee)}
                        {it.adjustment !== 0 && (
                          <span className={`ml-1 text-[10px] ${it.adjustment > 0 ? 'text-rose-600' : 'text-sky-600'}`}>
                            ({it.adjustment > 0 ? '+' : ''}
                            {fmt(it.adjustment)})
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-left text-[11px] text-amber-800">{it.reason?.replace('특이사항 반영: ', '') ?? ''}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td className="px-2 py-1 text-left">합계</td>
                    <td className="px-2 py-1 text-right">{fmt(sim.rows.reduce((s, r) => s + r.finalCount, 0))}</td>
                    <td className="px-2 py-1 text-right">{fmt(sum('equalFee'))}</td>
                    <td className="px-2 py-1 text-right">{fmt(sum('perfFee'))}</td>
                    <td className="px-2 py-1 text-right text-slate-400">{fmt(sum('beforeSpecialFee'))}</td>
                    <td className="px-2 py-1 text-right text-brand-800">{fmt(sum('fee'))}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            {(sim.checks.length > 0 || sim.notes.length > 0) && (
              <ul className="mt-2 space-y-0.5 text-xs">
                {sim.checks.map((c, i) => (
                  <li key={i} className={c.passed ? 'text-emerald-700' : 'font-semibold text-rose-700'} title={c.expression}>
                    {c.passed ? '✓' : '✗'} 검증 {c.label} <span className="font-normal text-slate-500">· 실제 {c.actual}</span>
                  </li>
                ))}
                {sim.notes.map((v) => (
                  <li key={v} className="text-amber-700">
                    참고: {v}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <ul className="space-y-2">
            <Check label="① 스크립트 문법 검사" result={checks.syntax} />
            <Check label="② 시험 실행 2벌 (시험용 기관 7곳 · 실적 0)" result={checks.trial} />
          </ul>
          <p className="self-end text-[11px] text-slate-400 leading-relaxed">
            저장할 때 서버도 같은 검사를 다시 합니다. 검증(assert) 실패는 저장을 막지 않고, 산출 결과 화면과 대사용 엑셀에 실패로 표시됩니다.
            기관명은 산출 대상에 없으면 그 단계를 건너뛰고 참고로 남기니, 지정 기관(예: 우체국)은 기관 관리에 먼저 등록해 주세요.
          </p>
        </div>
        {saveError && (
          <p role="alert" className="mt-3 flex gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <TriangleAlert className="w-4 h-4 shrink-0" /> {saveError}
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-3">
          {!changed && <span className="text-[11px] text-slate-400">현재 확정된 스크립트와 같습니다.</span>}
          <button
            onClick={apply}
            disabled={!checks.all || !changed || saving}
            className="flex items-center gap-1.5 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:bg-slate-300"
          >
            {saving ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <CircleCheck className="w-4 h-4" />}이 스크립트를 skill.md 4번에 확정 반영
          </button>
        </div>
      </Card>
    </div>
  );
}
