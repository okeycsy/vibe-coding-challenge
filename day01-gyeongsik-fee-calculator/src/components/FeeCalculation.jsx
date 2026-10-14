import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Briefcase,
  CalendarDays,
  CloudUpload,
  Download,
  FileSpreadsheet,
  Info,
  LoaderCircle,
  Send,
  Sparkles,
  Tag,
  TriangleAlert,
  Trash2,
  X,
} from 'lucide-react';
import { BUSINESSES, INSTITUTIONS, ISSUE_EXAMPLES, QUARTERS, YEARS } from '../data/mockData';
import { calculateFees, fmt, parseIssue, runKey } from '../utils/fee';
import { downloadReconciliation, downloadRevenueResolution } from '../utils/excel';
import { Card, Select, StatusBadge } from './ui';

const NEXT_STATUS = { 대기: '확인중', 확인중: '완료', 완료: '대기' };
const LOADING_STEPS = ['Raw Data 검증 중…', 'AI 이슈 해석 및 예외 건 차감 중…', '회비분담기준 적용 중…'];

// 오늘 기준 직전 분기를 산출 대상으로 자동 인식 (회비는 분기 종료 후 산출)
function detectPeriod(today = new Date()) {
  const q = Math.floor(today.getMonth() / 3) + 1;
  return q === 1 ? { year: today.getFullYear() - 1, quarter: 4 } : { year: today.getFullYear(), quarter: q - 1 };
}

export default function FeeCalculation({ user, runs, setRuns, notify }) {
  const isOperator = user.role === 'operator';
  const detected = detectPeriod();
  const [businessId, setBusinessId] = useState(BUSINESSES[0].id);
  const [year, setYear] = useState(YEARS.includes(detected.year) ? detected.year : 2026);
  const [quarter, setQuarter] = useState(detected.quarter);
  const [drafts, setDrafts] = useState({});
  const [issueText, setIssueText] = useState('');
  const [loadingStep, setLoadingStep] = useState(-1);
  const [uploading, setUploading] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const business = BUSINESSES.find((b) => b.id === businessId);
  const key = runKey(businessId, year, quarter);
  const draft = drafts[key] ?? { file: null, issues: [] };
  const run = runs[key];
  const isAuto = year === detected.year && quarter === detected.quarter;

  const updateDraft = (patch, k = key) =>
    setDrafts((d) => ({ ...d, [k]: { ...(d[k] ?? { file: null, issues: [] }), ...patch } }));
  const updateRows = (fn) =>
    setRuns((r) => ({ ...r, [key]: { ...r[key], rows: r[key].rows.map(fn) } }));
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));

  // ── Step 2: 업로드 시뮬레이션 ──
  const simulateUpload = (file) => {
    const name = file?.name ?? `${business.name}_${year}_${quarter}Q_RawData.xlsx`;
    const size = file?.size ?? 2_400_000 + Math.round(Math.random() * 800_000);
    const k = key;
    setUploading(0);
    [25, 55, 80, 100].forEach((p, i) => later(() => setUploading(p), 180 * (i + 1)));
    later(() => {
      setUploading(null);
      updateDraft({ file: { name, size, rows: INSTITUTIONS.length * 1200 + Math.round(Math.random() * 500) } }, k);
      notify(`${name} 업로드가 완료되었습니다.`);
    }, 900);
  };

  const addIssue = () => {
    const text = issueText.trim();
    if (!text) return;
    const parsed = parseIssue(text);
    if (!parsed.institutionId || !parsed.count) {
      notify('기관명과 차감 건수(예: 1,500건)를 문장에 포함해 주세요.', 'error');
      return;
    }
    updateDraft({ issues: [...draft.issues, { id: Date.now(), text, parsed }] });
    setIssueText('');
  };

  const removeIssue = (id) => updateDraft({ issues: draft.issues.filter((i) => i.id !== id) });

  const runCalculation = () => {
    setLoadingStep(0);
    later(() => setLoadingStep(1), 550);
    later(() => setLoadingStep(2), 1100);
    later(() => {
      const rows = calculateFees({ businessId, year, quarter, issues: draft.issues });
      setRuns((r) => ({
        ...r,
        [key]: { businessId, year, quarter, rows, issues: draft.issues, createdAt: new Date().toLocaleString('ko-KR') },
      }));
      setLoadingStep(-1);
      notify('AI 회비 초안 산출이 완료되었습니다.');
    }, 1700);
  };

  // ── Step 3: 상태 변경·다운로드 ──
  const setRowStatus = (institutionId, status) =>
    updateRows((row) => (row.institutionId === institutionId ? { ...row, status } : row));

  const visibleRows = run ? (isOperator ? run.rows : run.rows.filter((r) => r.institutionId === user.institutionId)) : [];

  const downloadForInstitutions = () => {
    downloadReconciliation({ business, year, quarter, rows: visibleRows, issues: run.issues });
    if (isOperator) {
      updateRows((row) => (row.status === '대기' ? { ...row, status: '확인중' } : row));
      notify('대사용 파일을 내려받았습니다. 대기 중인 기관은 확인중으로 바뀌었습니다.');
    }
  };

  const totals = visibleRows.reduce(
    (t, r) => ({ base: t.base + r.baseCount, ded: t.ded + r.deduction, fin: t.fin + r.finalCount, fee: t.fee + r.fee }),
    { base: 0, ded: 0, fin: 0, fee: 0 },
  );

  const loading = loadingStep >= 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-brand-900">회비 산출 및 대사</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          {isOperator
            ? '업무와 분기를 선택하고 Raw Data와 이슈를 반영해 회비 초안을 산출합니다.'
            : '결제원이 산출한 우리 기관의 회비 초안을 확인하고 대사 결과를 회신합니다.'}
        </p>
      </div>

      {/* STEP 1 */}
      <Card id="calc-period" step={1} title="업무 및 분기 선택" icon={Briefcase}>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-2 space-y-3">
            <Select label="업무 선택" value={businessId} onChange={setBusinessId}>
              {BUSINESSES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Select label="연도" value={year} onChange={(v) => setYear(Number(v))}>
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </Select>
              <Select label="분기" value={quarter} onChange={(v) => setQuarter(Number(v))}>
                {QUARTERS.map((q) => (
                  <option key={q} value={q}>
                    {q}분기
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <CalendarDays className="w-3.5 h-3.5 text-brand-400" />
              {isAuto ? (
                <span className="text-brand-600">직전 분기({detected.year}년 {detected.quarter}분기)로 자동 인식되었습니다.</span>
              ) : (
                <button
                  className="text-brand-500 underline underline-offset-2"
                  onClick={() => {
                    setYear(detected.year);
                    setQuarter(detected.quarter);
                  }}
                >
                  직전 분기({detected.year}년 {detected.quarter}분기)로 되돌리기
                </button>
              )}
            </div>
          </div>

          <div className="lg:col-span-3 rounded-lg border border-brand-100 bg-brand-50/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-brand-500" />
              <p className="text-sm font-semibold text-brand-800">{business.name} 회비분담기준 요약</p>
              <span className="ml-auto rounded bg-white border border-brand-200 px-2 py-0.5 text-[11px] text-brand-600">
                {business.method === 'unit' ? '건당 단가 방식' : '총액 분담 방식'}
              </span>
            </div>
            <ul className="space-y-1.5 text-sm text-slate-700">
              {business.summary.map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="mt-2 w-1 h-1 rounded-full bg-brand-400 shrink-0" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      {/* STEP 2 */}
      {isOperator && (
        <Card id="calc-input" step={2} title="데이터 입력 및 AI 이슈 반영" icon={Bot}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">실적 Raw Data (Excel)</p>
              {draft.file ? (
                <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <FileSpreadsheet className="w-9 h-9 text-emerald-600" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{draft.file.name}</p>
                    <p className="text-xs text-slate-500">
                      {(draft.file.size / 1024 / 1024).toFixed(1)}MB · {fmt(draft.file.rows)}행 검증 완료
                    </p>
                  </div>
                  <button
                    onClick={() => updateDraft({ file: null })}
                    className="p-1.5 rounded hover:bg-emerald-100 text-slate-500"
                    title="파일 제거"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => uploading === null && simulateUpload()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    if (uploading === null) simulateUpload(e.dataTransfer.files[0]);
                  }}
                  className={`w-full h-36 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2 transition ${
                    dragOver ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-slate-50 hover:border-brand-300'
                  }`}
                >
                  {uploading !== null ? (
                    <>
                      <LoaderCircle className="w-7 h-7 text-brand-500 animate-spin" />
                      <div className="w-48 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-500 transition-all" style={{ width: `${uploading}%` }} />
                      </div>
                      <p className="text-xs text-slate-500">업로드 중… {uploading}%</p>
                    </>
                  ) : (
                    <>
                      <CloudUpload className="w-8 h-8 text-brand-400" />
                      <p className="text-sm text-slate-600">
                        Excel 파일을 끌어다 놓거나 <span className="text-brand-600 font-semibold">클릭</span>하세요
                      </p>
                      <p className="text-[11px] text-slate-400">.xlsx, .xls · 최대 50MB (시연용: 실제 파일은 읽지 않습니다)</p>
                    </>
                  )}
                </button>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">AI 에이전트 이슈 입력</p>
              <div className="rounded-lg border border-slate-300 focus-within:ring-2 focus-within:ring-brand-300">
                <textarea
                  value={issueText}
                  onChange={(e) => setIssueText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      addIssue();
                    }
                  }}
                  rows={3}
                  placeholder={`예: ${ISSUE_EXAMPLES[0]}`}
                  className="w-full resize-none rounded-t-lg px-3 py-2 text-sm focus:outline-none"
                />
                <div className="flex items-center justify-between border-t border-slate-100 px-2 py-1.5">
                  <div className="flex gap-1 overflow-x-auto">
                    {ISSUE_EXAMPLES.map((ex, i) => (
                      <button
                        key={ex}
                        onClick={() => setIssueText(ex)}
                        className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-brand-50"
                      >
                        예시 {i + 1}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={addIssue}
                    className="flex items-center gap-1 rounded-md bg-brand-700 px-3 py-1 text-xs text-white hover:bg-brand-800"
                  >
                    <Send className="w-3 h-3" /> 이슈 등록
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <p className="text-[11px] text-slate-400 mb-1.5 flex items-center gap-1">
                  <Tag className="w-3 h-3" /> 이슈 기록 히스토리 ({draft.issues.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {draft.issues.length === 0 && <span className="text-xs text-slate-400">등록된 이슈가 없습니다.</span>}
                  {draft.issues.map((i) => (
                    <span
                      key={i.id}
                      title={i.text}
                      className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 pl-2.5 pr-1 py-0.5 text-xs text-amber-800"
                    >
                      #{i.parsed.institutionName} {i.parsed.date && `${i.parsed.date} `}
                      {i.parsed.reason} -{fmt(i.parsed.count)}건
                      <button onClick={() => removeIssue(i.id)} className="rounded-full p-0.5 hover:bg-amber-100">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
            {!draft.file && <p className="text-xs text-slate-400">Raw Data를 업로드하면 산출할 수 있습니다.</p>}
            <button
              onClick={runCalculation}
              disabled={!draft.file || loading}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-700 to-accent-500 px-5 py-2.5 text-sm font-semibold text-white shadow hover:shadow-md disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
            >
              {loading ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {run ? 'AI 회비 초안 다시 산출하기' : 'AI 회비 초안 산출하기'}
            </button>
          </div>
        </Card>
      )}

      {/* STEP 3 */}
      <Card
        id="calc-result"
        step={isOperator ? 3 : 2}
        title="회비 산출 결과"
        icon={FileSpreadsheet}
        right={
          run &&
          !loading && (
            <div className="flex gap-2">
              <button
                onClick={downloadForInstitutions}
                className="flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
              >
                <Download className="w-3.5 h-3.5" /> 참가기관 송부 대사용 Excel 다운로드
              </button>
              {isOperator && (
                <button
                  onClick={() => downloadRevenueResolution({ business, year, quarter, rows: run.rows })}
                  className="flex items-center gap-1.5 rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800"
                >
                  <Download className="w-3.5 h-3.5" /> 예산회계시스템 수입결의용 Excel 다운로드
                </button>
              )}
            </div>
          )
        }
      >
        {loading ? (
          <div className="py-6">
            <div className="flex flex-col items-center gap-3 mb-6">
              <div className="relative">
                <Sparkles className="w-8 h-8 text-accent-500 animate-pulse" />
              </div>
              <p className="text-sm font-medium text-brand-700">{LOADING_STEPS[loadingStep]}</p>
              <div className="flex gap-1.5">
                {LOADING_STEPS.map((s, i) => (
                  <span key={s} className={`h-1.5 w-10 rounded-full ${i <= loadingStep ? 'bg-brand-500' : 'bg-slate-200'}`} />
                ))}
              </div>
            </div>
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 rounded bg-slate-100 animate-pulse" />
              ))}
            </div>
          </div>
        ) : !run ? (
          <div className="py-12 text-center text-sm text-slate-400">
            {isOperator
              ? '아직 산출 결과가 없습니다. STEP 2에서 AI 회비 초안을 산출해 주세요.'
              : `${year}년 ${quarter}분기 ${business.name} 회비는 아직 결제원에서 산출하지 않았습니다.`}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500 mb-3">
              <span>
                {year}년 {quarter}분기 · {business.name}
              </span>
              <span>산출일시 {run.createdAt}</span>
              <span>반영 이슈 {run.issues.length}건</span>
              {isOperator && <span className="text-brand-500">대사 상태 배지를 누르면 상태가 바뀝니다.</span>}
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-brand-800 text-white text-xs">
                  <tr>
                    {['참가기관명', '기본 건수', 'AI 예외 차감 건수', '최종 인정 건수', '적용 단가/분담률', '산출 회비(초안)', '대사 상태'].map(
                      (h, i) => (
                        <th key={h} className={`px-4 py-2.5 font-medium whitespace-nowrap ${i === 0 ? 'text-left' : i === 6 ? 'text-center' : 'text-right'}`}>
                          {h}
                        </th>
                      ),
                    )}
                    {!isOperator && <th className="px-4 py-2.5 font-medium text-center">대사 회신</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => {
                    const hit = r.deduction > 0;
                    return (
                      <tr key={r.institutionId} className={`border-t border-slate-100 ${hit ? 'bg-amber-50/80' : 'hover:bg-slate-50'}`}>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="font-medium text-brand-900">{r.name}</span>
                          <span className="ml-1.5 text-[11px] text-slate-400">{r.code}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(r.baseCount)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {hit ? (
                            <span
                              className="inline-flex items-center gap-1 font-semibold text-rose-600 cursor-help"
                              onMouseEnter={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setTooltip({ x: rect.right, y: rect.bottom + 6, reasons: r.reasons });
                              }}
                              onMouseLeave={() => setTooltip(null)}
                            >
                              <TriangleAlert className="w-3.5 h-3.5" />-{fmt(r.deduction)}
                            </span>
                          ) : (
                            <span className="text-slate-300">0</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmt(r.finalCount)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.rateLabel}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-brand-900">{fmt(r.fee)}원</td>
                        <td className="px-4 py-2.5 text-center">
                          <StatusBadge
                            status={r.status}
                            onClick={isOperator ? () => setRowStatus(r.institutionId, NEXT_STATUS[r.status]) : undefined}
                          />
                        </td>
                        {!isOperator && (
                          <td className="px-4 py-2.5 text-center whitespace-nowrap space-x-1.5">
                            <button
                              disabled={r.status === '완료'}
                              onClick={() => {
                                setRowStatus(r.institutionId, '완료');
                                notify('대사 확인 완료를 결제원에 회신했습니다.');
                              }}
                              className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-700 disabled:bg-slate-300"
                            >
                              이상 없음
                            </button>
                            <button
                              onClick={() => {
                                setRowStatus(r.institutionId, '확인중');
                                notify('이의 제기가 접수되었습니다. 결제원 담당자가 확인합니다.');
                              }}
                              className="rounded-md border border-rose-300 px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50"
                            >
                              이의 제기
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                {isOperator && (
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200 text-sm font-semibold">
                    <tr>
                      <td className="px-4 py-2.5">합계</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(totals.base)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-rose-600">
                        {totals.ded ? `-${fmt(totals.ded)}` : 0}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(totals.fin)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500 text-xs">
                        {business.method === 'unit' ? `${business.unitPrice}원/건` : '100.00%'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-brand-900">{fmt(totals.fee)}원</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {visibleRows.some((r) => r.deduction > 0) && (
              <p className="mt-2 text-xs text-amber-700 flex items-center gap-1">
                <TriangleAlert className="w-3.5 h-3.5" /> 노란색 행은 AI 이슈로 건수가 차감된 기관입니다. 차감 건수에 마우스를 올리면 사유가 보입니다.
              </p>
            )}
          </>
        )}
      </Card>

      {tooltip && (
        <div
          className="fixed z-50 max-w-sm -translate-x-full rounded-lg bg-brand-900 px-3 py-2 text-xs text-white shadow-xl"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <p className="font-semibold text-accent-300 mb-1">AI 차감 사유</p>
          <ul className="space-y-1">
            {tooltip.reasons.map((t) => (
              <li key={t}>· {t}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
