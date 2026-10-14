import { useState } from 'react';
import { ArrowLeftRight, Bell, Calculator, ChevronDown, ClipboardCheck, LogOut, Menu, ShieldCheck } from 'lucide-react';

// children: 하위 메뉴. section은 해당 화면 안에서 스크롤할 영역의 id, roles가 없으면 상위 메뉴 권한을 따른다.
export const MENUS = [
  {
    id: 'calc',
    label: '회비 산출 및 대사',
    icon: Calculator,
    roles: ['operator', 'institution'],
    children: [
      { section: 'calc-period', label: '업무 및 분기 선택' },
      { section: 'calc-input', label: '데이터 입력 및 AI 이슈', roles: ['operator'] },
      { section: 'calc-result', label: '산출 결과 및 다운로드' },
    ],
  },
  {
    id: 'results',
    label: '기관 테스트/대사 결과 관리',
    icon: ClipboardCheck,
    roles: ['operator', 'institution'],
    children: [
      { section: 'results-recon', label: '회비 대사 현황' },
      { section: 'results-test', label: '기관 연동 테스트 결과' },
    ],
  },
  { id: 'admin', label: '관리자 설정(회원승인)', icon: ShieldCheck, roles: ['operator'] },
];

export function Header({ user, onToggleRole, onLogout, onToggleSidebar, sidebarOpen }) {
  const isOperator = user.role === 'operator';
  return (
    <header className="h-16 bg-brand-800 text-white flex items-center justify-between px-6 shadow-md z-10">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="p-2 -ml-2 rounded-lg hover:bg-white/10"
          title={`메뉴 ${sidebarOpen ? '접기' : '펴기'} ( [ )`}
          aria-label={`메뉴 ${sidebarOpen ? '접기' : '펴기'}`}
          aria-expanded={sidebarOpen}
        >
          <Menu className="w-5 h-5" />
        </button>
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

export function Sidebar({ role, active, activeSection, onSelect, pendingMembers, open }) {
  const [folded, setFolded] = useState({});
  const visible = (item) => !item.roles || item.roles.includes(role);

  return (
    <aside
      className={`${open ? 'w-72' : 'w-16'} shrink-0 bg-white border-r border-slate-200 flex flex-col transition-[width] duration-200`}
    >
      <nav className="p-3 space-y-1">
        <p className={`px-3 pt-2 pb-1 text-[11px] font-semibold text-slate-400 tracking-wider ${open ? '' : 'invisible'}`}>MENU</p>
        {MENUS.filter(visible).map((m) => {
          const Icon = m.icon;
          const on = active === m.id;
          const children = (m.children ?? []).filter(visible);
          const expanded = children.length > 0 && !folded[m.id];
          const badge = m.id === 'admin' && pendingMembers > 0 && (
            <span className="rounded-full bg-rose-500 text-white text-[10px] px-1.5 py-0.5">{pendingMembers}</span>
          );
          return (
            <div key={m.id} className="relative group">
              <div
                className={`flex items-center rounded-lg transition ${
                  on ? 'bg-brand-700 text-white shadow' : 'text-slate-600 hover:bg-brand-50'
                }`}
              >
                <button
                  onClick={() => onSelect(m.id)}
                  className={`flex-1 flex items-center gap-3 py-2.5 text-sm text-left ${open ? 'px-3' : 'justify-center px-0'}`}
                  aria-label={m.label}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {open && <span className="flex-1">{m.label}</span>}
                  {open && badge}
                  {!open && pendingMembers > 0 && m.id === 'admin' && (
                    <span className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-rose-500" />
                  )}
                </button>
                {open && children.length > 0 && (
                  <button
                    onClick={() => setFolded((f) => ({ ...f, [m.id]: !f[m.id] }))}
                    className={`p-2 mr-1 rounded ${on ? 'hover:bg-white/15' : 'hover:bg-brand-100'}`}
                    aria-label={`${m.label} 하위 메뉴 ${expanded ? '접기' : '펴기'}`}
                  >
                    <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                  </button>
                )}
              </div>

              {open && expanded && (
                <ul className="mt-1 mb-2 ml-5 border-l border-slate-200 pl-3 space-y-0.5">
                  {children.map((c) => {
                    const subOn = on && activeSection === c.section;
                    return (
                      <li key={c.section}>
                        <button
                          onClick={() => onSelect(m.id, c.section)}
                          className={`w-full text-left rounded-md px-2.5 py-1.5 text-[13px] transition ${
                            subOn ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-slate-500 hover:text-brand-700 hover:bg-slate-50'
                          }`}
                        >
                          {c.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* 접힌 상태: 마우스를 올리면 메뉴 이름과 하위 메뉴를 플라이아웃으로 보여 준다 */}
              {!open && (
                <div className="hidden group-hover:block absolute left-full top-0 pl-2 z-30">
                  <div className="w-56 rounded-lg border border-slate-200 bg-white py-2 shadow-lg">
                    <button
                      onClick={() => onSelect(m.id)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-brand-900 hover:bg-brand-50"
                    >
                      {m.label} {badge}
                    </button>
                    {children.map((c) => (
                      <button
                        key={c.section}
                        onClick={() => onSelect(m.id, c.section)}
                        className="w-full text-left px-5 py-1.5 text-[13px] text-slate-500 hover:text-brand-700 hover:bg-slate-50"
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>
      {open && (
        <div className="mt-auto m-3 rounded-lg bg-brand-50 p-3 text-[11px] text-brand-600 leading-relaxed">
          모든 화면은 백엔드 없이 예시 데이터(Mock)로 동작합니다. 실제 실적·회비와 무관합니다.
        </div>
      )}
    </aside>
  );
}
