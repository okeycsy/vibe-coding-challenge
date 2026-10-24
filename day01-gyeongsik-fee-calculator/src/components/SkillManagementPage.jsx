import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleCheck,
  Columns2,
  Eye,
  FileCode2,
  History,
  LoaderCircle,
  Lock,
  RotateCcw,
  Save,
  SquarePen,
  TriangleAlert,
} from 'lucide-react';
import { api, apiEnabled } from '../utils/api';
import { fmt } from '../utils/fee';
import {
  evaluateFormula,
  localSkillDetail,
  localSkillList,
  parseSkill,
  SECTION_TEMPLATE,
  validateSkill,
} from '../utils/skill';
import { Card, Modal } from './ui';

const MODES = [
  { id: 'editor', label: '편집기 (Editor)', icon: SquarePen },
  { id: 'preview', label: '미리보기 (Preview)', icon: Eye },
  { id: 'split', label: '나란히 보기 (Split)', icon: Columns2 },
];
const BLOCKED = '수식(formula) 블록 구문이 올바르지 않아 저장이 차단되었습니다.';
const LOCKED_MSG = '해당 업무의 권한을 먼저 신청하여 승인받아야 합니다.';

const nowLabel = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// 업무별 회비분담기준(skill.md) 관리: 왼쪽 업무 목록(권한별 잠금) + 오른쪽 마크다운 편집기·미리보기
export default function SkillManagementPage({
  user,
  notify,
  allowedTasks,
  target,
  overrides,
  setOverrides,
  onSaved,
  onRequestTask,
  tasks,
}) {
  const [list, setList] = useState([]);
  const [listError, setListError] = useState(null);
  const [selected, setSelected] = useState(null); // 업무 ID
  const [detail, setDetail] = useState(null);
  const [text, setText] = useState('');
  const [mode, setMode] = useState('split');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [lockedItem, setLockedItem] = useState(null);
  const dirty = detail && text !== detail.content;

  // ── 업무 목록 (권한이 바뀌면 다시 읽는다) ──
  const loadList = async () => {
    if (!apiEnabled) return localSkillList(tasks, allowedTasks, overrides);
    // 서버의 업무 목록 순서(기본 업무 → 추가한 업무) 그대로
    return api.skills();
  };

  useEffect(() => {
    let alive = true;
    setListError(null);
    loadList()
      .then((rows) => alive && setList(rows))
      .catch((e) => alive && setListError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, allowedTasks, overrides, tasks]);

  // 처음 열 때: 산출 화면에서 넘어온 업무 → 접근 가능한 첫 업무
  useEffect(() => {
    if (!list.length) return;
    const current = list.find((r) => r.businessId === selected);
    if (current?.accessible) return;
    const wanted = list.find((r) => r.businessId === target && r.accessible) ?? list.find((r) => r.accessible);
    if (wanted) open(wanted.businessId, true);
    else {
      setSelected(null);
      setDetail(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, target]);

  // ── 업무 열기 ──
  const open = async (businessId, force = false) => {
    if (!force && dirty && !window.confirm('저장하지 않은 수정 내용이 있습니다. 다른 업무로 이동할까요?')) return;
    const task = tasks.find((t) => t.businessId === businessId);
    setSelected(businessId);
    setSaveError(null);
    setLoading(true);
    try {
      const d = apiEnabled ? await api.skill(businessId) : localSkillDetail(task, overrides);
      setDetail(d);
      setText(d.content);
    } catch (e) {
      setDetail(null);
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const clickItem = (row) => {
    if (!row.accessible) {
      setLockedItem(row);
      return;
    }
    if (row.businessId !== selected) open(row.businessId);
  };

  // ── 저장·되돌리기 ──
  const save = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      if (apiEnabled) {
        const saved = await api.saveSkill(detail.taskCode, text);
        setDetail(saved);
        setText(saved.content);
        setList((rows) => rows.map((r) => (r.taskCode === saved.taskCode ? { ...r, ...pickMeta(saved) } : r)));
      } else {
        validateSkill(detail.taskCode, text);
        const next = { ...overrides, [detail.taskCode]: { content: text, lastModified: nowLabel(), updatedBy: user.id } };
        setOverrides(next);
        setDetail(localSkillDetail(tasks.find((t) => t.businessId === selected), next));
      }
      onSaved();
      notify(`${detail.taskName} 회비분담기준(skill.md)이 성공적으로 저장 및 반영되었습니다.`);
    } catch (e) {
      const formula = e.formula || /수식|formula/.test(e.message);
      setSaveError({ title: formula ? BLOCKED : '저장하지 못했습니다.', detail: e.message });
    } finally {
      setSaving(false);
    }
  };

  const revert = () => {
    setText(detail.content);
    setSaveError(null);
  };

  const resetToDefault = async () => {
    if (!window.confirm(`${detail.taskName} skill.md를 초기 기준으로 되돌릴까요? 지금 저장된 내용은 사라집니다.`)) return;
    try {
      let d;
      if (apiEnabled) {
        d = await api.resetSkill(detail.taskCode);
      } else {
        const { [detail.taskCode]: _, ...rest } = overrides;
        setOverrides(rest);
        d = localSkillDetail(tasks.find((t) => t.businessId === selected), rest);
      }
      setDetail(d);
      setText(d.content);
      setSaveError(null);
      onSaved();
      notify('초기 기준 skill.md로 되돌렸습니다.');
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  // ── 입력 중 실시간 검사 ──
  const live = useMemo(() => {
    if (!detail) return null;
    try {
      return { parsed: parseSkill(detail.taskCode, text) };
    } catch (e) {
      return { error: e.message };
    }
  }, [text, detail]);

  const accessibleCount = list.filter((r) => r.accessible).length;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-brand-900">회비기준(Skill.md) 관리</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          업무마다 skill.md 파일 1개로 회비분담기준과 정산 수식을 관리합니다. 저장하면 다음 회비 산출부터 바로 반영됩니다.
          {user.role === 'sysadmin' ? ' 시스템관리자는 모든 업무를 수정할 수 있습니다.' : ' 승인받은 업무만 열람·수정할 수 있습니다.'}
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-5 items-start">
        {/* 왼쪽: 업무 목록 */}
        <Card title="업무 선택" icon={FileCode2} className="xl:col-span-1" right={<span className="text-[11px] text-slate-400">접근 가능 {accessibleCount}/{list.length}</span>}>
          {listError && <p className="text-xs text-rose-600 mb-2">{listError}</p>}
          <ul className="space-y-2">
            {list.map((r) => {
              const on = r.businessId === selected;
              return (
                <li key={r.taskCode}>
                  <button
                    onClick={() => clickItem(r)}
                    className={`w-full text-left rounded-lg border px-3 py-2.5 transition ${
                      !r.accessible
                        ? 'border-slate-200 bg-slate-100 text-slate-400 grayscale cursor-not-allowed'
                        : on
                          ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200'
                          : 'border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {r.accessible ? (
                        <FileCode2 className="w-4 h-4 text-brand-500 shrink-0" />
                      ) : (
                        <Lock className="w-4 h-4 shrink-0" />
                      )}
                      <span className={`font-semibold text-sm ${r.accessible ? 'text-brand-900' : ''}`}>{r.taskName}</span>
                      {r.modified && r.accessible && (
                        <span className="ml-auto rounded bg-amber-50 border border-amber-200 px-1.5 text-[10px] text-amber-700">수정됨</span>
                      )}
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-400">{r.fileName ?? `${r.taskCode}.md`}</p>
                    <div className="mt-1.5">
                      {r.accessible ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          <CircleCheck className="w-3 h-3" /> 접근 가능
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500">
                          <Lock className="w-3 h-3" /> 권한 없음 - 접근 불가
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* 오른쪽: 편집기 */}
        <section className="xl:col-span-3 bg-white rounded-xl border border-slate-200 shadow-sm min-w-0">
          {!detail ? (
            <div className="py-24 text-center text-sm text-slate-400">
              {loading ? (
                <LoaderCircle className="w-6 h-6 mx-auto animate-spin text-brand-400" />
              ) : accessibleCount === 0 && list.length ? (
                '접근 가능한 업무가 없습니다. 내 정보 관리에서 담당 업무 권한을 신청해 주세요.'
              ) : (
                '왼쪽에서 업무를 선택하세요.'
              )}
            </div>
          ) : (
            <>
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
                <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
                  {MODES.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMode(m.id)}
                      className={`flex items-center gap-1 rounded-md px-2.5 py-1 ${
                        mode === m.id ? 'bg-brand-700 text-white' : 'text-slate-500 hover:text-brand-700'
                      }`}
                    >
                      <m.icon className="w-3.5 h-3.5" /> {m.label}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {user.role === 'sysadmin' && detail.modified && (
                    <button
                      onClick={resetToDefault}
                      className="text-[11px] text-slate-400 underline-offset-2 hover:text-rose-600 hover:underline"
                      title="서버의 skill.md를 처음 배포된 기준으로 되돌립니다"
                    >
                      초기 기준 복원
                    </button>
                  )}
                  <button
                    onClick={revert}
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

              <div className="p-5 space-y-3">
                {saveError && (
                  <div role="alert" className="flex gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    <TriangleAlert className="w-5 h-5 shrink-0" />
                    <div>
                      <p className="font-semibold">{saveError.title}</p>
                      <p className="text-xs mt-0.5 break-all">{saveError.detail}</p>
                    </div>
                  </div>
                )}
                {live?.error && !saveError && (
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-amber-700">
                    <TriangleAlert className="w-3.5 h-3.5" /> {live.error}
                    {/* 막 추가한 업무처럼 제목만 있으면 나머지 기본 템플릿 섹션을 붙여 넣을 수 있다 */}
                    {!/^##\s/m.test(text) && (
                      <button
                        onClick={() => setText(text.replace(/\s*$/, '\n') + SECTION_TEMPLATE)}
                        className="ml-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                      >
                        기본 템플릿 섹션 넣기
                      </button>
                    )}
                  </p>
                )}

                <div className={`grid gap-4 ${mode === 'split' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
                  {mode !== 'preview' && <CodeEditor value={text} onChange={setText} />}
                  {mode !== 'editor' && (
                    <div className="h-[34rem] overflow-y-auto rounded-lg border border-slate-200 p-5">
                      <MarkdownPreview markdown={text} />
                      {live?.parsed && <FormulaTrial formula={live.parsed.formula} />}
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  수식 변수: <code>#rawCount</code> 기본건수, <code>#deductedCount</code> AI 차감건수, <code>#finalCount</code> 최종인정건수,{' '}
                  <code>#totalCount</code> 전체 인정건수 합계, <code>#institutionCount</code> 참가기관 수, <code>#periodScale</code> 기간 환산
                  비율. 보안을 위해 <code>T(...)</code> 타입 참조·메서드 호출·생성자는 쓸 수 없습니다. 비율은 <code>120000000.0</code>처럼 소수점을
                  붙여야 정수 나눗셈이 되지 않습니다.
                </p>
              </div>
            </>
          )}
        </section>
      </div>

      {lockedItem && (
        <Modal
          title="접근 권한 없음"
          onClose={() => setLockedItem(null)}
          footer={
            <>
              <button onClick={() => setLockedItem(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-white">
                닫기
              </button>
              {user.role === 'operator' && (
                <button
                  onClick={() => {
                    setLockedItem(null);
                    onRequestTask();
                  }}
                  className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800"
                >
                  업무 권한 신청하러 가기
                </button>
              )}
            </>
          }
        >
          <div className="flex gap-3">
            <Lock className="w-8 h-8 text-slate-400 shrink-0" />
            <div className="text-sm text-slate-700">
              <p className="font-semibold">{lockedItem.taskName} ({lockedItem.fileName ?? `${lockedItem.taskCode}.md`})</p>
              <p className="mt-1">{LOCKED_MSG}</p>
              <p className="mt-1 text-xs text-slate-500">권한이 승인되면 이 목록의 자물쇠가 풀리고 바로 열람·수정할 수 있습니다.</p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

const pickMeta = (d) => ({ lastModified: d.lastModified, size: d.size, version: d.version, modified: d.modified });

// 줄 번호가 붙은 고정폭 편집기 (textarea와 줄 번호 스크롤을 맞춘다)
function CodeEditor({ value, onChange }) {
  const gutter = useRef(null);
  const lines = value.split('\n').length;
  return (
    <div className="flex h-[34rem] overflow-hidden rounded-lg border border-slate-700 bg-slate-900 focus-within:ring-2 focus-within:ring-brand-300">
      <div ref={gutter} aria-hidden="true" className="select-none overflow-hidden bg-slate-800 py-3 pl-3 pr-2 text-right font-mono text-xs leading-5 text-slate-500">
        {Array.from({ length: lines }, (_, i) => (
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
function MarkdownPreview({ markdown }) {
  const blocks = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const body = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
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

// 수식 시험 계산 (한 기관 기준)
const TRIAL = { rawCount: 1_000_000, deductedCount: 0, finalCount: 1_000_000, totalCount: 8_000_000, institutionCount: 8, periodScale: 1 };

function FormulaTrial({ formula }) {
  const [vars, setVars] = useState(TRIAL);
  let result;
  try {
    result = { fee: evaluateFormula(formula, vars) };
  } catch (e) {
    result = { error: e.message };
  }
  return (
    <div className="mt-5 rounded-lg border border-brand-100 bg-brand-50/50 p-3 text-xs">
      <p className="font-semibold text-brand-800 mb-2">수식 시험 계산 (한 기관)</p>
      <div className="grid grid-cols-3 gap-2">
        {Object.keys(TRIAL).map((k) => (
          <label key={k} className="block">
            <span className="block text-[11px] text-slate-500">#{k}</span>
            <input
              type="number"
              step={k === 'periodScale' ? 0.01 : 1}
              value={vars[k]}
              onChange={(e) => setVars((v) => ({ ...v, [k]: Number(e.target.value) }))}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 tabular-nums"
            />
          </label>
        ))}
      </div>
      <p className="mt-2">
        {result.error ? <span className="text-rose-600">{result.error}</span> : <>결과 <b className="text-sm text-brand-800">{fmt(result.fee)}원</b></>}
      </p>
    </div>
  );
}
