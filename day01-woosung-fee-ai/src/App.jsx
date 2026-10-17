import { useEffect, useState } from 'react';
import { BrainCircuit, Calculator, Landmark, Settings2 } from 'lucide-react';
import { api } from './api.js';
import CalculatePage from './pages/CalculatePage.jsx';
import CriteriaPage from './pages/CriteriaPage.jsx';

const TABS = [
  { key: 'calc', label: '회비 산출', icon: Calculator },
  { key: 'criteria', label: '분담기준 관리', icon: Settings2, badge: '관리자' },
];

export default function App() {
  const [tab, setTab] = useState('calc');
  const [works, setWorks] = useState([]);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');

  const reloadWorks = () => api.works().then(setWorks).catch((e) => setError(e.message));
  useEffect(() => {
    reloadWorks();
    api.health().then(setHealth).catch(() => setError('API 서버에 연결하지 못했습니다. npm run dev로 실행했는지 확인하세요.'));
  }, []);

  return (
    <div className="min-h-screen">
      <header className="bg-navy-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 ring-1 ring-white/20">
              <Landmark className="h-5 w-5 text-gold-400" />
            </div>
            <div>
              <div className="text-base font-bold tracking-tight">회비자동산출시스템</div>
              <div className="text-xs text-navy-200">업무별 분담기준 학습 · 분기 회비 산출 AI툴</div>
            </div>
          </div>
          {health && (
            <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-navy-100 ring-1 ring-white/15">
              <BrainCircuit className="h-3.5 w-3.5 text-gold-400" />
              분담기준 학습 엔진: <b className="text-white">{health.aiEngine === 'rule-based' ? '규칙 기반 해석기' : `Claude (${health.aiEngine})`}</b>
            </div>
          )}
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 px-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-t-lg px-4 py-2.5 text-sm font-semibold transition ${
                tab === t.key ? 'bg-slate-100 text-navy-900' : 'text-navy-200 hover:bg-white/5 hover:text-white'
              }`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
              {t.badge && <span className="rounded bg-gold-500/90 px-1.5 py-px text-[10px] font-bold text-navy-950">{t.badge}</span>}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>}
        {tab === 'calc'
          ? <CalculatePage works={works} accept={health?.accept} />
          : <CriteriaPage works={works} onChanged={reloadWorks} aiEngine={health?.aiEngine} />}
      </main>
      <footer className="pb-8 text-center text-xs text-slate-400">
        예시 업무·기관·실적은 모두 가상 데이터입니다. 회비 금액은 학습된 규칙을 코드로 계산하며 AI가 직접 계산하지 않습니다.
      </footer>
    </div>
  );
}
