import { useEffect, useState } from 'react';
import { Briefcase, CircleCheck, FileCode2, FilePlus2, LoaderCircle, Plus, Search, Trash2, TriangleAlert } from 'lucide-react';
import { api, apiEnabled, toLabel } from '../utils/api';
import { fmt } from '../utils/fee';
import { checkNewTask, localTaskList, skeletonTemplate } from '../utils/skill';
import { Card, Modal } from './ui';

const btnLine =
  'inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent';
const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-slate-100 disabled:text-slate-500';
const EMPTY_FORM = { name: '', taskCode: '', fileName: '' };

function Th({ children, className = '' }) {
  return <th className={`px-3 py-2 text-left font-medium whitespace-nowrap ${className}`}>{children}</th>;
}

function Field({ label, hint, error, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      {children}
      {error ? (
        <span className="block mt-1 text-[11px] text-rose-600">{error}</span>
      ) : (
        hint && <span className="block mt-1 text-[11px] text-slate-400">{hint}</span>
      )}
    </label>
  );
}

// 관리자 설정 > 업무 관리: 업무 조회·추가·삭제. 업무 1개 = md 파일(skill.md) 1개
export default function TaskManagementPage({ tasks, members, overrides, onAddTask, onDeleteTask, onOpenSkill, notify }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(null); // null | { form, error: { field, message } }
  const [deleting, setDeleting] = useState(null); // null | { row, checked }
  const [busy, setBusy] = useState(false);

  // 서버가 있으면 서버 목록(파일 크기·작성 상태·권한 보유자 수 포함), 없으면 화면 상태로 같은 모양을 만든다
  useEffect(() => {
    if (!apiEnabled) {
      setRows(localTaskList(tasks, overrides, members));
      return undefined;
    }
    let alive = true;
    setLoading(true);
    setListError(null);
    api
      .tasks()
      .then((data) => alive && setRows(data))
      .catch((e) => alive && setListError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [tasks, overrides, members]);

  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) => !q || [r.name, r.taskCode, r.fileName].some((v) => v.toLowerCase().includes(q)),
  );
  const added = rows.filter((r) => !r.builtIn).length;

  // ── 추가 ──
  const form = adding?.form;
  const setForm = (patch) => setAdding((a) => ({ form: { ...a.form, ...patch }, error: null }));
  // 파일명을 비우면 업무 코드로 만든다 (서버도 같다)
  const fileNamePreview = form && `${(form.fileName.trim() || form.taskCode.trim().toUpperCase() || 'NEW_TASK').replace(/\.md$/i, '')}.md`;

  const submitAdd = async () => {
    let checked;
    try {
      checked = checkNewTask(rows, form);
    } catch (e) {
      setAdding((a) => ({ ...a, error: { field: e.field, message: e.message } }));
      return;
    }
    setBusy(true);
    try {
      const created = await onAddTask({ ...form, ...checked });
      setAdding(null);
      notify(`${created.name} 업무를 추가하고 ${created.fileName} 파일을 만들었습니다.`);
    } catch (e) {
      setAdding((a) => ({ ...a, error: { field: null, message: e.message } }));
    } finally {
      setBusy(false);
    }
  };

  // ── 삭제 ──
  const submitDelete = async () => {
    const { row } = deleting;
    setBusy(true);
    try {
      await onDeleteTask(row.taskCode);
      setDeleting(null);
      notify(`${row.name} 업무와 ${row.fileName} 파일을 삭제했습니다.`);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const memberCountOf = (row) => row.memberCount ?? 0;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-slate-400">관리자 설정</p>
        <h2 className="text-xl font-bold text-brand-900">업무 관리</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          회비 산출 업무를 조회·추가·삭제합니다. 업무마다 회비분담기준 md 파일이 정확히 하나 연결되며, 새 업무의 md 파일은
          기본 템플릿의 제목·섹션·formula 블록 뼈대만 들어간 채로 만들어집니다.
        </p>
      </div>

      <Card
        title="업무 목록"
        icon={Briefcase}
        right={
          <button
            onClick={() => setAdding({ form: EMPTY_FORM, error: null })}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800"
          >
            <Plus className="w-4 h-4" /> 업무 추가
          </button>
        }
      >
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="업무명·업무 코드·파일명 검색"
              className={`${inputCls} pl-9`}
            />
          </div>
          <p className="text-xs text-slate-500">
            전체 <b className="text-brand-800">{rows.length}</b>개 · 기본 {rows.length - added}개 · 추가 {added}개
          </p>
          {loading && <LoaderCircle className="w-4 h-4 animate-spin text-brand-400" />}
        </div>
        {listError && <p className="text-xs text-rose-600 mb-2">{listError}</p>}

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <Th>업무명</Th>
                <Th>업무 코드</Th>
                <Th>매핑된 md 파일</Th>
                <Th>구분</Th>
                <Th>회비기준 상태</Th>
                <Th className="text-right">권한 보유 담당자</Th>
                <Th>최종 수정</Th>
                <Th className="text-right">작업</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((r) => (
                <tr key={r.taskCode} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2.5 font-semibold text-brand-900 whitespace-nowrap">{r.name}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{r.taskCode}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1 font-mono text-xs text-slate-700">
                      <FileCode2 className="w-3.5 h-3.5 text-brand-500" /> {r.fileName}
                    </span>
                    <span className="block text-[11px] text-slate-400">{fmt(r.size)}바이트</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.builtIn ? (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">기본</span>
                    ) : (
                      <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-700">추가</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.ready ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                        <CircleCheck className="w-3 h-3" /> 산출 기준 작성됨
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                        <TriangleAlert className="w-3 h-3" /> 작성 필요 (뼈대만 있음)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmt(memberCountOf(r))}명</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                    {toLabel(r.lastModified) ?? '초기 기준'}
                    {r.createdBy && <span className="block text-[11px] text-slate-400">생성 {r.createdBy}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => onOpenSkill(r.businessId)} className={btnLine} title="회비기준(Skill.md) 관리에서 열기">
                        <FileCode2 className="w-3.5 h-3.5" /> md 편집
                      </button>
                      <button
                        onClick={() => setDeleting({ row: r, checked: false })}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> 삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">
                    {rows.length ? '검색 결과가 없습니다.' : '등록된 업무가 없습니다. [업무 추가]로 만들어 주세요.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          새로 추가한 업무는 [md 편집]에서 비어 있는 요약·AI 차감 지침·정산 수식을 채워 저장하면 회비 산출에 쓸 수 있습니다. 업무별 담당자
          권한은 [업무 권한 관리]에서 따로 관리합니다.
        </p>
      </Card>

      {adding && (
        <Modal
          title="업무 추가"
          onClose={() => !busy && setAdding(null)}
          footer={
            <>
              <button onClick={() => setAdding(null)} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-white">
                취소
              </button>
              <button
                onClick={submitAdd}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
              >
                {busy ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <FilePlus2 className="w-3.5 h-3.5" />}
                업무 추가 및 md 파일 생성
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="업무명" error={adding.error?.field === 'name' && adding.error.message}>
              <input value={form.name} onChange={(e) => setForm({ name: e.target.value })} placeholder="예: 지로" className={inputCls} autoFocus />
            </Field>
            <Field
              label="업무 코드"
              hint="영문 대문자로 시작, 대문자·숫자·밑줄(_) 2~30자. 권한·산출에서 업무를 구분하는 값이라 만든 뒤에는 바꿀 수 없습니다."
              error={adding.error?.field === 'taskCode' && adding.error.message}
            >
              <input
                value={form.taskCode}
                onChange={(e) => setForm({ taskCode: e.target.value.toUpperCase() })}
                placeholder="예: GIRO"
                className={`${inputCls} font-mono`}
              />
            </Field>
            <Field
              label="md 파일명"
              hint="비우면 업무 코드로 만듭니다. 영문·숫자·밑줄(_)·하이픈(-)만 쓸 수 있고, 이미 다른 업무에 연결된 파일명은 쓸 수 없습니다."
              error={adding.error?.field === 'fileName' && adding.error.message}
            >
              <div className="flex items-center gap-2">
                <input
                  value={form.fileName}
                  onChange={(e) => setForm({ fileName: e.target.value })}
                  placeholder={form.taskCode.trim() || 'NEW_TASK'}
                  className={`${inputCls} font-mono`}
                />
                <span className="font-mono text-xs text-slate-400 shrink-0">→ {fileNamePreview}</span>
              </div>
            </Field>
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">처음 만들어질 {fileNamePreview} 내용 (기본 템플릿 뼈대, 내용은 [md 편집]에서 채움)</p>
              <pre className="rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100 whitespace-pre-wrap">
                {skeletonTemplate({ name: form.name.trim() || '업무명', taskCode: form.taskCode.trim().toUpperCase() || 'NEW_TASK' })}
              </pre>
            </div>
            {adding.error && !adding.error.field && (
              <p role="alert" className="flex items-center gap-1.5 text-xs text-rose-600">
                <TriangleAlert className="w-3.5 h-3.5" /> {adding.error.message}
              </p>
            )}
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="업무 삭제 경고"
          onClose={() => !busy && setDeleting(null)}
          footer={
            <>
              <button onClick={() => setDeleting(null)} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-white">
                취소
              </button>
              <button
                onClick={submitDelete}
                disabled={!deleting.checked || busy}
                className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:bg-rose-300"
              >
                {busy ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                삭제
              </button>
            </>
          }
        >
          <div role="alertdialog" className="flex gap-3">
            <TriangleAlert className="w-9 h-9 text-rose-500 shrink-0" />
            <div className="text-sm text-slate-700 space-y-2">
              <p className="font-semibold text-rose-700">
                {deleting.row.name} ({deleting.row.taskCode}) 업무를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
              </p>
              <ul className="list-disc pl-5 text-xs text-slate-600 space-y-1">
                <li>
                  연결된 <code className="font-mono">{deleting.row.fileName}</code> 파일(회비분담기준·정산 수식)이 함께 삭제됩니다.
                </li>
                <li>이 업무 권한을 가진 담당자 {fmt(memberCountOf(deleting.row))}명의 권한이 해제되고, 승인 대기 중인 권한 신청은 반려됩니다.</li>
                <li>회비 산출 화면과 회비기준(Skill.md) 관리 목록에서 이 업무가 사라집니다.</li>
                {deleting.row.builtIn && <li className="text-rose-600">기본 제공 업무입니다. 삭제하면 초기 기준으로 복원할 수 없습니다.</li>}
              </ul>
              <label className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <input
                  type="checkbox"
                  checked={deleting.checked}
                  onChange={(e) => setDeleting((d) => ({ ...d, checked: e.target.checked }))}
                />
                위 내용을 확인했으며 업무와 md 파일을 삭제합니다.
              </label>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
