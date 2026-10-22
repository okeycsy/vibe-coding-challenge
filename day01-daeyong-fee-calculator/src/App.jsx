import { useEffect, useMemo, useState } from 'react';
import { runBusiness, STATUS_LABEL } from './engine/pipeline.js';
import { sampleBusinesses } from './engine/model.js';
import { fmtWon, StatusBadge } from './ui/common.jsx';
import BusinessScreen from './ui/BusinessScreen.jsx';
import ConditionsScreen from './ui/ConditionsScreen.jsx';
import DataScreen from './ui/DataScreen.jsx';
import AdjustScreen from './ui/AdjustScreen.jsx';
import ResultScreen from './ui/ResultScreen.jsx';
import OrgDetail from './ui/OrgDetail.jsx';

const STORAGE_KEY = 'daeyong-fee-calculator/v4';
const TABS = [
  { id: 'org', no: 1, label: '업무·참가기관' },
  { id: 'conditions', no: 2, label: '산출 조건' },
  { id: 'data', no: 3, label: '실적 데이터' },
  { id: 'adjust', no: 4, label: '금액 보정' },
  { id: 'result', no: 5, label: '산출 결과' },
];

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.businesses?.length) return saved;
  } catch {
    // 저장소를 못 쓰는 환경이면 예시로 시작
  }
  const businesses = sampleBusinesses();
  return { businesses, currentId: businesses[0].id };
}

export default function App() {
  const [state, setState] = useState(loadState);
  const [tab, setTab] = useState('result');
  const [detailId, setDetailId] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const business = state.businesses.find((b) => b.id === state.currentId) ?? state.businesses[0];
  const run = useMemo(() => runBusiness(business), [business]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        setSavedAt(new Date());
      } catch {
        setSavedAt(null);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [state]);

  // 현재 업무를 바꾸는 함수. decisionKey를 주면 그 기본값을 담당자가 확인한 것으로 기록
  const update = (fn, decisionKey) =>
    setState((st) => ({
      ...st,
      businesses: st.businesses.map((b) => {
        if (b.id !== business.id) return b;
        const next = fn(b);
        const keys = [].concat(decisionKey ?? []);
        return keys.length ? { ...next, confirmed: { ...next.confirmed, ...Object.fromEntries(keys.map((k) => [k, true])) } } : next;
      }),
    }));
  const setSettings = (patch, decisionKey) => update((b) => ({ ...b, settings: { ...b.settings, ...patch } }), decisionKey);
  const confirm = (key) => update((b) => b, key);
  const ctx = { business, run, update, setSettings, confirm, openDetail: setDetailId, goTo: setTab };

  const s = business.settings;
  const fee = run.fee;
  const pendingCount = run.pending.length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <div className="brand">
            <span className="mark" aria-hidden="true">₩</span>
            <div>
              <h1>회비 산출</h1>
              <p>업무별 산출 옵션으로 참가기관 회비를 계산하고 근거를 남깁니다</p>
            </div>
          </div>
          <div className="biz-switch">
            <label htmlFor="biz-select">업무</label>
            <select
              id="biz-select"
              value={business.id}
              onChange={(e) => {
                setState((st) => ({ ...st, currentId: e.target.value }));
                setDetailId(null);
              }}
            >
              {state.businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <nav className="wrap tabs" aria-label="화면">
          {TABS.map((t) => (
            <button key={t.id} type="button" className={`tab ${tab === t.id ? 'is-on' : ''}`} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
              <span className="tab-no">{t.no}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="summarybar">
        <div className="wrap summarybar-inner">
          <div className="sum-item">
            <span>산출 대상</span>
            <b>{s.year}년 {s.quarter}분기</b>
          </div>
          <div className="sum-item">
            <span>분기 청구 대상 총액</span>
            <b>{fmtWon(run.total)}</b>
          </div>
          <div className="sum-item">
            <span>분담 기관</span>
            <b>{fee?.orgCount ?? 0}개</b>
          </div>
          <div className="sum-item">
            <span>균등 / 실적 총액</span>
            <b>{fee ? `${fmtWon(fee.equal.pool)} / ${fmtWon(fee.perf.pool)}` : '-'}</b>
          </div>
          <button type="button" className={`sum-status status-${run.status}`} onClick={() => setTab('result')}>
            <StatusBadge status={run.status} text={`검증 ${STATUS_LABEL[run.status]}`} />
            {pendingCount > 0 && <small>기본값 확인 {pendingCount}건</small>}
          </button>
        </div>
      </div>

      <main className="wrap main" key={business.id}>
        {tab === 'org' && <BusinessScreen {...ctx} state={state} setState={setState} />}
        {tab === 'conditions' && <ConditionsScreen {...ctx} />}
        {tab === 'data' && <DataScreen {...ctx} />}
        {tab === 'adjust' && <AdjustScreen {...ctx} />}
        {tab === 'result' && <ResultScreen {...ctx} />}
        <p className="saved-note">
          {savedAt ? `설정과 데이터는 이 브라우저에 자동 저장됩니다 (${savedAt.toLocaleTimeString('ko-KR')})` : '이 브라우저에는 저장할 수 없어 새로 열면 예시로 돌아갑니다. 업무 화면의 설정 내보내기를 쓰세요.'}
        </p>
      </main>

      {detailId && fee && (
        <OrgDetail business={business} run={run} orgId={detailId} onClose={() => setDetailId(null)} onMove={setDetailId} />
      )}
    </div>
  );
}
