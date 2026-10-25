import { useEffect, useRef, useState } from 'react';
import { BUSINESSES, INITIAL_LOGIN_LOCKS, INITIAL_NOTIFICATIONS, INITIAL_TASK_REQUESTS, MEMBERS, ROLES } from './data/mockData';
import { Header, MENUS, Sidebar } from './components/Layout';
import FeeCalculation from './components/FeeCalculation';
import ResultsManagement from './components/ResultsManagement';
import AdminSettings from './components/AdminSettings';
import MyPage from './components/MyPage';
import { Toast } from './components/ui';
import LoginPage from './components/LoginPage';
import { api, apiEnabled, setEmployeeId } from './utils/api';
import SkillManagementPage from './components/SkillManagementPage';
import TaskManagementPage from './components/TaskManagementPage';
import { builtInTasks } from './utils/skill';

const MAX_ATTEMPTS = 5;
// 하위 메뉴가 각각 한 페이지인 메뉴와 그 첫 페이지
const PAGED_MENUS = { mypage: 'mypage-profile', admin: 'admin-members', skills: 'skills-document' };
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
  // 회비기준(skill.md): 서버 미연결 시 화면에서 고친 내용 { [업무코드]: { content, lastModified, updatedBy } },
  // skillVersion 은 저장할 때마다 올려 산출 화면이 기준을 다시 읽게 한다.
  const [skillOverrides, setSkillOverrides] = useState({});
  const [skillVersion, setSkillVersion] = useState(0);
  const [skillTarget, setSkillTarget] = useState(null);
  // 업무 목록 (업무 1개 = md 파일 1개). 관리자가 업무 관리에서 추가·삭제한다. 서버가 있으면 서버 목록을 받는다.
  const [tasks, setTasks] = useState(() => builtInTasks(BUSINESSES));
  const [toast, setToast] = useState(null);
  // 상단바 알림. 서버 API가 없어 서버 연결 여부와 관계없이 예시 데이터로 동작하고, 읽음 표시는 새로고침 전까지 유지된다.
  const [notifications, setNotifications] = useState(INITIAL_NOTIFICATIONS);
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
    role === 'sysadmin' ? tasks.map((t) => t.businessId) : role === 'operator' ? (member?.tasks ?? []) : [];
  // 회비 산출은 실적 예시 데이터가 있는 기본 업무 중 지우지 않은 업무만 (새 업무는 md 기준만 관리한다)
  const calcBusinesses = BUSINESSES.filter((b) => tasks.some((t) => t.businessId === b.id));

  const notify = (message, tone = 'info') => {
    clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  };

  const canSee = (menuId) => MENUS.find((m) => m.id === menuId)?.roles.includes(role);

  // ── 백엔드 연동 (VITE_API_BASE_URL이 있을 때만) ──
  // serverStatus: off(예시 데이터만) | waking(무료 서버 깨우는 중) | up | down
  const [serverStatus, setServerStatus] = useState(apiEnabled ? 'waking' : 'off');
  const syncFromServer = async () => {
    const [ms, rs, locks] = await Promise.all([api.members(), api.taskRequests(), api.locks()]);
    setMembers(ms);
    setTaskRequests(rs);
    setLoginLocks(locks);
    // 업무 관리 API가 아직 배포되지 않은 서버면 기본 업무 목록을 그대로 쓴다
    api.tasks().then(setTasks).catch(() => {});
  };
  // 화면은 바로 바꾸고 서버에 같은 변경을 보낸다. 서버가 거절하면 알리고 서버 값으로 되돌린다.
  const persist = (call) => {
    if (!apiEnabled) return;
    call().catch((e) => {
      notify(e.message, 'error');
      syncFromServer().catch(() => {});
    });
  };

  // 첫 화면에서 서버를 깨우고 잠긴 계정 목록을 받아 둔다 (무료 호스팅은 잠들어 있으면 깨는 데 1분쯤 걸린다)
  useEffect(() => {
    if (!apiEnabled) return;
    api
      .locks()
      .then((locks) => {
        setLoginLocks(locks);
        setServerStatus('up');
      })
      .catch(() => setServerStatus('down'));
  }, []);

  // ── 로그인 ──
  const enter = (account) => {
    // 계정의 역할이 곧 화면 권한이다. 역할별 첫 화면으로 들어간다.
    setCurrentId(account.id);
    setEmployeeId(account.id);
    setMenu(ROLES[account.role].home);
    setActiveSection(null);
    setLoginAt(nowLabel());
    setIsLoggedIn(true);
  };

  const loginWithServer = async (id, password) => {
    try {
      const account = await api.login(id, password);
      setServerStatus('up');
      setMembers((ms) => [...ms.filter((m) => m.id !== account.id), account]);
      unlockLocal(id);
      enter(account);
      syncFromServer().catch(() => {});
      return { ok: true };
    } catch (e) {
      if (e.status === 0) setServerStatus('down');
      if (e.status === 403) return e.message.includes('반려') ? { rejected: true } : { pending: true };
      if (e.data?.failCount != null) {
        const { failCount: count, locked } = e.data;
        setLoginLocks((l) => ({ ...l, [id]: { count, lockedAt: locked ? nowLabel() : null } }));
        return { count, locked };
      }
      return e.status === 401 ? { count: 0, locked: false } : { error: e.message };
    }
  };

  const login = (id, password) => {
    if (apiEnabled) return loginWithServer(id, password);
    const lock = loginLocks[id];
    if (lock?.count >= MAX_ATTEMPTS) return { locked: true };
    const account = members.find((a) => a.id === id && a.password === password);
    if (account?.status === '승인대기') return { pending: true };
    if (account?.status === '반려') return { rejected: true };
    if (account) {
      unlockLocal(id);
      enter(account);
      return { ok: true };
    }
    const count = (lock?.count ?? 0) + 1;
    setLoginLocks((l) => ({ ...l, [id]: { count, lockedAt: count >= MAX_ATTEMPTS ? nowLabel() : null } }));
    return { count, locked: count >= MAX_ATTEMPTS };
  };

  const unlockLocal = (id) =>
    setLoginLocks((l) => {
      const { [id]: _, ...rest } = l;
      return rest;
    });
  const unlock = (id) => {
    unlockLocal(id);
    persist(() => api.unlock(id));
  };

  const changePassword = async (current, next) => {
    if (apiEnabled) {
      try {
        await api.changePassword(member.id, current, next);
        return null;
      } catch (e) {
        return e.message;
      }
    }
    if (member.password !== current) return '현재 비밀번호가 올바르지 않습니다.';
    updateMember(member.id, { password: next });
    return null;
  };

  // ── 회원 관리 (관리자) ──
  // 서버에는 가입 승인·반려, 비밀번호 초기화, 부서·이메일·내선 수정만 있다. 이름·역할 변경과 회원 추가·삭제는 화면에서만 바뀐다.
  const updateMember = (id, patch) => {
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    if ('status' in patch) persist(() => (patch.status === '정상' ? api.approveMember(id) : api.rejectMember(id)));
    else if ('password' in patch) persist(() => api.resetPassword(id));
    else persist(() => api.updateProfile(id, patch));
  };
  const addMember = (m) => setMembers((ms) => [...ms, m]);
  const deleteMember = (id) => {
    setMembers((ms) => ms.filter((m) => m.id !== id));
    setTaskRequests((rs) => rs.filter((r) => r.memberId !== id));
    unlockLocal(id);
  };

  // ── 업무 권한 신청·승인·해제 ──
  const requestTask = (taskId, reason) => {
    setTaskRequests((rs) => [
      { id: Date.now(), memberId: member.id, taskId, reason, requestedAt: nowLabel(), status: '승인 대기중' },
      ...rs,
    ]);
    // 관리자가 서버의 신청 번호로 승인하도록 저장 후 목록을 다시 받는다
    persist(() => api.requestTask(member.id, taskId, reason).then(syncFromServer));
  };

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
    persist(() => (approve ? api.approveTaskRequest(requestId) : api.rejectTaskRequest(requestId)));
    notify(
      `${target.name}님의 ${bizName(req.taskId)} 권한 신청을 ${approve ? '승인' : '반려'}했습니다.${mmNote(target)}`,
    );
  };

  const toggleTask = (memberId, taskId, granted) => {
    const target = members.find((m) => m.id === memberId);
    setTask(memberId, taskId, granted);
    persist(() => (granted ? api.grantTask(memberId, taskId) : api.revokeTask(memberId, taskId)));
    notify(`${target.name}님의 ${bizName(taskId)} 권한을 ${granted ? '부여' : '해제'}했습니다.${mmNote(target)}`);
  };

  // ── 업무 관리 (관리자): 추가·삭제 ──
  // 서버가 있으면 서버에서 먼저 처리하고(파일 생성·삭제) 결과를 반영한다. 실패하면 Error를 던져 화면이 보여 준다.
  const addTask = async ({ taskCode, businessId, name, fileName }) => {
    if (apiEnabled) {
      const created = await api.createTask(taskCode, name, fileName);
      setTasks((ts) => [...ts, created]);
      return created;
    }
    const created = { taskCode, businessId, name, fileName, builtIn: false, createdAt: nowLabel(), createdBy: member.id };
    setTasks((ts) => [...ts, created]);
    return created;
  };

  const deleteTask = async (taskCode) => {
    const task = tasks.find((t) => t.taskCode === taskCode);
    if (apiEnabled) await api.deleteTask(taskCode);
    setTasks((ts) => ts.filter((t) => t.taskCode !== taskCode));
    setSkillOverrides(({ [taskCode]: _, ...rest }) => rest);
    // 그 업무의 산출 권한과 승인 대기 신청도 정리한다 (서버도 같은 처리를 한다)
    setMembers((ms) => ms.map((m) => ({ ...m, tasks: m.tasks.filter((t) => t !== task.businessId) })));
    setTaskRequests((rs) =>
      rs.map((r) =>
        r.taskId === task.businessId && r.status === '승인 대기중' ? { ...r, status: '반려', decidedAt: nowLabel() } : r,
      ),
    );
    if (skillTarget === task.businessId) setSkillTarget(null);
    setSkillVersion((v) => v + 1);
  };

  // [ 키로 사이드바 접기/펴기. 글자 입력칸·md 편집기에 타이핑 중이거나 조합키와 함께 누른 경우는 무시한다.
  // 한글 입력 상태에서는 e.key가 '[' 대신 'Process'로 오기도 해서 물리 키(e.code)로도 확인한다.
  useEffect(() => {
    if (!isLoggedIn) return undefined;
    const onKey = (e) => {
      const bracket = e.key === '[' || (e.code === 'BracketLeft' && !e.shiftKey);
      if (!bracket || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      // 글자를 입력하는 칸에서만 무시한다. 업무 선택(select)·버튼에 포커스가 남아 있어도 동작해야 한다
      const t = e.target;
      const typing =
        t.isContentEditable ||
        t.tagName === 'TEXTAREA' ||
        (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(t.type));
      if (typing) return;
      e.preventDefault();
      setSidebarOpen((o) => !o);
    };
    // 화면 안 요소가 keydown 전파를 막아도 받도록 캡처 단계에서 듣는다
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
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
    if (apiEnabled) api.logout(currentId).catch(() => {});
    setIsLoggedIn(false);
    setCurrentId(null);
    setEmployeeId(null);
    setMenu('calc');
  };

  const myNotifications = notifications.filter((n) => n.roles.includes(role)).sort((a, b) => b.at.localeCompare(a.at));
  const markRead = (ids) => setNotifications((ns) => ns.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
  const openNotification = (n) => {
    markRead([n.id]);
    if (canSee(n.target.menu)) selectMenu(n.target.menu, n.target.section);
  };

  const shared = { user, runs, setRuns, notify };
  const isLocked = (id) => loginLocks[id]?.count >= MAX_ATTEMPTS;
  const adminCounts = {
    'admin-members': members.filter((m) => m.status === '승인대기' || isLocked(m.id)).length,
    'admin-tasks': pendingRequests.length,
  };

  if (!isLoggedIn) {
    return (
      <LoginPage
        maxAttempts={MAX_ATTEMPTS}
        locks={loginLocks}
        onLogin={login}
        onResetLock={unlock}
        serverStatus={serverStatus}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <Header
        user={user}
        onLogout={logout}
        notifications={myNotifications}
        onOpenNotification={openNotification}
        onReadAll={() => markRead(myNotifications.map((n) => n.id))}
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
          {/* 메뉴를 접으면 폭 제한을 풀어 본문이 아이콘 레일 바로 옆부터 채운다 */}
          <div className={sidebarOpen ? 'max-w-7xl mx-auto' : 'w-full'}>
            {/* 업로드·이슈 입력 상태를 메뉴 이동 후에도 유지하려고 숨기기만 한다 */}
            <div className={menu === 'calc' && canSee('calc') ? '' : 'hidden'}>
              <FeeCalculation
                {...shared}
                allowedTasks={allowedTasks}
                businesses={calcBusinesses}
                onRequestTask={() => selectMenu('mypage', 'mypage-tasks')}
                skillOverrides={skillOverrides}
                skillVersion={skillVersion}
                onOpenSkill={(businessId) => {
                  setSkillTarget(businessId);
                  selectMenu('skills');
                }}
              />
            </div>
            {menu === 'skills' && canSee('skills') && (
              <SkillManagementPage
                user={user}
                notify={notify}
                allowedTasks={allowedTasks}
                tasks={tasks}
                target={skillTarget}
                overrides={skillOverrides}
                setOverrides={setSkillOverrides}
                onSaved={() => setSkillVersion((v) => v + 1)}
                onRequestTask={() => selectMenu('mypage', 'mypage-tasks')}
                page={activeSection ?? 'skills-document'}
                onChangePage={(section) => selectMenu('skills', section)}
              />
            )}
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
            {menu === 'admin' && canSee('admin') && activeSection === 'admin-business' && (
              <TaskManagementPage
                tasks={tasks}
                members={members}
                overrides={skillOverrides}
                onAddTask={addTask}
                onDeleteTask={deleteTask}
                onOpenSkill={(businessId) => {
                  setSkillTarget(businessId);
                  selectMenu('skills');
                }}
                notify={notify}
              />
            )}
            {menu === 'admin' && canSee('admin') && activeSection !== 'admin-business' && (
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
