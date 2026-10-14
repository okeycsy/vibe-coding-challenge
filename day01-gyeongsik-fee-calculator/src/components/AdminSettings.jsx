import { useState } from 'react';
import { UserCheck, Users, UserX } from 'lucide-react';
import { Card } from './ui';

const TONE = {
  승인대기: 'bg-amber-50 text-amber-700 border-amber-200',
  승인: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  반려: 'bg-rose-50 text-rose-700 border-rose-200',
};
const FILTERS = ['전체', '승인대기', '승인', '반려'];

export default function AdminSettings({ members, setMembers, notify }) {
  const [filter, setFilter] = useState('승인대기');

  const decide = (id, status) => {
    const m = members.find((x) => x.id === id);
    setMembers((ms) => ms.map((x) => (x.id === id ? { ...x, status } : x)));
    notify(`${m.org} ${m.name}님의 가입을 ${status === '승인' ? '승인' : '반려'}했습니다.`);
  };

  const list = members.filter((m) => filter === '전체' || m.status === filter);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-navy-900">관리자 설정(회원승인)</h2>
        <p className="text-sm text-slate-500 mt-0.5">시스템 사용을 신청한 결제원·참가기관 담당자의 가입을 승인합니다.</p>
      </div>

      <Card
        title="회원 가입 신청 목록"
        icon={Users}
        right={
          <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1 ${filter === f ? 'bg-navy-700 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
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
                          className="inline-flex items-center gap-1 rounded-md bg-navy-700 px-2.5 py-1 text-xs text-white hover:bg-navy-800"
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
    </div>
  );
}
