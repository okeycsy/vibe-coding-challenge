import { useRef, useState } from 'react';
import { MEMBER_REQUESTS, USERS } from './data/mockData';
import { Header, Sidebar } from './components/Layout';
import FeeCalculation from './components/FeeCalculation';
import ResultsManagement from './components/ResultsManagement';
import AdminSettings from './components/AdminSettings';
import { Toast } from './components/ui';
import LoginPage from './components/LoginPage';

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [role, setRole] = useState('operator');
  const [menu, setMenu] = useState('calc');
  // runs: `${업무}-${연도}-${분기}` 별 산출 결과. 두 뷰와 모든 메뉴가 같은 상태를 공유한다.
  const [runs, setRuns] = useState({});
  const [members, setMembers] = useState(MEMBER_REQUESTS);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();

  const user = USERS[role];

  const notify = (message, tone = 'info') => {
    clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  const toggleRole = () => {
    const next = role === 'operator' ? 'institution' : 'operator';
    setRole(next);
    if (next === 'institution' && menu === 'admin') setMenu('calc');
    notify(`${USERS[next].label}로 전환했습니다.`);
  };

  const logout = () => {
    setIsLoggedIn(false);
    setRole('operator');
    setMenu('calc');
  };

  const shared = { user, runs, setRuns, notify };

  if (!isLoggedIn) return <LoginPage onLogin={() => setIsLoggedIn(true)} />;

  return (
    <div className="h-screen flex flex-col">
      <Header user={user} onToggleRole={toggleRole} onLogout={logout} />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          role={role}
          active={menu}
          onSelect={setMenu}
          pendingMembers={members.filter((m) => m.status === '승인대기').length}
        />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto">
            {/* 업로드·이슈 입력 상태를 메뉴 이동 후에도 유지하려고 숨기기만 한다 */}
            <div className={menu === 'calc' ? '' : 'hidden'}>
              <FeeCalculation {...shared} />
            </div>
            {menu === 'results' && <ResultsManagement {...shared} />}
            {menu === 'admin' && role === 'operator' && (
              <AdminSettings members={members} setMembers={setMembers} notify={notify} />
            )}
          </div>
        </main>
      </div>
      <Toast toast={toast} />
    </div>
  );
}
