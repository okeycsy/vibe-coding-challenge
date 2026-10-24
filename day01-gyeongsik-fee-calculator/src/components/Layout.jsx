import { useState } from 'react';
import { apiEnabled } from '../utils/api';
import { Bell, Calculator, ChevronDown, ClipboardCheck, LogOut, Menu, ShieldCheck, UserCog } from 'lucide-react';

// 메뉴는 로그인한 계정의 role로 걸러진다. labels는 역할별로 이름을 바꿀 때 쓴다.
// children: 하위 메뉴. section은 해당 화면 안에서 스크롤할 영역의 id, roles가 없으면 상위 메뉴 권한을 따른다.
export const MENUS = [
  {
    id: 'admin',
    label: '관리자 설정',
    icon: ShieldCheck,
    roles: ['sysadmin'],
    children: [
      { section: 'admin-members', label: '회원 관리' },
      { section: 'admin-tasks', label: '업무 권한 관리' },
    ],
  },
  {
    id: 'calc',
    label: '회비 산출 및 대사',
    labels: { institution: '회비 대사 확인' },
    icon: Calculator,
    roles: ['operator', 'sysadmin', 'institution'],
    children: [
      { section: 'calc-period', label: '업무 및 기간 선택' },
      { section: 'calc-input', label: '데이터 입력 및 AI 이슈', roles: ['operator', 'sysadmin'] },
      { section: 'calc-result', label: '산출 결과 및 다운로드', labels: { institution: '회비 확인 및 대사 회신' } },
    ],
  },
  {
    id: 'results',
    label: '기관 테스트/대사 결과 관리',
    labels: { institution: '테스트/대사 결과 조회' },
    icon: ClipboardCheck,
    roles: ['operator', 'sysadmin', 'institution'],
    children: [
      { section: 'results-recon', label: '회비 대사 현황' },
      { section: 'results-test', label: '기관 연동 테스트 결과' },
    ],
  },
  {
    id: 'mypage',
    label: '내 정보 관리',
    icon: UserCog,
    roles: ['operator', 'sysadmin', 'institution'],
    children: [
      { section: 'mypage-profile', label: '기본 정보' },
      { section: 'mypage-tasks', label: '담당 업무 및 산출 권한', roles: ['operator', 'sysadmin'] },
      { section: 'mypage-alert', label: 'Mattermost 알림 설정' },
      { section: 'mypage-security', label: '보안 설정 및 접속 이력' },
    ],
  },
];

export const labelFor = (item, role) => item.labels?.[role] ?? item.label;

const ROLE_BADGE = {
  operator: 'bg-white/15 text-white',
  sysadmin: 'bg-amber-400 text-amber-950',
  institution: 'bg-emerald-400 text-emerald-950',
};

export function Header({ user, onLogout, onToggleSidebar, sidebarOpen }) {
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
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${ROLE_BADGE[user.role]}`}>{user.label}</span>
        <div className="text-right leading-tight">
          <p className="text-sm font-semibold">
            {user.org} {user.title} ({user.name})
          </p>
          <p className="text-[11px] text-brand-200">{user.roleLabel}</p>
        </div>
        <button
          onClick={onLogout}
          className="flex items-center gap-1.5 rounded-md border border-white/20 px-2.5 py-1.5 text-xs hover:bg-white/15 transition"
        >
          <LogOut className="w-3.5 h-3.5" /> 로그아웃
        </button>

      </div>
    </header>
  );
}

const ROLE_MENU_TITLE = { operator: '사용자 메뉴', sysadmin: '관리자 메뉴', institution: '참가기관 메뉴' };

export function Sidebar({ role, active, activeSection, onSelect, adminBadge, sectionBadges = {}, open }) {
  const [folded, setFolded] = useState({});
  const visible = (item) => !item.roles || item.roles.includes(role);

  return (
    <aside
      className={`${open ? 'w-72' : 'w-16'} shrink-0 bg-white border-r border-slate-200 flex flex-col transition-[width] duration-200`}
    >
      <nav className="p-3 space-y-1">
        <p className={`px-3 pt-2 pb-1 text-[11px] font-semibold text-slate-400 tracking-wider ${open ? '' : 'invisible'}`}>
          {ROLE_MENU_TITLE[role]}
        </p>
        {MENUS.filter(visible).map((m) => {
          const Icon = m.icon;
          const on = active === m.id;
          const children = (m.children ?? []).filter(visible);
          const expanded = children.length > 0 && !folded[m.id];
          const badge = m.id === 'admin' && adminBadge > 0 && (
            <span className="rounded-full bg-rose-500 text-white text-[10px] px-1.5 py-0.5">{adminBadge}</span>
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
                  aria-label={labelFor(m, role)}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {open && <span className="flex-1">{labelFor(m, role)}</span>}
                  {open && badge}
                  {!open && adminBadge > 0 && m.id === 'admin' && (
                    <span className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-rose-500" />
                  )}
                </button>
                {open && children.length > 0 && (
                  <button
                    onClick={() => setFolded((f) => ({ ...f, [m.id]: !f[m.id] }))}
                    className={`p-2 mr-1 rounded ${on ? 'hover:bg-white/15' : 'hover:bg-brand-100'}`}
                    aria-label={`${labelFor(m, role)} 하위 메뉴 ${expanded ? '접기' : '펴기'}`}
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
                          <span className="flex items-center justify-between gap-2">
                            {labelFor(c, role)}
                            {sectionBadges[c.section] > 0 && (
                              <span className="rounded-full bg-rose-100 text-rose-600 text-[10px] font-semibold px-1.5">
                                {sectionBadges[c.section]}
                              </span>
                            )}
                          </span>
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
                      {labelFor(m, role)} {badge}
                    </button>
                    {children.map((c) => (
                      <button
                        key={c.section}
                        onClick={() => onSelect(m.id, c.section)}
                        className="w-full text-left px-5 py-1.5 text-[13px] text-slate-500 hover:text-brand-700 hover:bg-slate-50"
                      >
                        {labelFor(c, role)}
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
          {apiEnabled
            ? '로그인·회원·업무 권한과 회비 산출(skill.md 수식)은 백엔드 서버와 연동되고, 실적은 예시 데이터를 씁니다.'
            : '모든 화면은 백엔드 없이 예시 데이터(Mock)로 동작합니다. 회비는 묶어 둔 skill.md 수식으로 계산합니다.'}{' '}
          실제 실적·회비와 무관합니다.
        </div>
      )}
    </aside>
  );
}
