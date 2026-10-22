import { useState } from 'react';
import { BadgeCheck, BellRing, Eye, EyeOff, History, IdCard, KeyRound, ListChecks, Send } from 'lucide-react';
import { BUSINESSES, LOGIN_HISTORY } from '../data/mockData';
import { Card } from './ui';

const bizName = (id) => BUSINESSES.find((b) => b.id === id)?.name ?? id;

const REQUEST_TONE = {
  '승인 대기중': 'bg-amber-50 text-amber-700 border-amber-200',
  승인: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  반려: 'bg-rose-50 text-rose-700 border-rose-200',
};

const NOTIFY_OPTIONS = [
  { key: 'recon', label: '내 담당 업무의 참가기관 대사 결과/이슈 등록 시 알림' },
  { key: 'testError', label: '참가기관 테스트 오류(예외사항) 발생 시 즉시 알림' },
  { key: 'permission', label: '내 업무 권한 신청 승인/반려 시 알림' },
];

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-slate-50';

function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm hover:bg-slate-50"
    >
      <span className="text-slate-700">{label}</span>
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-brand-600' : 'bg-slate-300'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
        />
      </span>
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
      {children}
    </div>
  );
}

// 항목마다 한 페이지씩 보여 준다. page는 사이드바 하위 메뉴의 section id.
export const MYPAGE_PAGES = {
  'mypage-profile': { title: '기본 정보', desc: '인사 정보와 연락처를 확인하고 수정합니다.' },
  'mypage-tasks': { title: '담당 업무 및 산출 권한', desc: '내 담당 업무를 확인하고 업무 권한을 추가로 신청합니다.' },
  'mypage-alert': {
    title: 'Mattermost 알림 설정',
    desc: '대사·테스트 결과와 권한 처리 알림을 받을 채널과 조건을 설정합니다.',
  },
  'mypage-security': { title: '보안 설정 및 접속 이력', desc: '비밀번호를 변경하고 최근 접속 이력을 확인합니다.' },
};

export default function MyPage({
  page,
  user,
  notify,
  prefs,
  setPrefs,
  approvedTasks,
  taskRequests,
  onRequestTask,
  onChangePassword,
  loginAt,
}) {
  const [extension, setExtension] = useState(prefs.extension);
  const [webhook, setWebhook] = useState(prefs.webhook);
  const requestable = BUSINESSES.filter(
    (b) => !approvedTasks.includes(b.id) && !taskRequests.some((r) => r.taskId === b.id && r.status === '승인 대기중'),
  );
  const [taskId, setTaskId] = useState('');
  const [reason, setReason] = useState('');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState('');

  const isOperator = user.role === 'operator';
  const selectedTask = requestable.some((b) => b.id === taskId) ? taskId : (requestable[0]?.id ?? '');

  const saveExtension = () => {
    if (!/^[\d-]{7,}$/.test(extension.trim())) {
      notify('내선번호 형식을 확인해 주세요. (예: 02-531-1234)', 'error');
      return;
    }
    setPrefs((p) => ({ ...p, extension: extension.trim() }));
    notify('연락처를 수정했습니다.');
  };

  const submitRequest = (e) => {
    e.preventDefault();
    if (!selectedTask) return;
    if (!reason.trim()) {
      notify('신청 사유를 입력해 주세요.', 'error');
      return;
    }
    onRequestTask(selectedTask, reason.trim());
    setReason('');
    notify(`${bizName(selectedTask)} 산출 권한을 신청했습니다. 시스템관리자 승인 후 사용할 수 있습니다.`);
  };

  const sendTest = () => {
    if (!webhook.trim()) {
      notify('Mattermost Webhook URL 또는 채널 ID를 입력해 주세요.', 'error');
      return;
    }
    setPrefs((p) => ({ ...p, webhook: webhook.trim() }));
    // 시연용: 실제로 발송하지 않는다.
    notify(`${user.name}님의 Mattermost 채널로 테스트 알림이 발송되었습니다.`);
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    setPwError('');
    if (!pw.current || !pw.next || !pw.confirm) return setPwError('모든 항목을 입력해 주세요.');
    if (pw.next.length < 4) return setPwError('새 비밀번호는 4자 이상이어야 합니다.');
    if (pw.next !== pw.confirm) return setPwError('새 비밀번호와 확인 값이 다릅니다.');
    if (pw.next === pw.current) return setPwError('현재 비밀번호와 다른 비밀번호를 입력해 주세요.');
    const err = await onChangePassword(pw.current, pw.next);
    if (err) return setPwError(err);
    setPw({ current: '', next: '', confirm: '' });
    notify('비밀번호를 변경했습니다. 다음 로그인부터 새 비밀번호를 사용하세요.');
    return undefined;
  };

  const history = [
    ...(loginAt ? [{ at: loginAt, ip: '192.168.10.45', device: 'Chrome / Windows', status: '현재 세션' }] : []),
    ...LOGIN_HISTORY,
  ];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-slate-400">내 정보 관리</p>
        <h2 className="text-xl font-bold text-brand-900">{MYPAGE_PAGES[page].title}</h2>
        <p className="text-sm text-slate-500 mt-0.5">{MYPAGE_PAGES[page].desc}</p>
      </div>

      {/* 영역 1: 기본 인사 및 계정 정보 */}
      {page === 'mypage-profile' && (
        <Card id="mypage-profile" title="기본 인사 및 계정 정보" icon={IdCard}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="이름 / 사번">
              <p className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm">
                <span className="font-semibold text-brand-900">{user.name}</span>
                <span className="ml-2 font-mono text-slate-500">{user.empNo}</span>
              </p>
            </Field>
            <Field label="소속 부서">
              <p className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm">
                {user.org} {user.dept}
              </p>
            </Field>
            <Field label="시스템 역할">
              <p className="py-1.5">
                <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                  <BadgeCheck className="w-3.5 h-3.5" /> {user.roleLabel}
                </span>
              </p>
            </Field>
          </div>
          <div className="mt-4 flex items-end gap-2 max-w-md">
            <div className="flex-1">
              <Field label="내선번호">
                <input value={extension} onChange={(e) => setExtension(e.target.value)} className={inputCls} />
              </Field>
            </div>
            <button
              onClick={saveExtension}
              className="shrink-0 rounded-lg bg-brand-700 px-3 py-2 text-sm text-white hover:bg-brand-800"
            >
              연락처 수정
            </button>
          </div>
        </Card>
      )}

      {/* 영역 2: 담당 업무 및 산출 권한 관리 */}
      {page === 'mypage-tasks' && user.side === 'kftc' && (
        <Card id="mypage-tasks" title="담당 업무 및 산출 권한 관리" icon={ListChecks}>
          <p className="text-xs font-medium text-slate-500 mb-2">내 담당 업무 현황</p>
          <div className="flex flex-wrap gap-2">
            {(isOperator ? approvedTasks : BUSINESSES.map((b) => b.id)).map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-800"
              >
                {bizName(id)}
                <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  산출 가능
                </span>
              </span>
            ))}
          </div>

          {isOperator ? (
            <>
              <form onSubmit={submitRequest} className="mt-5 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                <p className="text-sm font-semibold text-brand-900 mb-3">업무 권한 추가 신청</p>
                {requestable.length === 0 ? (
                  <p className="text-sm text-slate-500">추가로 신청할 수 있는 업무가 없습니다.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-2 items-end">
                    <Field label="신청 업무">
                      <select value={selectedTask} onChange={(e) => setTaskId(e.target.value)} className={inputCls}>
                        {requestable.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="신청 사유">
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="예: 2분기 업무 분장 변경으로 인한 CMS 회비 산출 담당"
                        className={inputCls}
                      />
                    </Field>
                    <button
                      type="submit"
                      className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800"
                    >
                      권한 신청하기
                    </button>
                  </div>
                )}
              </form>

              <p className="mt-5 text-xs font-medium text-slate-500 mb-2">권한 신청 내역</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      {['신청일시', '업무', '신청 사유', '상태', '처리일시'].map((h) => (
                        <th key={h} className="px-4 py-2 text-left font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {taskRequests.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 text-slate-500 tabular-nums whitespace-nowrap">{r.requestedAt}</td>
                        <td className="px-4 py-2 font-medium whitespace-nowrap">{bizName(r.taskId)}</td>
                        <td className="px-4 py-2 text-slate-600">{r.reason}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span className={`rounded-full border px-2 py-0.5 text-xs ${REQUEST_TONE[r.status]}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-slate-500 tabular-nums whitespace-nowrap">
                          {r.decidedAt ?? '-'}
                        </td>
                      </tr>
                    ))}
                    {taskRequests.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">
                          신청 내역이 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              시스템관리자는 모든 업무의 산출 권한을 가지고 있어 별도 신청이 필요 없습니다.
            </p>
          )}
        </Card>
      )}

      {/* 영역 3: Mattermost 알림 연동 */}
      {page === 'mypage-alert' && (
        <Card id="mypage-alert" title="Mattermost 알림 연동 설정" icon={BellRing}>
          <div className="flex flex-col md:flex-row md:items-end gap-2">
            <div className="flex-1">
              <Field label="Mattermost Webhook URL 또는 채널 ID">
                <input
                  value={webhook}
                  onChange={(e) => setWebhook(e.target.value)}
                  placeholder="https://mattermost.example.com/hooks/xxxxxxxx 또는 채널 ID"
                  className={inputCls}
                />
              </Field>
            </div>
            <button
              onClick={sendTest}
              className="shrink-0 flex items-center justify-center gap-1.5 rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm text-brand-700 hover:bg-brand-50"
            >
              <Send className="w-3.5 h-3.5" /> 연동 테스트 발송
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">시연용 화면이라 실제로 발송하지 않습니다.</p>
          <div className="mt-4 space-y-2">
            {NOTIFY_OPTIONS.map((o) => (
              <Switch
                key={o.key}
                label={o.label}
                checked={prefs.notify[o.key]}
                onChange={(v) => setPrefs((p) => ({ ...p, notify: { ...p.notify, [o.key]: v } }))}
              />
            ))}
          </div>
        </Card>
      )}

      {/* 영역 4: 보안 설정 및 최근 접속 이력 */}
      {page === 'mypage-security' && (
        <div id="mypage-security" className="scroll-mt-6 grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card title="비밀번호 변경" icon={KeyRound}>
            <form onSubmit={submitPassword} className="space-y-3">
              {[
                ['current', '현재 비밀번호', 'current-password'],
                ['next', '새 비밀번호', 'new-password'],
                ['confirm', '새 비밀번호 확인', 'new-password'],
              ].map(([k, label, ac]) => (
                <Field key={k} label={label}>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={pw[k]}
                    autoComplete={ac}
                    onChange={(e) => setPw((p) => ({ ...p, [k]: e.target.value }))}
                    className={inputCls}
                  />
                </Field>
              ))}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
                >
                  {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  비밀번호 {showPw ? '숨기기' : '보기'}
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-brand-700 px-4 py-2 text-sm text-white hover:bg-brand-800"
                >
                  비밀번호 변경
                </button>
              </div>
              {pwError && <p className="text-xs text-rose-600">{pwError}</p>}
            </form>
          </Card>

          <Card title="최근 접속 이력" icon={History}>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    {['일시', '접속 IP', '환경', '상태'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap text-slate-600">{h.at}</td>
                      <td className="px-3 py-2 font-mono text-xs">{h.ip}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{h.device}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span
                          className={`text-xs ${
                            h.status === '비밀번호 오류'
                              ? 'text-rose-600'
                              : h.status === '현재 세션'
                                ? 'text-brand-600 font-semibold'
                                : 'text-emerald-700'
                          }`}
                        >
                          {h.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
