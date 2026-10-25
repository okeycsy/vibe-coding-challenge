import { useState } from 'react';
import {
  Check,
  KeyRound,
  ListChecks,
  Lock,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Unlock,
  UserCheck,
  Users,
  UserX,
} from 'lucide-react';
import { BUSINESSES, DEFAULT_PASSWORD, INSTITUTIONS, ROLES } from '../data/mockData';
import { Card, Modal } from './ui';

// 관리자 설정은 하위 메뉴마다 별도 페이지다 (회원 관리 / 업무 권한 관리).
export const ADMIN_PAGES = {
  'admin-members': {
    title: '회원 관리',
    desc: '모든 회원을 추가·수정·삭제하고, 가입 신청 승인과 잠긴 계정 해제를 처리합니다.',
  },
  'admin-tasks': {
    title: '업무 권한 관리',
    desc: '회원의 업무 권한 신청을 승인·반려하고, 회원별 산출 권한을 부여하거나 해제합니다.',
  },
};

const STATUS_TONE = {
  정상: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  승인대기: 'bg-amber-50 text-amber-700 border-amber-200',
  반려: 'bg-slate-100 text-slate-500 border-slate-200',
  잠김: 'bg-rose-50 text-rose-700 border-rose-200',
};
const REQUEST_TONE = {
  '승인 대기중': 'bg-amber-50 text-amber-700 border-amber-200',
  승인: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  반려: 'bg-rose-50 text-rose-700 border-rose-200',
};
const ROLE_TONE = {
  operator: 'bg-brand-50 text-brand-700',
  sysadmin: 'bg-amber-100 text-amber-800',
  institution: 'bg-emerald-50 text-emerald-700',
};

const bizName = (id) => BUSINESSES.find((b) => b.id === id)?.name;
const btnPrimary =
  'inline-flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1 text-xs text-white hover:bg-brand-800 disabled:opacity-40';
const btnLine =
  'inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent';
const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-slate-100 disabled:text-slate-500';

function Th({ children }) {
  return <th className="px-3 py-2 text-left font-medium whitespace-nowrap">{children}</th>;
}

function Field({ label, error, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      {children}
      {error && <span className="block mt-1 text-[11px] text-rose-600">{error}</span>}
    </label>
  );
}

export default function AdminSettings({ page, ...props }) {
  const info = ADMIN_PAGES[page] ?? ADMIN_PAGES['admin-members'];
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-slate-400">관리자 설정</p>
        <h2 className="text-xl font-bold text-brand-900">{info.title}</h2>
        <p className="text-sm text-slate-500 mt-0.5">{info.desc}</p>
      </div>
      {page === 'admin-tasks' ? <TaskPermissions {...props} /> : <MemberManagement {...props} />}
    </div>
  );
}

// ───────────────────────── 1. 회원 관리 ─────────────────────────

const EMPTY_FORM = {
  id: '',
  name: '',
  role: 'operator',
  institutionId: 'shinhan',
  dept: '',
  empNo: '',
  email: '',
  extension: '',
  password: DEFAULT_PASSWORD,
};

function MemberManagement({
  me,
  members,
  onAddMember,
  onUpdateMember,
  onDeleteMember,
  notify,
  isLocked,
  loginLocks,
  maxAttempts,
  onUnlock,
}) {
  const [filter, setFilter] = useState('전체');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null); // null | { mode: 'add' | 'edit', form, errors }
  const [deleting, setDeleting] = useState(null);

  const statusOf = (m) => (m.status === '정상' && isLocked(m.id) ? '잠김' : m.status);
  const counts = { 전체: members.length };
  members.forEach((m) => {
    const s = statusOf(m);
    counts[s] = (counts[s] ?? 0) + 1;
  });

  const q = query.trim().toLowerCase();
  const list = members.filter(
    (m) =>
      (filter === '전체' || statusOf(m) === filter) &&
      (!q || [m.id, m.name, m.org, m.dept, m.email, m.empNo].some((v) => v?.toLowerCase().includes(q))),
  );

  const decide = (m, status) => {
    onUpdateMember(m.id, { status });
    notify(`${m.org} ${m.name}님의 가입을 ${status === '정상' ? '승인' : '반려'}했습니다.`);
  };

  const openAdd = () => setEditing({ mode: 'add', form: EMPTY_FORM, errors: {} });
  const openEdit = (m) =>
    setEditing({
      mode: 'edit',
      form: { ...EMPTY_FORM, ...m, institutionId: m.institutionId ?? 'shinhan' },
      errors: {},
    });
  const setField = (k, v) =>
    setEditing((e) => ({ ...e, form: { ...e.form, [k]: v }, errors: { ...e.errors, [k]: null } }));

  const save = () => {
    const { mode, form } = editing;
    const f = { ...form, id: form.id.trim(), name: form.name.trim(), email: form.email.trim() };
    const errors = {};
    if (mode === 'add') {
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(f.id)) errors.id = '영문·숫자·_ 3~20자로 입력해 주세요.';
      else if (members.some((m) => m.id === f.id)) errors.id = '이미 사용 중인 ID입니다.';
      if (f.password.length < 4) errors.password = '4자 이상 입력해 주세요.';
    }
    if (!f.name) errors.name = '이름을 입력해 주세요.';
    if (!f.dept.trim()) errors.dept = '부서를 입력해 주세요.';
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) errors.email = '이메일 형식을 확인해 주세요.';
    if (Object.keys(errors).length) return setEditing((e) => ({ ...e, errors }));

    const inst = INSTITUTIONS.find((i) => i.id === f.institutionId);
    const isInst = f.role === 'institution';
    const data = {
      name: f.name,
      role: f.role,
      org: isInst ? inst.name : '금융결제원',
      institutionId: isInst ? inst.id : undefined,
      dept: f.dept.trim(),
      empNo: f.empNo.trim(),
      email: f.email,
      extension: f.extension.trim(),
    };
    if (mode === 'add') {
      onAddMember({
        ...data,
        id: f.id,
        password: f.password,
        status: '정상',
        joinedAt: new Date().toISOString().slice(0, 10),
        tasks: [],
      });
      notify(`${data.name}(${f.id}) 회원을 추가했습니다.`);
    } else {
      const prev = members.find((m) => m.id === f.id);
      // 사용자 권한이 아니게 되면 업무 권한은 의미가 없으므로 비운다.
      onUpdateMember(f.id, { ...data, tasks: f.role === 'operator' && prev.role === 'operator' ? prev.tasks : [] });
      notify(`${data.name}(${f.id}) 회원 정보를 수정했습니다.`);
    }
    setEditing(null);
  };

  const resetPassword = () => {
    onUpdateMember(editing.form.id, { password: DEFAULT_PASSWORD });
    notify(`${editing.form.name}님의 비밀번호를 초기 비밀번호(${DEFAULT_PASSWORD})로 초기화했습니다.`);
  };

  const confirmDelete = () => {
    onDeleteMember(deleting.id);
    notify(`${deleting.name}(${deleting.id}) 회원을 삭제했습니다.`);
    setDeleting(null);
  };

  const FILTERS = ['전체', '정상', '승인대기', '잠김', '반려'];
  const form = editing?.form;
  const errors = editing?.errors ?? {};
  const editingSelf = editing?.mode === 'edit' && form.id === me.id;

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['전체 회원', counts.전체, 'text-brand-900', '전체'],
          ['정상', counts.정상 ?? 0, 'text-emerald-600', '정상'],
          ['가입 승인대기', counts.승인대기 ?? 0, 'text-amber-600', '승인대기'],
          ['잠긴 계정', counts.잠김 ?? 0, 'text-rose-600', '잠김'],
        ].map(([label, n, tone, f]) => (
          <button
            key={label}
            onClick={() => setFilter(f)}
            className={`text-left rounded-xl border bg-white px-4 py-3 shadow-sm hover:border-brand-300 ${
              filter === f ? 'border-brand-400 ring-2 ring-brand-100' : 'border-slate-200'
            }`}
          >
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{n}</p>
          </button>
        ))}
      </div>

      <Card
        title="회원 목록"
        icon={Users}
        right={
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-700 px-3 py-1.5 text-sm text-white hover:bg-brand-800"
          >
            <Plus className="w-4 h-4" /> 회원 추가
          </button>
        }
      >
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1 ${filter === f ? 'bg-brand-700 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                {f} {counts[f] ?? 0}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[200px] max-w-xs ml-auto">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ID·이름·소속·이메일 검색"
              className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                {['ID', '이름 / 사번 · 이메일', '권한', '소속 / 부서', '가입일', '상태', '관리'].map((h) => (
                  <Th key={h}>{h}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((m) => {
                const st = statusOf(m);
                return (
                  <tr key={m.id} className={`border-t border-slate-100 ${st === '승인대기' ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-3 py-2.5 font-mono text-xs">{m.id}</td>
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                      {m.name}
                      {m.id === me.id && <span className="ml-1.5 text-[10px] text-brand-500">(나)</span>}
                      <p className="text-[11px] font-normal text-slate-400">
                        <span className="font-mono">{m.empNo || '-'}</span> · {m.email || '-'}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${ROLE_TONE[m.role]}`}
                      >
                        {ROLES[m.role].label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {m.org}
                      <p className="text-[11px] text-slate-400">{m.dept}</p>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 tabular-nums whitespace-nowrap">{m.joinedAt}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_TONE[st]}`}>{st}</span>
                      {st === '잠김' && (
                        <p className="mt-0.5 text-[10px] text-rose-500 tabular-nums">{loginLocks[m.id].lockedAt}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap space-x-1.5">
                      {st === '승인대기' && (
                        <>
                          <button onClick={() => decide(m, '정상')} className={btnPrimary}>
                            <UserCheck className="w-3.5 h-3.5" /> 승인
                          </button>
                          <button onClick={() => decide(m, '반려')} className={btnLine}>
                            <UserX className="w-3.5 h-3.5" /> 반려
                          </button>
                        </>
                      )}
                      {st === '잠김' && (
                        <button
                          onClick={() => {
                            onUnlock(m.id);
                            notify(`${m.name}(${m.id}) 계정의 잠금을 해제했습니다.`);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-brand-200 px-2.5 py-1 text-xs text-brand-700 hover:bg-brand-50"
                        >
                          <Unlock className="w-3.5 h-3.5" /> 잠금 해제
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(m)}
                        className={btnLine}
                        title="수정"
                        aria-label={`${m.name} 수정`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleting(m)}
                        disabled={m.id === me.id}
                        title={m.id === me.id ? '로그인한 본인 계정은 삭제할 수 없습니다.' : '삭제'}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40 disabled:hover:bg-transparent"
                        aria-label={`${m.name} 삭제`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                    조건에 맞는 회원이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          표시된 회원은 모두 가상의 예시 인물입니다. 비밀번호 {maxAttempts}회 오류로 잠긴 계정은 「잠김」으로
          표시됩니다.
        </p>
      </Card>

      {editing && (
        <Modal
          title={editing.mode === 'add' ? '회원 추가' : `회원 정보 수정 · ${form.id}`}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button
                onClick={() => setEditing(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-white"
              >
                취소
              </button>
              <button
                onClick={save}
                className="rounded-lg bg-brand-700 px-4 py-2 text-sm text-white hover:bg-brand-800"
              >
                {editing.mode === 'add' ? '추가' : '저장'}
              </button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="ID (로그인 계정)" error={errors.id}>
              <input
                value={form.id}
                onChange={(e) => setField('id', e.target.value)}
                disabled={editing.mode === 'edit'}
                className={inputCls}
              />
            </Field>
            <Field label="이름" error={errors.name}>
              <input value={form.name} onChange={(e) => setField('name', e.target.value)} className={inputCls} />
            </Field>
            <Field label="권한">
              <select
                value={form.role}
                onChange={(e) => setField('role', e.target.value)}
                disabled={editingSelf}
                className={inputCls}
              >
                {Object.values(ROLES).map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.label} · {r.roleLabel}
                  </option>
                ))}
              </select>
              {editingSelf && (
                <span className="block mt-1 text-[11px] text-slate-400">본인 권한은 바꿀 수 없습니다.</span>
              )}
            </Field>
            <Field label="소속">
              {form.role === 'institution' ? (
                <select
                  value={form.institutionId}
                  onChange={(e) => setField('institutionId', e.target.value)}
                  className={inputCls}
                >
                  {/* 사용 중지 기관은 이미 그 기관 소속인 회원을 고칠 때만 보인다 */}
                  {INSTITUTIONS.filter((i) => i.active !== false || i.id === form.institutionId).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                      {i.active === false ? ' (사용 중지)' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input value="금융결제원" disabled className={inputCls} />
              )}
            </Field>
            <Field label="부서" error={errors.dept}>
              <input value={form.dept} onChange={(e) => setField('dept', e.target.value)} className={inputCls} />
            </Field>
            <Field label="사번">
              <input value={form.empNo} onChange={(e) => setField('empNo', e.target.value)} className={inputCls} />
            </Field>
            <Field label="이메일" error={errors.email}>
              <input
                value={form.email}
                onChange={(e) => setField('email', e.target.value)}
                placeholder="name@example.com"
                className={inputCls}
              />
            </Field>
            <Field label="내선번호">
              <input
                value={form.extension}
                onChange={(e) => setField('extension', e.target.value)}
                placeholder="02-531-0000"
                className={inputCls}
              />
            </Field>
            {editing.mode === 'add' ? (
              <Field label="초기 비밀번호" error={errors.password}>
                <input
                  value={form.password}
                  onChange={(e) => setField('password', e.target.value)}
                  className={inputCls}
                />
              </Field>
            ) : (
              <div className="col-span-2 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
                <span className="text-xs text-slate-500">
                  비밀번호를 잊은 회원은 초기 비밀번호로 되돌릴 수 있습니다.
                </span>
                <button onClick={resetPassword} className={btnLine}>
                  <KeyRound className="w-3.5 h-3.5" /> 비밀번호 초기화
                </button>
              </div>
            )}
          </div>
          {form.role === 'operator' && editing.mode === 'add' && (
            <p className="mt-3 text-[11px] text-slate-400">
              산출 업무 권한은 추가 후 「업무 권한 관리」에서 부여합니다.
            </p>
          )}
        </Modal>
      )}

      {deleting && (
        <Modal
          title="회원 삭제"
          onClose={() => setDeleting(null)}
          width="max-w-md"
          footer={
            <>
              <button
                onClick={() => setDeleting(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-white"
              >
                취소
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm text-white hover:bg-rose-700"
              >
                삭제
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-700">
            <b>
              {deleting.org} {deleting.name}({deleting.id})
            </b>{' '}
            회원을 삭제할까요?
          </p>
          <p className="mt-2 text-xs text-slate-500">
            계정과 업무 권한, 권한 신청 내역이 함께 삭제되고 이 ID로는 로그인할 수 없습니다.
          </p>
        </Modal>
      )}
    </>
  );
}

// ───────────────────────── 2. 업무 권한 관리 ─────────────────────────

function TaskPermissions({ members, taskRequests, onDecideTask, onToggleTask }) {
  const [filter, setFilter] = useState('승인 대기중');
  const [query, setQuery] = useState('');
  const [revoking, setRevoking] = useState(null); // { member, taskId }

  const memberOf = (id) => members.find((m) => m.id === id);
  const pending = taskRequests.filter((r) => r.status === '승인 대기중');
  const requests = (filter === '전체' ? taskRequests : pending).filter((r) => memberOf(r.memberId));

  // 업무 권한은 결제원 직원(사용자·관리자)에게만 의미가 있다. 참가기관은 산출하지 않는다.
  const q = query.trim().toLowerCase();
  const staff = members.filter(
    (m) =>
      m.status === '정상' &&
      ROLES[m.role].side === 'kftc' &&
      (!q || [m.id, m.name, m.dept].some((v) => v.toLowerCase().includes(q))),
  );

  return (
    <>
      <Card
        id="admin-task-requests"
        title="업무 권한 신청"
        icon={ListChecks}
        right={
          <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
            {['승인 대기중', '전체'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1 ${filter === f ? 'bg-brand-700 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                {f} {f === '전체' ? taskRequests.length : pending.length}
              </button>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                {['신청일시', '신청자', '업무', '신청 사유', '상태', '처리일시', ''].map((h) => (
                  <Th key={h}>{h}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const m = memberOf(r.memberId);
                const already = m.tasks.includes(r.taskId);
                return (
                  <tr
                    key={r.id}
                    className={`border-t border-slate-100 ${r.status === '승인 대기중' ? 'bg-amber-50/40' : ''}`}
                  >
                    <td className="px-3 py-2.5 text-slate-500 tabular-nums whitespace-nowrap">{r.requestedAt}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="font-medium">{m.name}</span>
                      <span className="ml-1.5 font-mono text-[11px] text-slate-400">{m.id}</span>
                      <p className="text-[11px] text-slate-400">{m.dept}</p>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{bizName(r.taskId)}</td>
                    <td className="px-3 py-2.5 text-slate-600">{r.reason}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${REQUEST_TONE[r.status]}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 tabular-nums whitespace-nowrap">{r.decidedAt ?? '-'}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap space-x-1.5">
                      {r.status === '승인 대기중' && (
                        <>
                          <button onClick={() => onDecideTask(r.id, true)} className={btnPrimary}>
                            <UserCheck className="w-3.5 h-3.5" /> 승인
                          </button>
                          <button onClick={() => onDecideTask(r.id, false)} className={btnLine}>
                            <UserX className="w-3.5 h-3.5" /> 반려
                          </button>
                        </>
                      )}
                      {r.status === '승인' && already && (
                        <button onClick={() => setRevoking({ member: m, taskId: r.taskId })} className={btnLine}>
                          <Lock className="w-3.5 h-3.5" /> 권한 해제
                        </button>
                      )}
                      {r.status === '승인' && !already && <span className="text-[11px] text-slate-400">해제됨</span>}
                    </td>
                  </tr>
                );
              })}
              {requests.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                    {filter === '전체' ? '접수된 업무 권한 신청이 없습니다.' : '승인을 기다리는 신청이 없습니다.'}{' '}
                    사용자 계정의 「내 정보 관리 › 담당 업무 및 산출 권한」에서 신청할 수 있습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        id="admin-task-grid"
        title="회원별 업무 권한"
        icon={ShieldCheck}
        right={
          <div className="relative w-56">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ID·이름·부서 검색"
              className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
          </div>
        }
      >
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <Th>회원</Th>
                {BUSINESSES.map((b) => (
                  <th key={b.id} className="px-3 py-2 text-center font-medium whitespace-nowrap">
                    {b.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((m) => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="font-medium">{m.name}</span>
                    <span className="ml-1.5 font-mono text-[11px] text-slate-400">{m.id}</span>
                    <p className="text-[11px] text-slate-400">
                      {ROLES[m.role].label} · {m.dept}
                    </p>
                  </td>
                  {m.role === 'sysadmin' ? (
                    <td colSpan={BUSINESSES.length} className="px-3 py-2.5 text-center text-xs text-amber-700">
                      관리자 권한 · 모든 업무 산출 가능
                    </td>
                  ) : (
                    BUSINESSES.map((b) => {
                      const has = m.tasks.includes(b.id);
                      return (
                        <td key={b.id} className="px-3 py-2.5 text-center">
                          <button
                            onClick={() =>
                              has ? setRevoking({ member: m, taskId: b.id }) : onToggleTask(m.id, b.id, true)
                            }
                            aria-label={`${m.name} ${b.name} 권한 ${has ? '해제' : '부여'}`}
                            title={has ? '눌러서 권한 해제' : '눌러서 권한 부여'}
                            className={`group inline-flex items-center justify-center gap-1 w-20 rounded-full border px-2 py-1 text-xs transition ${
                              has
                                ? 'border-brand-200 bg-brand-50 text-brand-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600'
                                : 'border-dashed border-slate-300 text-slate-400 hover:border-brand-300 hover:text-brand-700'
                            }`}
                          >
                            {has ? (
                              <>
                                <Check className="w-3 h-3 group-hover:hidden" />
                                <span className="group-hover:hidden">보유</span>
                                <span className="hidden group-hover:inline">해제</span>
                              </>
                            ) : (
                              <>
                                <Plus className="w-3 h-3" /> 부여
                              </>
                            )}
                          </button>
                        </td>
                      );
                    })
                  )}
                </tr>
              ))}
              {staff.length === 0 && (
                <tr>
                  <td colSpan={BUSINESSES.length + 1} className="px-4 py-8 text-center text-sm text-slate-400">
                    조건에 맞는 회원이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          권한을 부여하거나 해제하면 해당 회원의 「회비 산출 및 대사」 업무 선택에 바로 반영됩니다. 참가기관 회원은 산출
          권한이 없어 목록에 나오지 않습니다.
        </p>
      </Card>

      {revoking && (
        <Modal
          title="업무 권한 해제"
          onClose={() => setRevoking(null)}
          width="max-w-md"
          footer={
            <>
              <button
                onClick={() => setRevoking(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-white"
              >
                취소
              </button>
              <button
                onClick={() => {
                  onToggleTask(revoking.member.id, revoking.taskId, false);
                  setRevoking(null);
                }}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm text-white hover:bg-rose-700"
              >
                권한 해제
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-700">
            <b>{revoking.member.name}</b>님의 <b>{bizName(revoking.taskId)}</b> 산출 권한을 해제할까요?
          </p>
          <p className="mt-2 text-xs text-slate-500">
            해제하면 해당 업무를 더 이상 선택할 수 없고, 필요하면 다시 신청해야 합니다.
          </p>
        </Modal>
      )}
    </>
  );
}
