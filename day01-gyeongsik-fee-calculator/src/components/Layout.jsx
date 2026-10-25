import { useEffect, useRef, useState } from 'react';
import { apiEnabled } from '../utils/api';
import { Bell, Calculator, CheckCheck, ChevronDown, ClipboardCheck, FileCode2, LogOut, Menu, ShieldCheck, UserCog } from 'lucide-react';

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
      { section: 'admin-business', label: '업무 관리' },
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
    // 업무별 skill.md 조회·수정. 일반담당자는 승인된 업무만, 시스템관리자는 전체
    id: 'skills',
    label: '회비기준(Skill.md) 관리',
    icon: FileCode2,
    roles: ['operator', 'sysadmin'],
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

// 상단바 알림 버튼과 알림 목록 드롭다운. 읽지 않은 알림이 있을 때만 빨간 표시를 띄운다.
function NotificationMenu({ notifications, onOpen, onReadAll }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const unread = notifications.filter((n) => !n.read).length;

  // 바깥을 누르거나 Esc를 누르면 닫는다
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`relative p-2 rounded-full hover:bg-white/10 ${open ? 'bg-white/10' : ''}`}
        title="알림"
        aria-label={unread > 0 ? `알림 (읽지 않음 ${unread}건)` : '알림'}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell className="w-5 h-5 text-brand-200" />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold leading-4 text-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-slate-200 bg-white text-slate-700 shadow-xl z-40">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
            <p className="text-sm font-bold text-brand-900">
              알림 {unread > 0 && <span className="text-rose-500">{unread}</span>}
            </p>
            <button
              onClick={onReadAll}
              disabled={unread === 0}
              className="flex items-center gap-1 text-xs text-brand-600 hover:underline disabled:text-slate-300 disabled:no-underline"
            >
              <CheckCheck className="w-3.5 h-3.5" /> 모두 읽음
            </button>
          </div>
          {notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">새 알림이 없습니다.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto divide-y divide-slate-100">
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      onOpen(n);
                      setOpen(false);
                    }}
                    className={`w-full text-left px-4 py-3 hover:bg-brand-50 ${n.read ? '' : 'bg-rose-50/40'}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`w-2 h-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-rose-500'}`} />
                      <span className={`flex-1 text-sm ${n.read ? 'text-slate-500' : 'font-semibold text-slate-800'}`}>{n.title}</span>
                      <span className="text-[11px] text-slate-400">{n.at}</span>
                    </span>
                    <span className="block mt-1 pl-4 text-xs text-slate-500 leading-relaxed">{n.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function Header({ user, onLogout, onToggleSidebar, sidebarOpen, notifications = [], onOpenNotification, onReadAll }) {
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
        <NotificationMenu notifications={notifications} onOpen={onOpenNotification} onReadAll={onReadAll} />
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
        {/* 접힌 상태에서는 제목이 좁은 폭에 한 글자씩 줄바꿈돼 아이콘 위에 큰 빈칸이 생기므로 아예 그리지 않는다 */}
        {open && (
          <p className="px-3 pt-2 pb-1 text-[11px] font-semibold text-slate-400 tracking-wider whitespace-nowrap">
            {ROLE_MENU_TITLE[role]}
          </p>
        )}
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
            ? '로그인·회원·업무 권한과 회비기준(skill.md)·회비 산출은 백엔드 서버와 연동되고, 실적은 예시 데이터를 씁니다.'
            : '모든 화면은 백엔드 없이 예시 데이터(Mock)로 동작합니다. 회비기준(skill.md) 수정은 새로고침 전까지만 유지됩니다.'}{' '}
          실제 실적·회비와 무관합니다.
        </div>
      )}
    </aside>
  );
}
