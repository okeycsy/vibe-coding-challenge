import { useMemo, useState } from 'react';
import { FileCode2, LoaderCircle, RotateCcw, Save, TriangleAlert } from 'lucide-react';
import { Modal } from './ui';
import { evaluateFormula, parseSkill } from '../utils/skill';
import { fmt } from '../utils/fee';

const SAMPLE = { rawCount: 1_000_000, deductedCount: 0, finalCount: 1_000_000, totalCount: 8_000_000, institutionCount: 8, periodScale: 1 };
const VAR_LABELS = {
  rawCount: '기본건수',
  deductedCount: 'AI 차감건수',
  finalCount: '최종인정건수',
  totalCount: '전체 인정건수 합계',
  institutionCount: '참가기관 수',
  periodScale: '기간 환산 비율',
};

// 회비기준(skill.md) 원본 보기/수정. canEdit 이 false 면 읽기 전용.
export default function SkillModal({ business, skill, canEdit, onClose, onSave, onReset }) {
  const [text, setText] = useState(skill.markdown);
  const [tab, setTab] = useState('source');
  const [sample, setSample] = useState(SAMPLE);
  const [saving, setSaving] = useState(false);
  const dirty = text !== skill.markdown;

  // 입력 중인 원문을 바로 해석해 섹션·수식 오류를 보여 준다
  const preview = useMemo(() => {
    try {
      return { parsed: parseSkill(skill.taskCode, text) };
    } catch (e) {
      return { error: e.message };
    }
  }, [text, skill.taskCode]);

  const trial = useMemo(() => {
    if (!preview.parsed) return null;
    try {
      return { fee: evaluateFormula(preview.parsed.formula, sample) };
    } catch (e) {
      return { error: e.message };
    }
  }, [preview, sample]);

  const run = async (fn) => {
    setSaving(true);
    try {
      await fn();
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (dirty && !window.confirm('저장하지 않은 수정 내용이 있습니다. 닫을까요?')) return;
    onClose();
  };

  return (
    <Modal
      title={`${business.name} 회비기준 (${skill.taskCode}.md)`}
      onClose={close}
      width="max-w-5xl"
      footer={
        <>
          {canEdit && skill.modified && (
            <button
              disabled={saving}
              onClick={() => window.confirm('원본 skill.md로 되돌릴까요?') && run(onReset)}
              className="mr-auto flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-white disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" /> 원본으로 되돌리기
            </button>
          )}
          <button onClick={close} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-white">
            닫기
          </button>
          {canEdit && (
            <button
              disabled={!dirty || !!preview.error || !!trial?.error || saving}
              onClick={() => run(() => onSave(text))}
              className="flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:bg-slate-300"
            >
              {saving ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              저장하고 바로 적용
            </button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        {[
          ['source', '원문 (skill.md)'],
          ['sections', '섹션별 보기'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-full border px-3 py-1 ${
              tab === id ? 'border-brand-600 bg-brand-700 text-white' : 'border-slate-200 text-slate-500 hover:border-brand-300'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-slate-400">
          {skill.modified
            ? `수정됨${skill.updatedBy && skill.updatedBy !== 'file' ? ` · ${skill.updatedBy}` : ''}${skill.updatedAt ? ` · ${String(skill.updatedAt).replace('T', ' ').slice(0, 16)}` : ''}`
            : '원본'}
          {canEdit ? '' : ' · 읽기 전용 (시스템관리자만 수정)'}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          {tab === 'source' ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              readOnly={!canEdit}
              spellCheck={false}
              className="w-full h-[26rem] resize-none rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
          ) : preview.parsed ? (
            <div className="h-[26rem] overflow-y-auto space-y-4 rounded-lg border border-slate-200 p-4 text-sm">
              <section>
                <p className="text-xs font-semibold text-brand-700 mb-1">1. 비즈니스 규칙 요약 (화면 요약 박스)</p>
                <ul className="list-disc pl-5 space-y-1 text-slate-700">
                  {preview.parsed.summary.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </section>
              <section>
                <p className="text-xs font-semibold text-brand-700 mb-1">2. AI 예외 차감 지침</p>
                <pre className="whitespace-pre-wrap font-sans text-slate-700">{preview.parsed.aiGuide || '(없음)'}</pre>
              </section>
              <section>
                <p className="text-xs font-semibold text-brand-700 mb-1">3. 정산 수식 (SpEL)</p>
                <pre className="whitespace-pre-wrap rounded bg-slate-900 p-3 font-mono text-xs text-emerald-200">
                  {preview.parsed.formula}
                </pre>
              </section>
            </div>
          ) : (
            <div className="h-[26rem] rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{preview.error}</div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-3 text-xs">
          {preview.error ? (
            <div role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
              <TriangleAlert className="w-4 h-4 shrink-0" />
              <span>{preview.error}</span>
            </div>
          ) : (
            <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-3">
              <p className="flex items-center gap-1.5 font-semibold text-brand-800 mb-1">
                <FileCode2 className="w-3.5 h-3.5" /> {preview.parsed.calcType}
              </p>
              <p className="text-slate-500">표시 단위: {preview.parsed.rateUnit}</p>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 p-3">
            <p className="font-semibold text-slate-700 mb-2">수식 시험 계산 (한 기관)</p>
            <div className="grid grid-cols-2 gap-2">
              {Object.keys(SAMPLE).map((k) => (
                <label key={k} className="block">
                  <span className="block text-[11px] text-slate-500">
                    #{k} <span className="text-slate-400">{VAR_LABELS[k]}</span>
                  </span>
                  <input
                    type="number"
                    step={k === 'periodScale' ? 0.01 : 1}
                    value={sample[k]}
                    onChange={(e) => setSample((s) => ({ ...s, [k]: Number(e.target.value) }))}
                    className="w-full rounded border border-slate-300 px-2 py-1 tabular-nums"
                  />
                </label>
              ))}
            </div>
            <p className="mt-2">
              {trial?.error ? (
                <span className="text-rose-600">{trial.error}</span>
              ) : trial ? (
                <>
                  결과 <b className="text-brand-800 text-sm">{fmt(trial.fee)}원</b>
                  {!Number.isInteger(trial.fee) && <span className="text-slate-400"> (원 미만은 산출 시 합계에 맞춰 배정)</span>}
                </>
              ) : null}
            </p>
          </div>

          <p className="text-slate-400 leading-relaxed">
            수식에는 숫자, <code>#변수</code>, 사칙연산, 비교, <code>and/or</code>, 삼항(<code>조건 ? 값 : 값</code>)을 쓸 수 있습니다. 서버는
            보안을 위해 <code>T(...)</code> 타입 참조·메서드 호출·생성자를 막습니다. 비율 계산은 <code>120000000.0</code>처럼 소수점을 붙여야
            정수 나눗셈이 되지 않습니다.
          </p>
        </div>
      </div>
    </Modal>
  );
}
