import { ArrowLeftRight, Bell, Calculator, ClipboardCheck, LogOut, ShieldCheck } from 'lucide-react';

export const MENUS = [
  { id: 'calc', label: '회비 산출 및 대사', icon: Calculator, roles: ['operator', 'institution'] },
  { id: 'results', label: '기관 테스트/대사 결과 관리', icon: ClipboardCheck, roles: ['operator', 'institution'] },
  { id: 'admin', label: '관리자 설정(회원승인)', icon: ShieldCheck, roles: ['operator'] },
];

export function Header({ user, onToggleRole, onLogout }) {
  const isOperator = user.role === 'operator';
  return (
    <header className="h-16 bg-brand-800 text-white flex items-center justify-between px-6 shadow-md z-10">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
          <img src="kftc-symbol.png" alt="금융결제원 심벌마크" className="w-8 h-8" />
        </div>
        <div className="leading-tight">
          <p className="text-[11px] text-brand-200 tracking-wide">KFTC Fee Calculation System</p>
          <h1 className="text-lg font-bold">금융결제원 회비자동산출시스템</h1>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button className="relative p-2 rounded-full hover:bg-white/10" title="알림">
          <Bell className="w-5 h-5 text-brand-200" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-400 rounded-full" />
        </button>
        <div className="text-right leading-tight">
          <p className="text-sm font-semibold">
            {user.org} {user.title} ({user.name})
          </p>
          <p className="text-[11px] text-brand-200">{isOperator ? '운영 권한' : '참가기관 권한'}</p>
        </div>
        <button
          onClick={onLogout}
          className="flex items-center gap-1.5 rounded-md border border-white/20 px-2.5 py-1.5 text-xs hover:bg-white/15 transition"
        >
          <LogOut className="w-3.5 h-3.5" /> 로그아웃
        </button>
        <button
          onClick={onToggleRole}
          className="flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/15 transition"
          title="권한 전환"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
          <span className={isOperator ? 'font-bold text-accent-300' : 'text-brand-200'}>결제원</span>
          <span className="relative inline-flex h-4 w-8 rounded-full bg-brand-600">
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-accent-300 transition-all ${
                isOperator ? 'left-0.5' : 'left-[18px]'
              }`}
            />
          </span>
          <span className={!isOperator ? 'font-bold text-accent-300' : 'text-brand-200'}>참가기관</span>
        </button>
      </div>
    </header>
  );
}

export function Sidebar({ role, active, onSelect, pendingMembers }) {
  return (
    <aside className="w-72 shrink-0 bg-white border-r border-slate-200 flex flex-col">
      <nav className="p-3 space-y-1">
        <p className="px-3 pt-2 pb-1 text-[11px] font-semibold text-slate-400 tracking-wider">MENU</p>
        {MENUS.filter((m) => m.roles.includes(role)).map((m, idx) => {
          const Icon = m.icon;
          const on = active === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onSelect(m.id)}
              className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-left transition ${
                on ? 'bg-brand-700 text-white shadow' : 'text-slate-600 hover:bg-brand-50'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center font-bold ${
                  on ? 'bg-white/20' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {idx + 1}
              </span>
              <Icon className="w-4 h-4" />
              <span className="flex-1">{m.label}</span>
              {m.id === 'admin' && pendingMembers > 0 && (
                <span className="rounded-full bg-rose-500 text-white text-[10px] px-1.5 py-0.5">{pendingMembers}</span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="mt-auto m-3 rounded-lg bg-brand-50 p-3 text-[11px] text-brand-600 leading-relaxed">
        모든 화면은 백엔드 없이 예시 데이터(Mock)로 동작합니다. 실제 실적·회비와 무관합니다.
      </div>
    </aside>
  );
}
