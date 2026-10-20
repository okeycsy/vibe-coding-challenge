import { useState } from 'react';
import { ClipboardCheck, FlaskConical, Search } from 'lucide-react';
import { BUSINESSES, INSTITUTIONS, TEST_RESULTS } from '../data/mockData';
import { fmt } from '../utils/fee';
import { periodLabel } from '../utils/period';
import { Card, StatusBadge } from './ui';

const TEST_TONE = {
  성공: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  실패: 'bg-rose-50 text-rose-700 border-rose-200',
  진행중: 'bg-accent-50 text-accent-700 border-accent-200',
};

export default function ResultsManagement({ user, runs, setRuns, notify }) {
  const isOperator = user.side === 'kftc';
  const [tests, setTests] = useState(TEST_RESULTS);
  const [query, setQuery] = useState('');

  const instName = (id) => INSTITUTIONS.find((i) => i.id === id)?.name;
  const mine = (id) => isOperator || id === user.institutionId;

  const reconRows = Object.entries(runs).flatMap(([key, run]) => {
    const biz = BUSINESSES.find((b) => b.id === run.businessId);
    return run.rows
      .filter((r) => mine(r.institutionId))
      .map((r) => ({ key, biz: biz.name, period: periodLabel(run.from, run.to), ...r }));
  });
  const filteredRecon = reconRows.filter((r) => !query || r.name.includes(query) || r.biz.includes(query));

  const counts = ['대기', '확인중', '완료'].map((s) => ({ s, n: reconRows.filter((r) => r.status === s).length }));

  const visibleTests = tests.filter((t) => mine(t.institutionId));

  const retest = (id) => {
    setTests((ts) => ts.map((t) => (t.id === id ? { ...t, result: '진행중', note: '재테스트 요청됨' } : t)));
    notify('재테스트를 요청했습니다.');
    setTimeout(() => {
      setTests((ts) => ts.map((t) => (t.id === id ? { ...t, result: '성공', note: '재테스트 통과', date: new Date().toLocaleString('ko-KR') } : t)));
    }, 1500);
  };

  const completeAll = () => {
    setRuns((all) =>
      Object.fromEntries(
        Object.entries(all).map(([k, run]) => [k, { ...run, rows: run.rows.map((r) => (r.status === '확인중' ? { ...r, status: '완료' } : r)) }]),
      ),
    );
    notify('확인중인 대사 건을 모두 완료 처리했습니다.');
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-brand-900">{isOperator ? '기관 테스트/대사 결과 관리' : '테스트/대사 결과 조회'}</h2>
        <p className="text-sm text-slate-500 mt-0.5">참가기관별 연동 테스트 결과와 회비 대사 진행 현황을 확인합니다.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {counts.map(({ s, n }) => (
          <div key={s} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500">대사 {s}</p>
              <p className="text-2xl font-bold text-brand-900 tabular-nums">{n}<span className="text-sm font-normal text-slate-400 ml-1">건</span></p>
            </div>
            <StatusBadge status={s} />
          </div>
        ))}
      </div>

      <Card
        id="results-recon"
        title="회비 대사 현황"
        icon={ClipboardCheck}
        right={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="기관·업무 검색"
                className="rounded-lg border border-slate-300 pl-8 pr-3 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
            </div>
            {isOperator && (
              <button onClick={completeAll} className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs text-white hover:bg-brand-800">
                확인중 일괄 완료
              </button>
            )}
          </div>
        }
      >
        {reconRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            산출된 회비가 없습니다. 「회비 산출 및 대사」 메뉴에서 먼저 산출해 주세요.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-96">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">산출기간</th>
                  <th className="px-4 py-2 text-left font-medium">업무</th>
                  <th className="px-4 py-2 text-left font-medium">참가기관</th>
                  <th className="px-4 py-2 text-right font-medium">최종 인정 건수</th>
                  <th className="px-4 py-2 text-right font-medium">산출 회비</th>
                  <th className="px-4 py-2 text-center font-medium">대사 상태</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecon.map((r) => (
                  <tr key={`${r.key}-${r.institutionId}`} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-slate-500">{r.period}</td>
                    <td className="px-4 py-2">{r.biz}</td>
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(r.finalCount)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(r.fee)}원</td>
                    <td className="px-4 py-2 text-center">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card id="results-test" title="기관 연동 테스트 결과" icon={FlaskConical}>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">참가기관</th>
                <th className="px-4 py-2 text-left font-medium">업무</th>
                <th className="px-4 py-2 text-left font-medium">테스트 항목</th>
                <th className="px-4 py-2 text-left font-medium">수행일시</th>
                <th className="px-4 py-2 text-center font-medium">결과</th>
                <th className="px-4 py-2 text-left font-medium">비고</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {visibleTests.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium">{instName(t.institutionId)}</td>
                  <td className="px-4 py-2">{t.business}</td>
                  <td className="px-4 py-2">{t.item}</td>
                  <td className="px-4 py-2 text-slate-500 tabular-nums">{t.date}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${TEST_TONE[t.result]}`}>{t.result}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">{t.note}</td>
                  <td className="px-4 py-2 text-right">
                    {t.result === '실패' && (
                      <button onClick={() => retest(t.id)} className="rounded-md border border-brand-200 px-2 py-0.5 text-xs text-brand-700 hover:bg-brand-50">
                        재테스트
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {visibleTests.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">테스트 이력이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
