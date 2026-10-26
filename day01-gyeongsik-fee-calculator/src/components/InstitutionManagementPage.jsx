import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CircleCheck,
  Download,
  FileSpreadsheet,
  History,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  Plus,
  Power,
  PowerOff,
  ScanSearch,
  Search,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react';
import { api, apiEnabled, toLabel } from '../utils/api';
import { fmt } from '../utils/fee';
import { downloadInstitutions } from '../utils/excel';
import {
  INSTITUTION_TYPES,
  localInstitutions,
  longestMatch,
  matchExcelValue,
  replaceInstitutions,
  validateInstitution,
} from '../utils/institutions';
import { Card, Modal } from './ui';

const btnLine =
  'inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent';
const btnPrimary =
  'inline-flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50';
const btnCancel = 'rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-white';
const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-slate-100 disabled:text-slate-500';
const selectCls = 'rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300';
const EMPTY_FORM = { id: '', name: '', code: '', type: 'BANK', aliases: [], aliasInput: '' };

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

function Stat({ label, value, tone = 'text-brand-800' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tone}`}>{fmt(value)}</p>
    </div>
  );
}

// 사용 현황 한 줄 (산출 이력·대사·테스트·회원)
const usageText = (r) =>
  `산출 이력 ${fmt(r.calculationCount)}건 · 대사 ${fmt(r.reconcileCount)}건 · 테스트 결과 ${fmt(r.testCount)}건 · 연결 회원 ${fmt(r.memberCount)}명`;

// 관리자 설정 > 기관 관리: 저장된 모든 기관(사용 중지 포함)을 조회·추가·수정·사용 중지·삭제하고, 엑셀·이슈 매칭을 시험한다.
// 서버가 있으면 /api/v1/institutions(시스템관리자만), 없으면 같은 규칙의 utils/institutions.js 로 동작한다.
// 바꾼 기관은 엑셀 업로드 매칭·AI 이슈 인식·회비 산출에 다음 업로드부터 바로 쓰인다.
export default function InstitutionManagementPage({ user, runs, members, version, onChanged, notify }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all'); // all | active | inactive
  const [sourceFilter, setSourceFilter] = useState('all'); // all | demo | upload
  const [editing, setEditing] = useState(null); // null | { mode: 'add'|'edit', row, form, submitted, error }
  const [deactivating, setDeactivating] = useState(null); // row
  const [deleting, setDeleting] = useState(null); // { row, checked }
  const [busy, setBusy] = useState(false);
  const ctx = { runs, members };

  // ── 목록 ──
  const reload = async () => {
    if (!apiEnabled) {
      setRows(localInstitutions.list(ctx));
      return;
    }
    setLoading(true);
    setListError(null);
    try {
      const data = await api.adminInstitutions();
      replaceInstitutions(data); // 화면 전체(엑셀 매칭 미리보기·이름 표시)가 서버 목록을 보도록
      setRows(data);
    } catch (e) {
      setListError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, runs, members]);

  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (!q || [r.name, r.code, r.id, ...r.aliases].some((v) => v.toLowerCase().includes(q))) &&
      (typeFilter === 'all' || r.type === typeFilter) &&
      (statusFilter === 'all' || (statusFilter === 'active' ? r.active : !r.active)) &&
      (sourceFilter === 'all' || (sourceFilter === 'upload' ? r.uploadOnly : !r.uploadOnly)),
  );
  const stats = {
    total: rows.length,
    active: rows.filter((r) => r.active).length,
    inactive: rows.filter((r) => !r.active).length,
    uploadOnly: rows.filter((r) => r.uploadOnly).length,
    aliases: rows.reduce((s, r) => s + r.aliases.length, 0),
  };
  const filtered = q || typeFilter !== 'all' || statusFilter !== 'all' || sourceFilter !== 'all';

  // 서버면 API, 아니면 로컬. 끝나면 목록을 다시 읽고 App 에 알린다(산출 화면·회원 소속 표시 갱신)
  const mutate = async (serverCall, localCall, change = {}) => {
    const result = apiEnabled ? await serverCall() : localCall();
    await reload();
    onChanged(change);
    return result;
  };

  // ── 추가·수정 ──
  const form = editing?.form;
  const selfId = editing?.mode === 'edit' ? editing.row.id : null;
  // 입력할 때마다 서버와 같은 규칙으로 검증 (겹침은 사용 중지 기관까지)
  const check = useMemo(() => {
    if (!form) return null;
    try {
      return { ok: validateInstitution(form, selfId) };
    } catch (e) {
      return { field: e.field, message: e.message };
    }
  }, [form, selfId]);
  // 칸별 오류는 그 칸을 건드렸거나 한 번 저장을 눌렀을 때만 보여 준다
  const fieldError = (f) => {
    if (editing?.error?.field === f) return editing.error.message;
    return check?.field === f && (editing.submitted || editing.touched?.[f]) ? check.message : null;
  };

  const setForm = (patch) =>
    setEditing((e) => {
      const touched = { ...e.touched };
      Object.keys(patch).forEach((k) => {
        touched[k === 'aliasInput' ? 'aliases' : k] = true;
      });
      return { ...e, form: { ...e.form, ...patch }, touched, error: null };
    });
  const addAlias = () => {
    const parts = form.aliasInput.split(/[,\n]/).map((a) => a.trim()).filter(Boolean);
    if (!parts.length) return;
    setForm({ aliases: [...form.aliases, ...parts.filter((a) => !form.aliases.includes(a))], aliasInput: '' });
  };
  const removeAlias = (a) => setForm({ aliases: form.aliases.filter((x) => x !== a) });

  const openAdd = () => setEditing({ mode: 'add', row: null, form: EMPTY_FORM, submitted: false, error: null });
  const openEdit = (row) =>
    setEditing({
      mode: 'edit',
      row,
      form: { id: row.id, name: row.name, code: row.code, type: row.type, aliases: [...row.aliases], aliasInput: '' },
      submitted: false,
      error: null,
    });

  const submitEdit = async () => {
    const pending = form.aliasInput.trim() ? [...form.aliases, form.aliasInput.trim()] : form.aliases;
    const f = { ...form, aliases: pending, aliasInput: '' };
    let v;
    try {
      v = validateInstitution(f, selfId);
    } catch (e) {
      setEditing((ed) => ({ ...ed, form: f, submitted: true, error: { field: e.field, message: e.message } }));
      return;
    }
    const body = { id: editing.mode === 'add' ? v.id : undefined, name: v.name, code: v.code, type: v.type, aliases: v.aliases };
    setBusy(true);
    try {
      if (editing.mode === 'add') {
        const created = await mutate(
          () => api.createInstitution(body),
          () => localInstitutions.create(body, user.id, ctx),
        );
        notify(`${created.name}(${created.code}) 기관을 추가했습니다. 다음 실적 업로드부터 매칭됩니다.`);
      } else {
        const renamed = editing.row.name !== v.name ? { id: selfId, name: v.name } : null;
        const saved = await mutate(
          () => api.updateInstitution(selfId, body),
          () => localInstitutions.update(selfId, body, user.id, ctx),
          { renamed },
        );
        notify(`${saved.name} 기관 정보를 저장했습니다.`);
      }
      setEditing(null);
    } catch (e) {
      setEditing((ed) => ({
        ...ed,
        form: f,
        submitted: true,
        error: { field: e.data?.field ?? e.field ?? null, message: e.message },
      }));
    } finally {
      setBusy(false);
    }
  };

  // ── 사용 중지·다시 사용 ──
  const setActive = async (row, active) => {
    setBusy(true);
    try {
      await mutate(
        () => api.setInstitutionActive(row.id, active),
        () => localInstitutions.setActive(row.id, active, user.id, ctx),
      );
      notify(active ? `${row.name} 기관을 다시 사용합니다.` : `${row.name} 기관을 사용 중지했습니다. 엑셀 매칭·산출에서 빠집니다.`);
      setDeactivating(null);
      setDeleting(null);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  // ── 삭제 (어디에도 쓰이지 않은 기관만) ──
  const submitDelete = async () => {
    const { row } = deleting;
    setBusy(true);
    try {
      await mutate(
        () => api.deleteInstitution(row.id),
        () => localInstitutions.remove(row.id, ctx),
      );
      notify(`${row.name} 기관을 삭제했습니다.`);
      setDeleting(null);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-slate-400">관리자 설정</p>
        <h2 className="text-xl font-bold text-brand-900">기관 관리</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          회비 산출에 쓰는 참가기관을 조회·추가·수정합니다.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="전체 기관" value={stats.total} />
        <Stat label="사용 중" value={stats.active} tone="text-emerald-700" />
        <Stat label="사용 중지" value={stats.inactive} tone={stats.inactive ? 'text-rose-600' : 'text-slate-400'} />
        <Stat label="업로드 전용" value={stats.uploadOnly} tone="text-slate-700" />
        <Stat label="등록된 별칭" value={stats.aliases} tone="text-slate-700" />
      </div>

      <MatchTester version={version} />

      <Card
        title="기관 목록"
        icon={Building2}
        right={
          <div className="flex gap-2">
            <button onClick={() => downloadInstitutions(shown)} disabled={!shown.length} className={`${btnLine} py-1.5`}>
              <Download className="w-3.5 h-3.5" /> 엑셀
            </button>
            <button onClick={openAdd} className={btnPrimary}>
              <Plus className="w-4 h-4" /> 기관 추가
            </button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="기관명·기관코드·내부 ID·별칭 검색"
              className={`${inputCls} pl-9`}
            />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={selectCls} aria-label="구분">
            <option value="all">구분 전체</option>
            {INSTITUTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls} aria-label="상태">
            <option value="all">상태 전체</option>
            <option value="active">사용 중</option>
            <option value="inactive">사용 중지</option>
          </select>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={selectCls} aria-label="실적">
            <option value="all">실적 전체</option>
            <option value="demo">기본 실적 포함</option>
            <option value="upload">업로드 전용</option>
          </select>
          {filtered && (
            <button
              onClick={() => {
                setQuery('');
                setTypeFilter('all');
                setStatusFilter('all');
                setSourceFilter('all');
              }}
              className={btnLine}
            >
              <Undo2 className="w-3.5 h-3.5" /> 필터 초기화
            </button>
          )}
          <p className="text-xs text-slate-500 ml-auto">
            {filtered ? (
              <>
                <b className="text-brand-800">{shown.length}</b> / {rows.length}개
              </>
            ) : (
              <>
                전체 <b className="text-brand-800">{rows.length}</b>개
              </>
            )}
          </p>
          {loading && <LoaderCircle className="w-4 h-4 animate-spin text-brand-400" />}
        </div>
        {listError && <p className="text-xs text-rose-600 mb-2">{listError}</p>}

        <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[560px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0 z-10">
              <tr>
                <Th>기관명</Th>
                <Th>기관코드</Th>
                <Th>내부 ID</Th>
                <Th>구분</Th>
                <Th>별칭 (이슈·엑셀 매칭)</Th>
                <Th className="text-right">사용 현황</Th>
                <Th>상태</Th>
                <Th className="text-right">작업</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((r) => (
                <tr key={r.id} className={r.active ? 'hover:bg-slate-50/60' : 'bg-slate-50/80 text-slate-400'}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`font-semibold ${r.active ? 'text-brand-900' : 'text-slate-400 line-through'}`}>{r.name}</span>
                    {r.uploadOnly && (
                      <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500" title="업로드한 실적 파일에 있을 때만 산출 대상">
                        업로드 전용
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.id}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{r.typeLabel}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1 max-w-[260px]">
                      {r.aliases.length ? (
                        r.aliases.map((a) => (
                          <span key={a} className="rounded-full border border-brand-100 bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-700">
                            {a}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-slate-300">없음</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-[11px] text-slate-500 whitespace-nowrap" title={usageText(r)}>
                    <span className="inline-flex items-center gap-1">
                      <History className="w-3 h-3" /> 산출 {fmt(r.calculationCount)}
                    </span>
                    <span className="block">
                      대사 {fmt(r.reconcileCount)} · 테스트 {fmt(r.testCount)} · 회원 {fmt(r.memberCount)}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.active ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                        <CircleCheck className="w-3 h-3" /> 사용
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-600">
                        <PowerOff className="w-3 h-3" /> 사용 중지
                      </span>
                    )}
                    {r.updatedAt && (
                      <span className="block mt-0.5 text-[10px] text-slate-400">
                        {toLabel(r.updatedAt)} {r.updatedBy}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(r)} className={btnLine}>
                        <Pencil className="w-3.5 h-3.5" /> 수정
                      </button>
                      {r.active ? (
                        <button onClick={() => setDeactivating(r)} className={btnLine}>
                          <PowerOff className="w-3.5 h-3.5" /> 중지
                        </button>
                      ) : (
                        <button onClick={() => setActive(r, true)} disabled={busy} className={`${btnLine} border-emerald-300 text-emerald-700`}>
                          <Power className="w-3.5 h-3.5" /> 사용
                        </button>
                      )}
                      <button
                        onClick={() => setDeleting({ row: r, checked: false })}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
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
                    {rows.length ? '조건에 맞는 기관이 없습니다.' : '등록된 기관이 없습니다. [기관 추가]로 만들어 주세요.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <ul className="mt-2 space-y-0.5 text-[11px] text-slate-400 list-disc pl-4">
          <li>사용 중지한 기관은 회비 산출에서 빠지며, [사용]으로 되돌릴 수 있습니다.</li>
          <li>삭제는 산출 이력·대사·테스트 결과·연결 회원이 하나도 없는 기관만 할 수 있습니다.</li>
        </ul>
      </Card>

      {editing && (
        <Modal
          title={editing.mode === 'add' ? '기관 추가' : `기관 수정 — ${editing.row.name}`}
          width="max-w-xl"
          onClose={() => !busy && setEditing(null)}
          footer={
            <>
              <button onClick={() => setEditing(null)} disabled={busy} className={btnCancel}>
                취소
              </button>
              <button onClick={submitEdit} disabled={busy} className={btnPrimary}>
                {busy ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <CircleCheck className="w-3.5 h-3.5" />}
                {editing.mode === 'add' ? '기관 추가' : '저장'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="기관명" hint="공백 없이 입력 (엑셀 매칭은 공백을 지우고 비교)" error={fieldError('name')}>
                <input value={form.name} onChange={(e) => setForm({ name: e.target.value })} placeholder="예: 새봄저축은행" className={inputCls} autoFocus />
              </Field>
              <Field label="기관코드" hint="영문 대문자·숫자 2~10자. 엑셀의 기관코드 칸과 매칭" error={fieldError('code')}>
                <input
                  value={form.code}
                  onChange={(e) => setForm({ code: e.target.value.toUpperCase() })}
                  placeholder="예: B099"
                  className={`${inputCls} font-mono`}
                />
              </Field>
              <Field
                label="내부 ID"
                hint={editing.mode === 'add' ? '비우면 기관코드 소문자. 만든 뒤에는 바꿀 수 없습니다.' : '바꿀 수 없습니다.'}
                error={fieldError('id')}
              >
                <input
                  value={editing.mode === 'add' ? form.id : editing.row.id}
                  onChange={(e) => setForm({ id: e.target.value.toLowerCase() })}
                  placeholder={form.code.trim().toLowerCase() || 'b099'}
                  disabled={editing.mode === 'edit'}
                  className={`${inputCls} font-mono`}
                />
              </Field>
              <Field label="구분">
                <select value={form.type} onChange={(e) => setForm({ type: e.target.value })} className={`${inputCls} bg-white`}>
                  {INSTITUTION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field
              label={`별칭 (${form.aliases.length}/10)`}
              hint="이 기관으로 인식할 다른 이름 (예: 약칭). Enter 또는 쉼표로 추가"
              error={fieldError('aliases')}
            >
              <div className="rounded-lg border border-slate-300 px-2 py-1.5 focus-within:ring-2 focus-within:ring-brand-300">
                <div className="flex flex-wrap gap-1">
                  {form.aliases.map((a) => (
                    <span key={a} className="inline-flex items-center gap-0.5 rounded-full bg-brand-50 border border-brand-100 pl-2 pr-1 py-0.5 text-xs text-brand-700">
                      {a}
                      <button type="button" onClick={() => removeAlias(a)} className="rounded-full p-0.5 hover:bg-brand-100" aria-label={`${a} 삭제`}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    value={form.aliasInput}
                    onChange={(e) => setForm({ aliasInput: e.target.value })}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ',') && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        addAlias();
                      } else if (e.key === 'Backspace' && !form.aliasInput && form.aliases.length) {
                        removeAlias(form.aliases[form.aliases.length - 1]);
                      }
                    }}
                    onBlur={addAlias}
                    placeholder={form.aliases.length ? '' : '예: 새봄, I은행'}
                    className="flex-1 min-w-[120px] px-1 py-0.5 text-sm focus:outline-none"
                  />
                </div>
              </div>
            </Field>
            {editing.mode === 'edit' &&
              form.name.trim() &&
              form.name.trim() !== editing.row.name &&
              !form.aliases.includes(editing.row.name) && (
                <button type="button" onClick={() => setForm({ aliases: [...form.aliases, editing.row.name] })} className={btnLine}>
                  <Plus className="w-3.5 h-3.5" /> 이전 이름 '{editing.row.name}'을(를) 별칭으로 남기기 (예전 양식 엑셀도 매칭)
                </button>
              )}

            {check?.ok && !editing.error ? (
              <p className="flex items-center gap-1.5 text-xs text-emerald-700">
                <CircleCheck className="w-3.5 h-3.5" /> 다른 기관(사용 중지 포함)과 겹치는 기관코드·이름·별칭이 없습니다.
              </p>
            ) : (
              (editing.error || (editing.submitted && check?.message)) && (
                <p role="alert" className="flex items-center gap-1.5 text-xs text-rose-600">
                  <TriangleAlert className="w-3.5 h-3.5 shrink-0" /> {editing.error?.message ?? check.message}
                </p>
              )
            )}

            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] text-slate-600 space-y-0.5">
              {editing.mode === 'add' ? (
                <>
                  <p>· 다음 실적 엑셀 업로드부터 산출 대상이 됩니다.</p>
                </>
              ) : (
                <>
                  <p>· 다음 업로드부터 반영됩니다. 이미 올린 파일은 다시 올려 주세요.</p>
                  <p>· 지난 산출 이력 {fmt(editing.row.calculationCount)}건·대사 {fmt(editing.row.reconcileCount)}건은 산출 당시 이름·코드 그대로 남습니다.</p>
                  {editing.row.memberCount > 0 && <p>· 이름을 바꾸면 연결된 참가기관 회원 {fmt(editing.row.memberCount)}명의 소속 표시도 바뀝니다.</p>}
                </>
              )}
            </div>
          </div>
        </Modal>
      )}

      {deactivating && (
        <Modal
          title="기관 사용 중지"
          onClose={() => !busy && setDeactivating(null)}
          footer={
            <>
              <button onClick={() => setDeactivating(null)} disabled={busy} className={btnCancel}>
                취소
              </button>
              <button
                onClick={() => setActive(deactivating, false)}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:bg-rose-300"
              >
                {busy ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <PowerOff className="w-3.5 h-3.5" />}
                사용 중지
              </button>
            </>
          }
        >
          <div className="text-sm text-slate-700 space-y-2">
            <p className="font-semibold">
              {deactivating.name} ({deactivating.code}) 기관을 사용 중지하시겠습니까?
            </p>
            <ul className="list-disc pl-5 text-xs text-slate-600 space-y-1">
              <li>실적 업로드·이슈 입력·회비 산출에서 이 기관이 빠집니다.</li>
              <li>지난 산출 이력 {fmt(deactivating.calculationCount)}건·대사 {fmt(deactivating.reconcileCount)}건은 그대로 남습니다.</li>
              {deactivating.memberCount > 0 && (
                <li>연결된 참가기관 회원 {fmt(deactivating.memberCount)}명의 계정은 그대로이며, 필요하면 회원 관리에서 따로 정리해 주세요.</li>
              )}
              <li>기관코드·이름·별칭은 계속 예약되어 다른 기관에 쓸 수 없고, [사용]으로 언제든 되돌릴 수 있습니다.</li>
            </ul>
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="기관 삭제"
          onClose={() => !busy && setDeleting(null)}
          footer={
            <>
              <button onClick={() => setDeleting(null)} disabled={busy} className={btnCancel}>
                취소
              </button>
              {deleting.row.deletable ? (
                <button
                  onClick={submitDelete}
                  disabled={!deleting.checked || busy}
                  className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:bg-rose-300"
                >
                  {busy ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  삭제
                </button>
              ) : (
                deleting.row.active && (
                  <button onClick={() => setActive(deleting.row, false)} disabled={busy} className={btnPrimary}>
                    <PowerOff className="w-3.5 h-3.5" /> 대신 사용 중지
                  </button>
                )
              )}
            </>
          }
        >
          <div role="alertdialog" className="flex gap-3">
            <TriangleAlert className="w-9 h-9 text-rose-500 shrink-0" />
            {deleting.row.deletable ? (
              <div className="text-sm text-slate-700 space-y-2">
                <p className="font-semibold text-rose-700">
                  {deleting.row.name} ({deleting.row.code}) 기관을 삭제하시겠습니까? 되돌릴 수 없습니다.
                </p>
                <p className="text-xs text-slate-600">
                  삭제하면 기관코드·이름·별칭을 다른 기관에 다시 쓸 수 있습니다.
                </p>
                <label className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  <input
                    type="checkbox"
                    checked={deleting.checked}
                    onChange={(e) => setDeleting((d) => ({ ...d, checked: e.target.checked }))}
                  />
                  위 내용을 확인했으며 기관을 삭제합니다.
                </label>
              </div>
            ) : (
              <div className="text-sm text-slate-700 space-y-2">
                <p className="font-semibold text-rose-700">{deleting.row.name} 기관은 삭제할 수 없습니다.</p>
                <p className="text-xs text-slate-600">
                  {usageText(deleting.row)}이 있어, 지우면 지난 산출·대사 기록과 회원 소속이 가리킬 기관이 사라집니다.
                  {deleting.row.active ? ' 더 이상 쓰지 않는 기관이면 사용 중지로 바꿔 주세요.' : ' 이미 사용 중지된 기관입니다.'}
                </p>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// 매칭 시험: 입력한 값이 지금 실적 엑셀의 기관 칸·AI 이슈 문장에서 어느 기관으로 잡히는지 (사용 중인 기관 기준)
function MatchTester({ version }) {
  const [value, setValue] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const v = value.trim();
    setError(null);
    if (!v) {
      setResult(null);
      return undefined;
    }
    if (!apiEnabled) {
      const e = matchExcelValue(v);
      const i = longestMatch(v);
      setResult({
        excel: e && { id: e.inst.id, name: e.inst.name, code: e.inst.code, matchedBy: e.matchedBy },
        issue: i && { id: i.inst.id, name: i.inst.name, code: i.inst.code, matchedBy: i.alias },
      });
      return undefined;
    }
    let alive = true;
    const t = setTimeout(() => {
      api
        .matchInstitution(v)
        .then((r) => alive && setResult(r))
        .catch((e) => alive && setError(e.message));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [value, version]);

  const Result = ({ icon: Icon, title, m }) => (
    <div className={`flex-1 rounded-lg border px-3 py-2 ${m ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'}`}>
      <p className="flex items-center gap-1 text-[11px] text-slate-500">
        <Icon className="w-3.5 h-3.5" /> {title}
      </p>
      {m ? (
        <p className="text-sm">
          <b className="text-brand-900">{m.name}</b> <span className="font-mono text-xs text-slate-500">{m.code}</span>
          <span className="block text-[11px] text-emerald-700">'{m.matchedBy}'(으)로 매칭</span>
        </p>
      ) : (
        <p className="text-sm text-slate-400">{value.trim() ? '찾지 못함 (산출에서 제외)' : '-'}</p>
      )}
    </div>
  );

  return (
    <Card title="매칭 시험" icon={ScanSearch}>
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
        <div className="lg:w-80">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="엑셀 기관 칸 값이나 이슈 문장 (예: B088, 하나온은행 장애 100건)"
            className={inputCls}
          />
        </div>
        <Result icon={FileSpreadsheet} title="실적 엑셀 기관 칸으로 읽으면" m={result?.excel} />
        <Result icon={MessageSquareText} title="이슈 문장으로 읽으면" m={result?.issue} />
      </div>
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </Card>
  );
}
