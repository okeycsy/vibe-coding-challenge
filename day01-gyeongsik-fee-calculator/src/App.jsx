import { useEffect, useRef, useState } from 'react';
import { BUSINESSES, INITIAL_LOGIN_LOCKS, INITIAL_TASK_REQUESTS, MEMBERS, ROLES } from './data/mockData';
import { Header, MENUS, Sidebar } from './components/Layout';
import FeeCalculation from './components/FeeCalculation';
import ResultsManagement from './components/ResultsManagement';
import AdminSettings from './components/AdminSettings';
import MyPage from './components/MyPage';
import { Toast } from './components/ui';
import LoginPage from './components/LoginPage';

const MAX_ATTEMPTS = 5;
// 하위 메뉴가 각각 한 페이지인 메뉴와 그 첫 페이지
const PAGED_MENUS = { mypage: 'mypage-profile', admin: 'admin-members' };
const nowLabel = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentId, setCurrentId] = useState(null);
  const [menu, setMenu] = useState('calc');
  const [activeSection, setActiveSection] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // runs: `${업무}-${연도}-${분기}` 별 산출 결과. 모든 뷰와 메뉴가 같은 상태를 공유한다.
  const [runs, setRuns] = useState({});
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();

  // ── 회원(=로그인 계정)·로그인 잠금 ──
  // 회원마다 역할(role)과 산출 가능 업무(tasks)를 가진다. 관리자가 회원 관리·업무 권한 관리에서 바꾼다.
  const [members, setMembers] = useState(MEMBERS);
  const [loginLocks, setLoginLocks] = useState(INITIAL_LOGIN_LOCKS); // { [id]: { count, lockedAt } }
  const [loginAt, setLoginAt] = useState(null);

  // ── 업무 권한 신청 내역 ──
  const [taskRequests, setTaskRequests] = useState(INITIAL_TASK_REQUESTS); // status: 승인 대기중 | 승인 | 반려
  const pendingRequests = taskRequests.filter((r) => r.status === '승인 대기중');

  // ── 마이페이지 설정 (회원별, 처음 열 때 기본값) ──
  const [prefsById, setPrefsById] = useState({});
  const defaultPrefs = (m) => ({
    extension: m.extension,
    webhook: '',
    notify: { recon: true, testError: true, permission: true },
  });
  const prefsOf = (m) => prefsById[m.id] ?? defaultPrefs(m);

  const member = members.find((m) => m.id === currentId);
  const role = member?.role ?? 'operator';
  const user = member ? { ...ROLES[member.role], ...member } : null;
  // 시스템관리자는 전체 업무, 일반담당자는 승인된 업무만 산출할 수 있다. 참가기관은 산출하지 않는다.
  const allowedTasks =
    role === 'sysadmin' ? BUSINESSES.map((b) => b.id) : role === 'operator' ? (member?.tasks ?? []) : [];

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
    const account = members.find((a) => a.id === id && a.password === password);
    if (account?.status === '승인대기') return { pending: true };
    if (account?.status === '반려') return { rejected: true };
    if (account) {
      setLoginLocks((l) => {
        const { [id]: _, ...rest } = l;
        return rest;
      });
      // 계정의 역할이 곧 화면 권한이다. 역할별 첫 화면으로 들어간다.
      setCurrentId(account.id);
      setMenu(ROLES[account.role].home);
      setActiveSection(null);
      setLoginAt(nowLabel());
      setIsLoggedIn(true);
      return { ok: true };
    }
    const count = (lock?.count ?? 0) + 1;
    setLoginLocks((l) => ({ ...l, [id]: { count, lockedAt: count >= MAX_ATTEMPTS ? nowLabel() : null } }));
    return { count, locked: count >= MAX_ATTEMPTS };
  };

  const unlock = (id) =>
    setLoginLocks((l) => {
      const { [id]: _, ...rest } = l;
      return rest;
    });

  const changePassword = (current, next) => {
    if (member.password !== current) return '현재 비밀번호가 올바르지 않습니다.';
    updateMember(member.id, { password: next });
    return null;
  };

  // ── 회원 관리 (관리자) ──
  const updateMember = (id, patch) => setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const addMember = (m) => setMembers((ms) => [...ms, m]);
  const deleteMember = (id) => {
    setMembers((ms) => ms.filter((m) => m.id !== id));
    setTaskRequests((rs) => rs.filter((r) => r.memberId !== id));
    unlock(id);
  };

  // ── 업무 권한 신청·승인·해제 ──
  const requestTask = (taskId, reason) =>
    setTaskRequests((rs) => [
      { id: Date.now(), memberId: member.id, taskId, reason, requestedAt: nowLabel(), status: '승인 대기중' },
      ...rs,
    ]);

  const bizName = (taskId) => BUSINESSES.find((b) => b.id === taskId).name;
  const mmNote = (m) => (prefsOf(m).notify.permission ? ' (Mattermost 알림 발송)' : '');

  // 회원의 업무 권한을 켜거나 끈다. 해제하면 그 회원의 산출 화면 드롭다운에서 바로 비활성화된다.
  const setTask = (memberId, taskId, granted) =>
    setMembers((ms) =>
      ms.map((m) =>
        m.id !== memberId
          ? m
          : { ...m, tasks: granted ? [...new Set([...m.tasks, taskId])] : m.tasks.filter((t) => t !== taskId) },
      ),
    );

  const decideTask = (requestId, approve) => {
    const req = taskRequests.find((r) => r.id === requestId);
    const target = members.find((m) => m.id === req.memberId);
    setTaskRequests((rs) =>
      rs.map((r) => (r.id === requestId ? { ...r, status: approve ? '승인' : '반려', decidedAt: nowLabel() } : r)),
    );
    if (approve) setTask(req.memberId, req.taskId, true);
    notify(
      `${target.name}님의 ${bizName(req.taskId)} 권한 신청을 ${approve ? '승인' : '반려'}했습니다.${mmNote(target)}`,
    );
  };

  const toggleTask = (memberId, taskId, granted) => {
    const target = members.find((m) => m.id === memberId);
    setTask(memberId, taskId, granted);
    notify(`${target.name}님의 ${bizName(taskId)} 권한을 ${granted ? '부여' : '해제'}했습니다.${mmNote(target)}`);
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
    // 내 정보 관리·관리자 설정은 하위 메뉴마다 별도 페이지다. 상위 메뉴를 누르면 첫 페이지로 간다.
    if (PAGED_MENUS[id]) {
      setActiveSection(section ?? PAGED_MENUS[id]);
      document.querySelector('main')?.scrollTo(0, 0);
      return;
    }
    setActiveSection(section);
    // 화면이 바뀐 뒤 해당 하위 영역으로 스크롤
    if (section) setTimeout(() => document.getElementById(section)?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  const logout = () => {
    setIsLoggedIn(false);
    setCurrentId(null);
    setMenu('calc');
  };

  const shared = { user, runs, setRuns, notify };
  const isLocked = (id) => loginLocks[id]?.count >= MAX_ATTEMPTS;
  const adminCounts = {
    'admin-members': members.filter((m) => m.status === '승인대기' || isLocked(m.id)).length,
    'admin-tasks': pendingRequests.length,
  };

  if (!isLoggedIn) {
    return <LoginPage maxAttempts={MAX_ATTEMPTS} locks={loginLocks} onLogin={login} onResetLock={unlock} />;
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
          adminBadge={adminCounts['admin-members'] + adminCounts['admin-tasks']}
          sectionBadges={adminCounts}
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
                page={activeSection ?? 'mypage-profile'}
                user={user}
                notify={notify}
                prefs={prefsOf(member)}
                setPrefs={(fn) => setPrefsById((p) => ({ ...p, [member.id]: fn(prefsOf(member)) }))}
                approvedTasks={member.tasks}
                taskRequests={taskRequests.filter((r) => r.memberId === member.id)}
                onRequestTask={requestTask}
                onChangePassword={changePassword}
                loginAt={loginAt}
              />
            )}
            {menu === 'admin' && canSee('admin') && (
              <AdminSettings
                page={activeSection ?? 'admin-members'}
                me={member}
                members={members}
                onAddMember={addMember}
                onUpdateMember={updateMember}
                onDeleteMember={deleteMember}
                notify={notify}
                taskRequests={taskRequests}
                onDecideTask={decideTask}
                onToggleTask={toggleTask}
                isLocked={isLocked}
                loginLocks={loginLocks}
                maxAttempts={MAX_ATTEMPTS}
                onUnlock={unlock}
              />
            )}
          </div>
        </main>
      </div>
      <Toast toast={toast} />
    </div>
  );
}
