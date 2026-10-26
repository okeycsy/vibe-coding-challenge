import { useEffect, useState } from 'react';
import { CircleCheck, FileCode2, FilePen, LoaderCircle, Lock, Sparkles } from 'lucide-react';
import { api, apiEnabled } from '../utils/api';
import { localSkillDetail, localSkillList, validateSkill } from '../utils/skill';
import { Card, Modal } from './ui';
import SkillDocumentEditor from './SkillDocumentEditor';
import SkillFormulaBuilder from './SkillFormulaBuilder';

const LOCKED_MSG = '해당 업무의 권한을 먼저 신청하여 승인받아야 합니다.';
// [회비기준(Skill.md) 관리] 하위 메뉴 2개
export const SKILL_PAGES = [
  { id: 'skills-document', label: '① 기준 문서 편집', icon: FilePen, desc: '자연어 규칙(1·2·4번)과 머리말을 작성·관리합니다.' },
  { id: 'skills-builder', label: '② AI 계산식 빌더', icon: Sparkles, desc: '자연어 규칙으로 정산 수식과 후처리 스크립트를 만들고 시험한 뒤 반영합니다.' },
];

const nowLabel = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const pickMeta = (d) => ({ lastModified: d.lastModified, size: d.size, version: d.version, modified: d.modified });

// 업무별 회비분담기준(skill.md) 관리: 왼쪽 업무 목록(권한별 잠금) + 오른쪽 [① 기준 문서 편집] 또는 [② AI 계산식 빌더].
// 두 화면은 같은 업무 선택·저장(PUT /api/v1/skills/{코드} 또는 Mock 상태)을 쓰고, 저장하면 skillVersion 을 올려 산출 화면과 맞춘다.
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
  page,
  onChangePage,
}) {
  const [list, setList] = useState([]);
  const [listError, setListError] = useState(null);
  const [selected, setSelected] = useState(null); // 업무 ID
  const [detail, setDetail] = useState(null);
  const [detailSeq, setDetailSeq] = useState(0); // 저장·되돌리기마다 올려 편집 화면을 새 내용으로 다시 연다
  const [loading, setLoading] = useState(false);
  const [lockedItem, setLockedItem] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [builderTab, setBuilderTab] = useState('formula'); // AI 계산식 빌더: 3번 수식 | 4번 후처리 스크립트
  const current = SKILL_PAGES.find((p) => p.id === page) ?? SKILL_PAGES[0];

  const showDetail = (d) => {
    setDetail(d);
    setDetailSeq((n) => n + 1);
    setDirty(false);
  };

  // ── 업무 목록 (권한이 바뀌면 다시 읽는다) ──
  useEffect(() => {
    let alive = true;
    setListError(null);
    (apiEnabled ? api.skills() : Promise.resolve(localSkillList(tasks, allowedTasks, overrides)))
      .then((rows) => alive && setList(rows))
      .catch((e) => alive && setListError(e.message));
    return () => {
      alive = false;
    };
  }, [user.id, allowedTasks, overrides, tasks]);

  // 처음 열 때: 산출 화면에서 넘어온 업무 → 접근 가능한 첫 업무
  useEffect(() => {
    if (!list.length) return;
    const cur = list.find((r) => r.businessId === selected);
    if (cur?.accessible) return;
    const wanted = list.find((r) => r.businessId === target && r.accessible) ?? list.find((r) => r.accessible);
    if (wanted) open(wanted.businessId, true);
    else {
      setSelected(null);
      setDetail(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, target]);

  const confirmLeave = () => !dirty || window.confirm('저장하지 않은 수정 내용이 있습니다. 버리고 이동할까요?');

  const open = async (businessId, force = false) => {
    if (!force && !confirmLeave()) return;
    const task = tasks.find((t) => t.businessId === businessId);
    setSelected(businessId);
    setLoading(true);
    try {
      showDetail(apiEnabled ? await api.skill(businessId) : localSkillDetail(task, overrides));
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

  const switchPage = (id) => {
    if (id === page || !confirmLeave()) return;
    setDirty(false);
    onChangePage(id);
  };

  // ── 저장: 두 화면 공용. 서버는 3단계 검증(섹션·구문·시험 계산) 후 원자적 교체, Mock 은 같은 검증 후 화면 상태에 둔다 ──
  const saveContent = async (content, message) => {
    let saved;
    if (apiEnabled) {
      saved = await api.saveSkill(detail.taskCode, content);
      setList((rows) => rows.map((r) => (r.taskCode === saved.taskCode ? { ...r, ...pickMeta(saved) } : r)));
    } else {
      validateSkill(detail.taskCode, content);
      const next = { ...overrides, [detail.taskCode]: { content, lastModified: nowLabel(), updatedBy: user.id } };
      setOverrides(next);
      saved = localSkillDetail(tasks.find((t) => t.businessId === selected), next);
    }
    showDetail(saved);
    onSaved();
    notify(message ?? `${detail.taskName} 회비분담기준(skill.md)이 성공적으로 저장 및 반영되었습니다.`);
    return saved;
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
      showDetail(d);
      onSaved();
      notify('초기 기준 skill.md로 되돌렸습니다.');
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const accessibleCount = list.filter((r) => r.accessible).length;
  const shared = { user, notify, detail, saveContent, onDirty: setDirty };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-brand-900">회비기준(Skill.md) 관리 · {current.label}</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {current.desc} 저장하면 다음 회비 산출부터 반영됩니다.
          </p>
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm shadow-sm" role="tablist">
          {SKILL_PAGES.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={p.id === current.id}
              onClick={() => switchPage(p.id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 ${
                p.id === current.id ? 'bg-brand-700 text-white' : 'text-slate-500 hover:text-brand-700'
              }`}
            >
              <p.icon className="w-4 h-4" /> {p.label}
            </button>
          ))}
        </div>
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
                      {r.accessible ? <FileCode2 className="w-4 h-4 text-brand-500 shrink-0" /> : <Lock className="w-4 h-4 shrink-0" />}
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

        {/* 오른쪽: 선택한 하위 메뉴 */}
        <div className="xl:col-span-3 min-w-0">
          {!detail ? (
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm py-24 text-center text-sm text-slate-400">
              {loading ? (
                <LoaderCircle className="w-6 h-6 mx-auto animate-spin text-brand-400" />
              ) : accessibleCount === 0 && list.length ? (
                '접근 가능한 업무가 없습니다. 내 정보 관리에서 담당 업무 권한을 신청해 주세요.'
              ) : (
                '왼쪽에서 업무를 선택하세요.'
              )}
            </section>
          ) : current.id === 'skills-builder' ? (
            <SkillFormulaBuilder
              key={`${detailSeq}-${builderTab}`}
              {...shared}
              tab={builderTab}
              onTab={(t) => {
                if (t === builderTab || (dirty && !window.confirm('저장하지 않은 수정 내용이 있습니다. 다른 탭으로 이동할까요?'))) return;
                setDirty(false);
                setBuilderTab(t);
              }}
              onGoDocument={() => switchPage('skills-document')}
            />
          ) : (
            <SkillDocumentEditor
              key={detailSeq}
              {...shared}
              onReset={user.role === 'sysadmin' && detail.modified ? resetToDefault : null}
              onGoBuilder={(t = 'formula') => {
                if (page === 'skills-builder' || !confirmLeave()) return;
                setBuilderTab(t);
                setDirty(false);
                onChangePage('skills-builder');
              }}
            />
          )}
        </div>
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
