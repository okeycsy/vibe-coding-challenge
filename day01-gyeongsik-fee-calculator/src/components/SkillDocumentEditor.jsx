import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Code2, History, Info, LayoutList, LoaderCircle, RotateCcw, Save, TriangleAlert } from 'lucide-react';
import { fmt } from '../utils/fee';
import { composeSkill, parseSkill, splitSkill } from '../utils/skill';

const MODES = [
  { id: 'form', label: '섹션별 폼 편집 모드', icon: LayoutList },
  { id: 'raw', label: '마크다운 원문(Raw) 편집 모드', icon: Code2 },
];
const BLOCKED = '수식(formula) 블록 구문이 올바르지 않아 저장이 차단되었습니다.';

// [① 기준 문서 편집] 업무 담당자가 자연어 규칙(머리말, 1·2·4번 섹션)을 작성한다. 3번 정산 수식은 읽기만 하고 [② AI 계산식 빌더]에서 고친다.
// 편집 내용은 마크다운 원문(text) 하나로 들고 있고, 폼 입력은 원문을 섹션별로 나눠 고친 뒤 표준 4섹션 마크다운으로 다시 합친다.
export default function SkillDocumentEditor({ user, detail, saveContent, onDirty, onReset, onGoBuilder }) {
  const [text, setText] = useState(detail.content);
  const [mode, setMode] = useState('form');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const dirty = text !== detail.content;

  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  // 폼 입력값은 따로 들고 있어 입력 중인 줄바꿈·공백이 그대로 보이고, 원문(text)에는 다듬어 합친 결과가 들어간다
  const [parts, setParts] = useState(() => splitSkill(detail.content));
  const setPart = (key, value) => {
    const next = { ...parts, [key]: value };
    setParts(next);
    setText(composeSkill(next, detail.taskCode));
  };
  const changeMode = (id) => {
    if (id === 'form') setParts(splitSkill(text));
    setMode(id);
  };
  // 원문에 표준 구조 밖의 내용이 있으면 폼으로 고칠 때 표준 4섹션 구조로 정리된다
  const standard = useMemo(() => composeSkill(splitSkill(text), detail.taskCode) === text, [text, detail.taskCode]);

  const live = useMemo(() => {
    try {
      return { parsed: parseSkill(detail.taskCode, text) };
    } catch (e) {
      return { error: e.message };
    }
  }, [text, detail.taskCode]);
  const formula = live.parsed?.formula ?? parts.formulaSection.match(/```formula[ \t]*\n([\s\S]*?)```/)?.[1]?.trim() ?? '';

  const save = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await saveContent(text);
    } catch (e) {
      const isFormula = e.formula || /수식|formula/.test(e.message);
      setSaveError({ title: isFormula ? BLOCKED : '저장하지 못했습니다.', detail: e.message });
      setSaving(false);
    }
  };

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5 border-b border-slate-100">
        <div className="min-w-0">
          <p className="font-semibold text-brand-900 flex items-center gap-2">
            {detail.taskName} 회비분담기준
            <span className="font-mono text-xs font-normal text-slate-400">{detail.fileName ?? `${detail.taskCode}.md`}</span>
            {dirty && <span className="rounded bg-sky-50 border border-sky-200 px-1.5 text-[10px] text-sky-700">편집 중</span>}
          </p>
          <p className="text-[11px] text-slate-500 flex items-center gap-1">
            <History className="w-3 h-3" />
            최종 수정 {detail.lastModified ?? '초기 기준'}
            {detail.updatedBy && ` · ${detail.updatedBy}`}
            {detail.version && ` · v${detail.version}`}
            {` · ${fmt(detail.size)}바이트`}
          </p>
        </div>
        <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs" role="radiogroup" aria-label="편집 모드">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => changeMode(m.id)}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 ${mode === m.id ? 'bg-brand-700 text-white' : 'text-slate-500 hover:text-brand-700'}`}
            >
              <m.icon className="w-3.5 h-3.5" /> {m.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {onReset && (
            <button
              onClick={onReset}
              className="text-[11px] text-slate-400 underline-offset-2 hover:text-rose-600 hover:underline"
              title="서버의 skill.md를 처음 배포된 기준으로 되돌립니다"
            >
              초기 기준 복원
            </button>
          )}
          <button
            onClick={() => {
              setText(detail.content);
              setParts(splitSkill(detail.content));
              setSaveError(null);
            }}
            disabled={!dirty || saving}
            className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            title="저장하지 않은 수정 내용을 버리고 마지막 저장본으로 돌아갑니다"
          >
            <RotateCcw className="w-3.5 h-3.5" /> 원래대로 되돌리기
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:bg-slate-300"
          >
            {saving ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            저장 및 반영하기
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {saveError && (
          <div role="alert" className="flex gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <TriangleAlert className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-semibold">{saveError.title}</p>
              <p className="text-xs mt-0.5 break-all">{saveError.detail}</p>
            </div>
          </div>
        )}
        {live.error && !saveError && (
          <p className="flex items-center gap-1.5 text-xs text-amber-700">
            <TriangleAlert className="w-3.5 h-3.5" /> {live.error}
          </p>
        )}

        {mode === 'form' ? (
          <>
            {!standard && (
              <p className="flex items-start gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                원문에 표준 4섹션 밖의 내용이 있습니다. 폼에서 고치면 표준 구조(머리말 · 1 · 2 · 3 · 4번 섹션)로 정리되니, 그 내용을 지키려면
                마크다운 원문 편집 모드를 쓰세요.
              </p>
            )}
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="mb-2 text-sm font-semibold text-brand-900">머리말</legend>
              <Field label="업무명" value={parts.taskName} onChange={(v) => setPart('taskName', v)} />
              <Field label="산정 유형" value={parts.calcType} onChange={(v) => setPart('calcType', v)} placeholder="예: 균등 분담 + 실적 비례 분담" />
              <Field label="표시 단위" value={parts.rateUnit} onChange={(v) => setPart('rateUnit', v)} placeholder="원/건 또는 %" list="rate-units" />
              <datalist id="rate-units">
                <option value="원/건" />
                <option value="%" />
              </datalist>
            </fieldset>

            <Section
              no={1}
              title="비즈니스 규칙 요약"
              required
              hint="여기에 작성된 규칙을 바탕으로 [AI 계산식 빌더]에서 수식이 생성됩니다."
              value={parts.summary}
              onChange={(v) => setPart('summary', v)}
              rows={6}
              placeholder="- 분기 운영비 총액 3억원을 참가기관이 분담&#10;- 총액의 30%는 참가기관 수로 균등 분담&#10;- 나머지 70%는 인정 건수 비율로 분담"
            />
            <Section
              no={2}
              title="AI 예외 차감 지침"
              hint="회비 산출 STEP 2의 이슈 문장을 차감할지 판단하는 기준입니다 (선택)."
              value={parts.aiGuide}
              onChange={(v) => setPart('aiGuide', v)}
              rows={4}
            />

            {/* 3번: 읽기 전용 미니 프리뷰 */}
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-brand-900">
                  ## 3. 정산 수식 <span className="text-[11px] font-normal text-slate-500">(필수 · 현재 적용 중 · 읽기 전용)</span>
                </p>
                <button
                  onClick={onGoBuilder}
                  className="ml-auto flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
                >
                  👉 AI 계산식 빌더로 이동하여 수식 갱신 <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-2.5 font-mono text-[11px] text-emerald-200">
                {formula || '(아직 수식이 없습니다. AI 계산식 빌더에서 만들어 주세요.)'}
              </pre>
              {dirty && (
                <p className="mt-1.5 text-[11px] text-amber-700">빌더는 저장된 1번 규칙을 읽습니다. 1번을 고쳤다면 먼저 저장한 뒤 이동하세요.</p>
              )}
            </div>

            <Section
              no={4}
              title="최종 정산 특이사항"
              hint="1차 수식 계산 후 적용할 끝전 처리, 특정 기관 10원 절상 및 실적순 1원 절삭 등의 후처리 규칙을 작성하세요."
              value={parts.special}
              onChange={(v) => setPart('special', v)}
              rows={4}
              placeholder="- 참가기관 중 1개 기관(첫 번째 기관 또는 지정 기관)은 산출된 회비 총액을 10원 단위로 절상한다.&#10;- 절상으로 인해 발생한 차이분(초과액)은 최종 인정 실적(#finalCount)이 큰 기관 순서대로 1원씩 절삭하여 분기 총액을 맞춘다."
              tips={['N원 단위로 절상 + 차이분 실적순 1원씩 절삭', 'N원 미만 절사(버림)', '최저/최고 회비 N원', '기관명을 적으면 그 기관만']}
            />
          </>
        ) : (
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
            <CodeEditor value={text} onChange={setText} />
            <div className="h-[34rem] overflow-y-auto rounded-lg border border-slate-200 p-5">
              <MarkdownPreview markdown={text} />
            </div>
          </div>
        )}
        <p className="text-[11px] text-slate-400 leading-relaxed">
          저장하면 4개 섹션을 하나의 표준 마크다운으로 합쳐 {user.role === 'sysadmin' ? '' : '승인된 업무의 '}skill.md에 저장하고 3단계 검증(섹션 · 수식 구문 ·
          시험 계산 2벌)을 거칩니다. 1번 · 3번은 필수, 2번 · 4번은 선택입니다.
        </p>
      </div>
    </section>
  );
}

function Field({ label, value, onChange, placeholder, list }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={list}
        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
      />
    </label>
  );
}

function Section({ no, title, required, hint, value, onChange, rows, placeholder, tips }) {
  return (
    <label className="block">
      <span className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-semibold text-brand-900">
          ## {no}. {title}
        </span>
        <span className={`text-[11px] ${required ? 'text-rose-500' : 'text-slate-400'}`}>{required ? '필수' : '선택'}</span>
      </span>
      <span className="mt-0.5 block text-[11px] text-slate-500">{hint}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder?.replace(/&#10;/g, '\n')}
        spellCheck={false}
        aria-label={`${no}. ${title}`}
        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs leading-5 focus:outline-none focus:ring-2 focus:ring-brand-300"
      />
      {tips && (
        <span className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-slate-500">
          알아듣는 표현:
          {tips.map((t) => (
            <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5">
              {t}
            </span>
          ))}
        </span>
      )}
    </label>
  );
}

// 줄 번호가 붙은 고정폭 편집기 (textarea와 줄 번호 스크롤을 맞춘다)
function CodeEditor({ value, onChange }) {
  const gutter = useRef(null);
  const count = value.split('\n').length;
  return (
    <div className="flex h-[34rem] overflow-hidden rounded-lg border border-slate-700 bg-slate-900 focus-within:ring-2 focus-within:ring-brand-300">
      <div ref={gutter} aria-hidden="true" className="select-none overflow-hidden bg-slate-800 py-3 pl-3 pr-2 text-right font-mono text-xs leading-5 text-slate-500">
        {Array.from({ length: count }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.target.scrollTop;
        }}
        spellCheck={false}
        aria-label="skill.md 편집기"
        wrap="off"
        className="flex-1 resize-none bg-transparent px-3 py-3 font-mono text-xs leading-5 text-slate-100 caret-emerald-300 focus:outline-none"
      />
    </div>
  );
}

// 회비기준 문서에 쓰는 마크다운만 그린다: 제목, 목록, 문단, 코드 블록(formula 강조), `인라인 코드`, **굵게**
export function MarkdownPreview({ markdown }) {
  const blocks = [];
  const rows = markdown.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const body = [];
      for (i++; i < rows.length && !rows[i].startsWith('```'); i++) body.push(rows[i]);
      blocks.push({ type: 'code', lang: fence[1], text: body.join('\n') });
    } else if (/^#{1,6}\s/.test(line)) {
      blocks.push({ type: 'h', level: line.match(/^#+/)[0].length, text: line.replace(/^#+\s*/, '') });
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const last = blocks[blocks.length - 1];
      const item = line.replace(/^\s*([-*]|\d+\.)\s+/, '');
      if (last?.type === 'ul') last.items.push(item);
      else blocks.push({ type: 'ul', items: [item] });
    } else if (line.trim()) {
      blocks.push({ type: 'p', text: line });
    }
  }
  return (
    <div className="space-y-2.5 text-sm text-slate-700">
      {blocks.map((b, idx) => {
        if (b.type === 'h') {
          const cls = b.level === 1 ? 'text-lg font-bold text-brand-900' : b.level === 2 ? 'pt-2 text-base font-semibold text-brand-800 border-b border-slate-100 pb-1' : 'font-semibold';
          return <p key={idx} className={cls}>{inline(b.text)}</p>;
        }
        if (b.type === 'ul') {
          return (
            <ul key={idx} className="list-disc pl-5 space-y-1">
              {b.items.map((t, k) => (
                <li key={k}>{inline(t)}</li>
              ))}
            </ul>
          );
        }
        if (b.type === 'code') {
          return (
            <div key={idx}>
              {b.lang === 'formula' && <p className="text-[11px] font-semibold text-emerald-700 mb-1">정산 수식 (SpEL)</p>}
              <pre className={`whitespace-pre-wrap rounded-lg p-3 font-mono text-xs ${b.lang === 'formula' ? 'bg-slate-900 text-emerald-200 ring-2 ring-emerald-300/40' : 'bg-slate-100 text-slate-700'}`}>
                {b.text}
              </pre>
            </div>
          );
        }
        return <p key={idx}>{inline(b.text)}</p>;
      })}
    </div>
  );
}

function inline(text) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return <code key={i} className="rounded bg-slate-100 px-1 font-mono text-[12px] text-brand-800">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 3) return <b key={i}>{part.slice(2, -2)}</b>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
