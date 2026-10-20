import { useState } from 'react';
import { ListChecks, Lock, Unlock, UserCheck, Users, UserX } from 'lucide-react';
import { BUSINESSES } from '../data/mockData';
import { Card } from './ui';

const TONE = {
  승인대기: 'bg-amber-50 text-amber-700 border-amber-200',
  승인: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  반려: 'bg-rose-50 text-rose-700 border-rose-200',
};
const FILTERS = ['전체', '승인대기', '승인', '반려'];

const REQUEST_TONE = {
  '승인 대기중': 'bg-amber-50 text-amber-700 border-amber-200',
  승인: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  반려: 'bg-rose-50 text-rose-700 border-rose-200',
};

export default function AdminSettings({
  members,
  setMembers,
  notify,
  taskRequests,
  onDecideTask,
  loginLocks,
  maxAttempts,
  onUnlock,
}) {
  const [filter, setFilter] = useState('승인대기');

  const decide = (id, status) => {
    const m = members.find((x) => x.id === id);
    setMembers((ms) => ms.map((x) => (x.id === id ? { ...x, status } : x)));
    notify(`${m.org} ${m.name}님의 가입을 ${status === '승인' ? '승인' : '반려'}했습니다.`);
  };

  const lockedList = Object.entries(loginLocks).filter(([, l]) => l?.count >= maxAttempts);
  const list = members.filter((m) => filter === '전체' || m.status === filter);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-brand-900">관리자 설정(회원/권한 승인)</h2>
        <p className="text-sm text-slate-500 mt-0.5">업무 권한 신청과 회원가입을 승인하고, 잠긴 계정을 해제합니다.</p>
      </div>

      <Card id="admin-tasks" title="업무 권한 추가 신청 내역" icon={ListChecks}>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                {['신청일시', '신청자', '업무', '신청 사유', '상태', ''].map((h) => (
                  <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {taskRequests.map((r) => (
                <tr key={r.id} className={`border-t border-slate-100 ${r.status === '승인 대기중' ? 'bg-amber-50/40' : ''}`}>
                  <td className="px-4 py-2.5 text-slate-500 tabular-nums whitespace-nowrap">{r.requestedAt}</td>
                  <td className="px-4 py-2.5 font-medium whitespace-nowrap">{r.requester}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{BUSINESSES.find((b) => b.id === r.taskId)?.name}</td>
                  <td className="px-4 py-2.5 text-slate-600">{r.reason}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${REQUEST_TONE[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-1.5">
                    {r.status === '승인 대기중' && (
                      <>
                        <button
                          onClick={() => onDecideTask(r.id, true)}
                          className="inline-flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1 text-xs text-white hover:bg-brand-800"
                        >
                          <UserCheck className="w-3.5 h-3.5" /> 승인
                        </button>
                        <button
                          onClick={() => onDecideTask(r.id, false)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        >
                          <UserX className="w-3.5 h-3.5" /> 반려
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {taskRequests.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                    접수된 업무 권한 신청이 없습니다. 일반담당자 계정의 「내 정보 관리」에서 신청할 수 있습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        id="admin-members"
        title="회원 가입 신청 목록"
        icon={Users}
        right={
          <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1 ${filter === f ? 'bg-brand-700 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                {f}
                {f !== '전체' && ` ${members.filter((m) => m.status === f).length}`}
              </button>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                {['신청일', '이름', '소속', '부서', '이메일', '요청 권한', '상태', ''].map((h) => (
                  <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 text-slate-500 tabular-nums">{m.requestedAt}</td>
                  <td className="px-4 py-2.5 font-medium">{m.name}</td>
                  <td className="px-4 py-2.5">{m.org}</td>
                  <td className="px-4 py-2.5 text-slate-600">{m.dept}</td>
                  <td className="px-4 py-2.5 text-slate-500">{m.email}</td>
                  <td className="px-4 py-2.5">{m.role}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${TONE[m.status]}`}>{m.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-1.5">
                    {m.status === '승인대기' && (
                      <>
                        <button
                          onClick={() => decide(m.id, '승인')}
                          className="inline-flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1 text-xs text-white hover:bg-brand-800"
                        >
                          <UserCheck className="w-3.5 h-3.5" /> 승인
                        </button>
                        <button
                          onClick={() => decide(m.id, '반려')}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        >
                          <UserX className="w-3.5 h-3.5" /> 반려
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">해당 상태의 신청이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">표시된 신청자는 모두 가상의 예시 인물입니다.</p>
      </Card>

      <Card id="admin-locks" title={`비밀번호 ${maxAttempts}회 오류 잠금 계정`} icon={Lock}>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                {['ID', '이름', '소속', '잠금 일시', '오류 횟수', ''].map((h) => (
                  <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lockedList.map(([id, l]) => (
                <tr key={id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-mono text-xs">{id}</td>
                  <td className="px-4 py-2.5 font-medium">{l.name}</td>
                  <td className="px-4 py-2.5">{l.org}</td>
                  <td className="px-4 py-2.5 text-slate-500 tabular-nums">{l.lockedAt}</td>
                  <td className="px-4 py-2.5 text-rose-600 tabular-nums">
                    {l.count}/{maxAttempts}회
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => onUnlock(id)}
                      className="inline-flex items-center gap-1 rounded-md border border-brand-200 px-2.5 py-1 text-xs text-brand-700 hover:bg-brand-50"
                    >
                      <Unlock className="w-3.5 h-3.5" /> 잠금 해제
                    </button>
                  </td>
                </tr>
              ))}
              {lockedList.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">잠긴 계정이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
