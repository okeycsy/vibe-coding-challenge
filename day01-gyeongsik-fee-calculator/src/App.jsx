import { useEffect, useRef, useState } from 'react';
import {
  ACCOUNTS,
  BUSINESSES,
  INITIAL_APPROVED_TASKS,
  INITIAL_LOGIN_LOCKS,
  MEMBER_REQUESTS,
  USERS,
} from './data/mockData';
import { Header, MENUS, Sidebar } from './components/Layout';
import FeeCalculation from './components/FeeCalculation';
import ResultsManagement from './components/ResultsManagement';
import AdminSettings from './components/AdminSettings';
import MyPage from './components/MyPage';
import { Toast } from './components/ui';
import LoginPage from './components/LoginPage';

const MAX_ATTEMPTS = 5;
const nowLabel = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [role, setRole] = useState('operator');
  const [menu, setMenu] = useState('calc');
  const [activeSection, setActiveSection] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // runs: `${업무}-${연도}-${분기}` 별 산출 결과. 모든 뷰와 메뉴가 같은 상태를 공유한다.
  const [runs, setRuns] = useState({});
  const [members, setMembers] = useState(MEMBER_REQUESTS);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();

  // ── 계정·로그인 잠금 ──
  const [accounts, setAccounts] = useState(ACCOUNTS);
  const [loginLocks, setLoginLocks] = useState(INITIAL_LOGIN_LOCKS); // { [id]: { count, name, org, lockedAt } }
  const [loginAt, setLoginAt] = useState(null);

  // ── 담당 업무 권한(RBAC): 일반담당자(홍길동)의 승인 업무와 권한 신청 내역 ──
  const [approvedTasks, setApprovedTasks] = useState(INITIAL_APPROVED_TASKS);
  const [taskRequests, setTaskRequests] = useState([]); // status: 승인 대기중 | 승인 | 반려
  const pendingRequests = taskRequests.filter((r) => r.status === '승인 대기중');

  // ── 마이페이지 설정 (역할별) ──
  const [prefs, setPrefs] = useState(() =>
    Object.fromEntries(
      Object.values(USERS).map((u) => [
        u.role,
        { extension: u.extension, webhook: '', notify: { recon: true, testError: true, permission: true } },
      ]),
    ),
  );

  const user = USERS[role];
  // 시스템관리자는 전체 업무, 일반담당자는 승인된 업무만 산출할 수 있다. 참가기관은 산출하지 않는다.
  const allowedTasks = role === 'sysadmin' ? BUSINESSES.map((b) => b.id) : role === 'operator' ? approvedTasks : [];

  const notify = (message, tone = 'info') => {
    clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  };

  const canSee = (menuId) => MENUS.find((m) => m.id === menuId)?.roles.includes(role);


  // ── 로그인 ──
  const login = (id, password) => {
    const lock = loginLocks[id];
    if (lock?.count >= MAX_ATTEMPTS) return { locked: true };
    const account = accounts.find((a) => a.id === id && a.password === password);
    if (account) {
      setLoginLocks((l) => {
        const { [id]: _, ...rest } = l;
        return rest;
      });
      // 계정의 역할이 곧 화면 권한이다. 역할별 첫 화면으로 들어간다.
      setRole(account.role);
      setMenu(USERS[account.role].home);
      setActiveSection(null);
      setLoginAt(nowLabel());
      setIsLoggedIn(true);
      return { ok: true };
    }
    const known = accounts.find((a) => a.id === id);
    const count = (lock?.count ?? 0) + 1;
    setLoginLocks((l) => ({
      ...l,
      [id]: {
        count,
        name: known ? USERS[known.role].name : '-',
        org: known ? USERS[known.role].org : '미등록 ID',
        lockedAt: count >= MAX_ATTEMPTS ? nowLabel() : null,
      },
    }));
    return { count, locked: count >= MAX_ATTEMPTS };
  };

  const unlock = (id) =>
    setLoginLocks((l) => {
      const { [id]: _, ...rest } = l;
      return rest;
    });

  const changePassword = (current, next) => {
    const acc = accounts.find((a) => a.role === role);
    if (!acc || acc.password !== current) return '현재 비밀번호가 올바르지 않습니다.';
    setAccounts((as) => as.map((a) => (a.id === acc.id ? { ...a, password: next } : a)));
    return null;
  };

  // ── 업무 권한 신청·승인 ──
  const requestTask = (taskId, reason) =>
    setTaskRequests((rs) => [
      { id: Date.now(), taskId, reason, requester: USERS.operator.name, requestedAt: nowLabel(), status: '승인 대기중' },
      ...rs,
    ]);

  const decideTask = (requestId, approve) => {
    const req = taskRequests.find((r) => r.id === requestId);
    setTaskRequests((rs) =>
      rs.map((r) => (r.id === requestId ? { ...r, status: approve ? '승인' : '반려', decidedAt: nowLabel() } : r)),
    );
    if (approve) setApprovedTasks((t) => (t.includes(req.taskId) ? t : [...t, req.taskId]));
    const bizName = BUSINESSES.find((b) => b.id === req.taskId).name;
    const mm = prefs.operator.notify.permission ? ' (Mattermost 알림 발송)' : '';
    notify(`${req.requester}님의 ${bizName} 권한 신청을 ${approve ? '승인' : '반려'}했습니다.${mm}`);
  };

  // [ 키로 사이드바 접기/펴기. 입력창에 타이핑 중이거나 조합키와 함께 누른 경우는 무시한다.
  useEffect(() => {
    if (!isLoggedIn) return undefined;
    const onKey = (e) => {
      if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const t = e.target;
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      e.preventDefault();
      setSidebarOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isLoggedIn]);

  const selectMenu = (id, section = null) => {
    setMenu(id);
    setActiveSection(section);
    // 화면이 바뀐 뒤 해당 하위 영역으로 스크롤
    if (section) setTimeout(() => document.getElementById(section)?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  const logout = () => {
    setIsLoggedIn(false);
    setMenu('calc');
  };

  const shared = { user, runs, setRuns, notify };
  const lockedCount = Object.values(loginLocks).filter((l) => l?.count >= MAX_ATTEMPTS).length;

  if (!isLoggedIn) {
    return (
      <LoginPage
        maxAttempts={MAX_ATTEMPTS}
        locks={loginLocks}
        onLogin={login}
        onResetLock={unlock}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <Header
        user={user}
        onLogout={logout}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
      />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          role={role}
          open={sidebarOpen}
          active={menu}
          activeSection={activeSection}
          onSelect={selectMenu}
          adminBadge={members.filter((m) => m.status === '승인대기').length + pendingRequests.length + lockedCount}
        />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto">
            {/* 업로드·이슈 입력 상태를 메뉴 이동 후에도 유지하려고 숨기기만 한다 */}
            <div className={menu === 'calc' && canSee('calc') ? '' : 'hidden'}>
              <FeeCalculation
                {...shared}
                allowedTasks={allowedTasks}
                onRequestTask={() => selectMenu('mypage', 'mypage-tasks')}
              />
            </div>
            {menu === 'results' && canSee('results') && <ResultsManagement {...shared} />}
            {menu === 'mypage' && canSee('mypage') && (
              <MyPage
                user={user}
                notify={notify}
                prefs={prefs[role]}
                setPrefs={(fn) => setPrefs((p) => ({ ...p, [role]: fn(p[role]) }))}
                approvedTasks={approvedTasks}
                taskRequests={taskRequests}
                onRequestTask={requestTask}
                onChangePassword={changePassword}
                loginAt={loginAt}
              />
            )}
            {menu === 'admin' && canSee('admin') && (
              <AdminSettings
                members={members}
                setMembers={setMembers}
                notify={notify}
                taskRequests={taskRequests}
                onDecideTask={decideTask}
                loginLocks={loginLocks}
                maxAttempts={MAX_ATTEMPTS}
                onUnlock={(id) => {
                  unlock(id);
                  notify(`${id} 계정의 잠금을 해제했습니다.`);
                }}
              />
            )}
          </div>
        </main>
      </div>
      <Toast toast={toast} />
    </div>
  );
}
