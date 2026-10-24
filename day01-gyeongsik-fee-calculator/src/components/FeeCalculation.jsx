import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Briefcase,
  CalendarDays,
  CloudUpload,
  Download,
  FileCode2,
  FileSpreadsheet,
  Info,
  Plus,
  LoaderCircle,
  Send,
  Sparkles,
  Tag,
  TriangleAlert,
  Trash2,
  X,
} from 'lucide-react';
import { BUSINESSES, INSTITUTIONS, ISSUE_EXAMPLES } from '../data/mockData';
import { calculateFees, fmt, parseIssue, periodScale, runKey } from '../utils/fee';
import { daysBetween, parseDate, periodLabel, periodTag, previousQuarter, quarterRange, toISO } from '../utils/period';
import { downloadReconciliation, downloadRevenueResolution } from '../utils/excel';
import { Card, Select, StatusBadge } from './ui';
import DateField from './DateField';
import { api, apiEnabled } from '../utils/api';
import { TASK_CODES, builtInTasks, localSkillDetail } from '../utils/skill';

const NEXT_STATUS = { 대기: '확인중', 확인중: '완료', 완료: '대기' };
const LOADING_STEPS = ['Raw Data 검증 중…', 'AI 이슈 해석 및 예외 건 차감 중…', '회비분담기준 적용 중…'];

// 기간 빠른 선택. 기본값은 오늘 기준 직전 분기(회비는 분기 종료 후 산출)다.
function periodPresets(today = new Date()) {
  const y = today.getFullYear();
  const cq = Math.floor(today.getMonth() / 3) + 1;
  const quarters = [1, 2, 3, 4].filter((q) => q < cq).map((q) => ({ label: `${y}년 ${q}분기`, ...quarterRange(y, q) }));
  return [
    { label: '직전 분기', ...previousQuarter(today) },
    { label: '최근 1개월', from: toISO(new Date(y, today.getMonth() - 1, today.getDate() + 1)), to: toISO(today) },
    { label: '올해 누적', from: `${y}-01-01`, to: toISO(today) },
    ...quarters,
  ];
}

export default function FeeCalculation({
  user,
  runs,
  setRuns,
  notify,
  allowedTasks,
  onRequestTask,
  skillOverrides,
  skillVersion,
  onOpenSkill,
  businesses = BUSINESSES,
}) {
  // 결제원 담당자(일반담당자·시스템관리자)는 산출, 참가기관은 조회·대사 회신만 한다.
  const isOperator = user.side === 'kftc';
  // 업무별 산출 권한: 일반담당자는 승인된 업무만, 시스템관리자는 전체 업무를 선택할 수 있다.
  const canSelect = (id) => !isOperator || allowedTasks.includes(id);
  const presets = periodPresets();
  const detected = presets[0];
  const [businessId, setBusinessId] = useState(BUSINESSES[0].id);
  // 산출 기간: 입력 중인 문자열 그대로 두고 아래에서 검증한다.
  const [fromText, setFromText] = useState(detected.from);
  const [toText, setToText] = useState(detected.to);
  const [drafts, setDrafts] = useState({});
  const [issueText, setIssueText] = useState('');
  const [loadingStep, setLoadingStep] = useState(-1);
  const [uploading, setUploading] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  // 업무별 skill.md (업무 ID → 해석 결과). 서버가 있으면 서버에서, 없으면 묶어 온 원본 + 화면 수정본에서 읽는다.
  const [skills, setSkills] = useState({});
  const [skillError, setSkillError] = useState(null);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // 역할이 바뀌어 지금 업무에 권한이 없어지면 선택 가능한 첫 업무로 옮긴다.
  useEffect(() => {
    if (!canSelect(businessId) || !businesses.some((b) => b.id === businessId)) {
      const first = businesses.find((b) => canSelect(b.id));
      if (first) setBusinessId(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.role, allowedTasks, businesses]);

  // 업무 관리에서 지운 업무는 목록에서 빠진다 (옮겨 가기 전 한 번 그릴 때는 원래 업무 정보를 쓴다)
  const business = businesses.find((b) => b.id === businessId) ?? BUSINESSES.find((b) => b.id === businessId);
  const skill = skills[businessId];

  // Step 1에서 업무를 고르면 해당 skill.md를 불러온다. 회비기준 관리에서 저장하면(skillVersion) 다시 읽는다.
  // 참가기관처럼 skill.md 권한이 없으면(403) 요약은 기본 문구로 보여 준다.
  useEffect(() => {
    let alive = true;
    setSkillError(null);
    if (!canSelect(businessId)) {
      setSkills((m) => ({ ...m, [businessId]: undefined }));
      return undefined;
    }
    if (!apiEnabled) {
      try {
        setSkills((m) => ({ ...m, [businessId]: localSkillDetail(builtInTasks([business])[0], skillOverrides) }));
      } catch (e) {
        setSkillError(e.message);
      }
      return undefined;
    }
    api
      .skill(businessId)
      .then((data) => alive && setSkills((m) => ({ ...m, [businessId]: data })))
      .catch((e) => alive && (e.status === 403 ? setSkills((m) => ({ ...m, [businessId]: undefined })) : setSkillError(e.message)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, skillOverrides, skillVersion, user.id, allowedTasks]);

  // ── 기간 검증: 각 날짜가 실제 날짜인지, From이 To보다 늦지 않은지 ──
  const fromCheck = parseDate(fromText);
  const toCheck = parseDate(toText);
  // 입력이 끝나지 않은 값(8자리 미만)은 경고하지 않고 산출만 막는다.
  const fieldError = (text, check) => (text.length === 10 || !text ? check.error : null);
  const fromError = fieldError(fromText, fromCheck);
  const toError = fieldError(toText, toCheck);
  const orderError =
    fromCheck.date && toCheck.date && fromCheck.date > toCheck.date
      ? `시작일(From) ${fromText}이 종료일(To) ${toText}보다 늦습니다. 기간을 다시 확인해 주세요.`
      : null;
  const periodValid = !!(fromCheck.date && toCheck.date) && !orderError;
  const from = periodValid ? fromText : null;
  const to = periodValid ? toText : null;
  const setPeriod = (p) => {
    setFromText(p.from);
    setToText(p.to);
  };

  const key = periodValid ? runKey(businessId, from, to) : null;
  const draft = (key && drafts[key]) ?? { file: null, issues: [] };
  const run = key ? runs[key] : undefined;

  const updateDraft = (patch, k = key) =>
    setDrafts((d) => ({ ...d, [k]: { ...(d[k] ?? { file: null, issues: [] }), ...patch } }));
  const updateRows = (fn) => setRuns((r) => ({ ...r, [key]: { ...r[key], rows: r[key].rows.map(fn) } }));
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));

  // ── Step 2: 업로드 시뮬레이션 ──
  const simulateUpload = (file) => {
    if (!periodValid) {
      notify('산출 기간을 먼저 올바르게 입력해 주세요.', 'error');
      return;
    }
    const name = file?.name ?? `${business.name}_${periodTag(from, to)}_RawData.xlsx`;
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
    if (!periodValid) {
      notify('산출 기간을 먼저 올바르게 입력해 주세요.', 'error');
      return;
    }
    const parsed = parseIssue(text);
    if (!parsed.institutionId || !parsed.count) {
      notify('기관명과 차감 건수(예: 1,500건)를 문장에 포함해 주세요.', 'error');
      return;
    }
    updateDraft({ issues: [...draft.issues, { id: Date.now(), text, parsed }] });
    setIssueText('');
  };

  const removeIssue = (id) => updateDraft({ issues: draft.issues.filter((i) => i.id !== id) });

  // 산출: 서버가 있으면 POST /api/v1/fees/calculate (SkillEngineService), 없으면 브라우저에서 같은 수식으로 계산
  const runCalculation = () => {
    if (!skill) {
      notify(skillError ?? '회비 기준(skill.md)을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.', 'error');
      return;
    }
    const k = key;
    const issues = draft.issues;
    const used = { calcType: skill.calcType, formula: skill.formula, summary: skill.summary };
    setLoadingStep(0);
    later(() => setLoadingStep(1), 550);
    later(() => setLoadingStep(2), 1100);
    const compute = apiEnabled
      ? api
          .calculate({ businessId, from, to, issues: issues.map((i) => i.text), requestedBy: user.id })
          .then((res) => ({ rows: res.rows, used: { ...used, calcType: res.calcType, formula: res.formula } }))
      : new Promise((resolve) => resolve({ rows: calculateFees({ businessId, from, to, issues, skill }), used }));
    const minDelay = new Promise((resolve) => later(resolve, 1700));
    Promise.all([compute, minDelay])
      .then(([{ rows, used: applied }]) => {
        setRuns((r) => ({
          ...r,
          [k]: { businessId, from, to, rows, issues, skill: applied, createdAt: new Date().toLocaleString('ko-KR') },
        }));
        notify('skill.md 수식으로 AI 회비 초안 산출이 완료되었습니다.');
      })
      .catch((e) => notify(`산출하지 못했습니다: ${e.message}`, 'error'))
      .finally(() => setLoadingStep(-1));
  };

  // ── Step 3: 상태 변경·다운로드 ──
  const setRowStatus = (institutionId, status) =>
    updateRows((row) => (row.institutionId === institutionId ? { ...row, status } : row));

  const visibleRows = run
    ? isOperator
      ? run.rows
      : run.rows.filter((r) => r.institutionId === user.institutionId)
    : [];

  const downloadForInstitutions = () => {
    downloadReconciliation({
      business: { ...business, summary: run.skill?.summary ?? business.summary },
      from,
      to,
      rows: visibleRows,
      issues: run.issues,
    });
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
        <h2 className="text-xl font-bold text-brand-900">{isOperator ? '회비 산출 및 대사' : '회비 대사 확인'}</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          {isOperator
            ? '업무와 산출 기간을 선택하고 Raw Data와 이슈를 반영해 회비 초안을 산출합니다.'
            : '결제원이 산출한 우리 기관의 회비 초안을 확인하고 대사 결과를 회신합니다.'}
        </p>
      </div>

      {/* STEP 1 */}
      <Card id="calc-period" step={1} title="업무 및 기간 선택" icon={Briefcase}>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Select label="업무 선택" value={businessId} onChange={setBusinessId}>
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id} disabled={!canSelect(b.id)}>
                      {b.name}
                      {canSelect(b.id) ? '' : ' (권한 없음 - 신청 필요)'}
                    </option>
                  ))}
                </Select>
              </div>
              {user.role === 'operator' && (
                <button
                  onClick={onRequestTask}
                  className="shrink-0 flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-2 text-xs font-medium text-brand-700 hover:bg-brand-100"
                  title="내 정보 관리에서 담당 업무 권한을 신청합니다"
                >
                  <Plus className="w-3.5 h-3.5" /> 담당 업무 추가 신청
                </button>
              )}
            </div>
            {user.role === 'sysadmin' && (
              <p className="text-[11px] text-brand-500">시스템관리자는 모든 업무를 제한 없이 산출할 수 있습니다.</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <DateField
                label="시작일 (From)"
                value={fromText}
                onChange={setFromText}
                error={fromError}
                rangeFrom={fromText}
                rangeTo={toText}
              />
              <DateField
                label="종료일 (To)"
                value={toText}
                onChange={setToText}
                error={toError}
                rangeFrom={fromText}
                rangeTo={toText}
              />
            </div>
            {orderError && (
              <div
                role="alert"
                className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
              >
                <TriangleAlert className="w-4 h-4 shrink-0" />
                <span>{orderError}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <CalendarDays className="w-3.5 h-3.5 text-brand-400" />
              <span className="text-slate-400 mr-0.5">빠른 선택</span>
              {presets.map((p) => {
                const on = p.from === fromText && p.to === toText;
                return (
                  <button
                    key={p.label}
                    onClick={() => setPeriod(p)}
                    className={`rounded-full border px-2 py-0.5 ${
                      on
                        ? 'border-brand-600 bg-brand-700 text-white'
                        : 'border-slate-200 text-slate-500 hover:border-brand-300 hover:text-brand-700'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-500">
              {periodValid ? (
                <>
                  산출 기간 <b className="text-brand-700">{periodLabel(from, to)}</b>
                  {periodScale(from, to) !== 1 &&
                    ` · 분기 기준 실적·총액을 ${daysBetween(from, to)}일 / 91일 비율로 환산합니다.`}
                </>
              ) : (
                '달력 아이콘을 눌러 고르거나 숫자 8자리(예: 20260701)로 입력하세요.'
              )}
            </p>
          </div>

          <div className="lg:col-span-3 rounded-lg border border-brand-100 bg-brand-50/60 p-4">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-brand-500" />
              <p className="text-sm font-semibold text-brand-800">{business.name} 회비분담기준 요약</p>
              {skill && (
                <span className="rounded bg-white border border-brand-200 px-2 py-0.5 text-[11px] text-brand-600">
                  {skill.calcType}
                </span>
              )}
              {skill?.modified && (
                <span className="rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] text-amber-700">수정됨</span>
              )}
              {isOperator && skill && (
                <button
                  onClick={() => onOpenSkill(businessId)}
                  title="회비기준(Skill.md) 관리 화면에서 원문을 보고 고칩니다"
                  className="ml-auto flex items-center gap-1 rounded-lg border border-brand-200 bg-white px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
                >
                  <FileCode2 className="w-3.5 h-3.5" /> 회비기준(skill.md) 보기/수정
                </button>
              )}
            </div>
            {skillError ? (
              <p role="alert" className="flex gap-2 text-xs text-rose-600">
                <TriangleAlert className="w-4 h-4 shrink-0" />
                회비 기준(skill.md)을 불러오지 못했습니다: {skillError}
              </p>
            ) : (
              <>
                <ul className="space-y-1.5 text-sm text-slate-700">
                  {(skill?.summary ?? business.summary).map((s) => (
                    <li key={s} className="flex gap-2">
                      <span className="mt-2 w-1 h-1 rounded-full bg-brand-400 shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
                {skill && (
                  <p className="mt-3 text-[11px] text-slate-500">
                    정산 수식 ({TASK_CODES[businessId]}.md){' '}
                    <code className="break-all rounded bg-white border border-slate-200 px-1.5 py-0.5 font-mono text-brand-800">
                      {skill.formula.replace(/\s+/g, ' ')}
                    </code>
                  </p>
                )}
              </>
            )}
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
                      <p className="text-[11px] text-slate-400">
                        .xlsx, .xls · 최대 50MB (시연용: 실제 파일은 읽지 않습니다)
                      </p>
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
            {!periodValid ? (
              <p className="text-xs text-rose-500">STEP 1의 산출 기간을 올바르게 입력해야 산출할 수 있습니다.</p>
            ) : (
              !draft.file && <p className="text-xs text-slate-400">Raw Data를 업로드하면 산출할 수 있습니다.</p>
            )}
            <button
              onClick={runCalculation}
              disabled={!periodValid || !draft.file || loading}
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
                  onClick={() => downloadRevenueResolution({ business, from, to, rows: run.rows })}
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
                  <span
                    key={s}
                    className={`h-1.5 w-10 rounded-full ${i <= loadingStep ? 'bg-brand-500' : 'bg-slate-200'}`}
                  />
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
            {!periodValid
              ? '산출 기간을 올바르게 입력하면 결과가 표시됩니다.'
              : isOperator
                ? '아직 산출 결과가 없습니다. STEP 2에서 AI 회비 초안을 산출해 주세요.'
                : `${periodLabel(from, to)} ${business.name} 회비는 아직 결제원에서 산출하지 않았습니다.`}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500 mb-3">
              <span>
                {periodLabel(from, to)} · {business.name}
              </span>
              <span>산출일시 {run.createdAt}</span>
              <span>반영 이슈 {run.issues.length}건</span>
              {run.skill && <span>적용 기준 {run.skill.calcType} (skill.md)</span>}
              {isOperator && <span className="text-brand-500">대사 상태 배지를 누르면 상태가 바뀝니다.</span>}
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-brand-800 text-white text-xs">
                  <tr>
                    {[
                      '참가기관명',
                      '기본 건수',
                      'AI 예외 차감 건수',
                      '최종 인정 건수',
                      '적용 단가/분담률',
                      '산출 회비(초안)',
                      '대사 상태',
                    ].map((h, i) => (
                      <th
                        key={h}
                        className={`px-4 py-2.5 font-medium whitespace-nowrap ${i === 0 ? 'text-left' : i === 6 ? 'text-center' : 'text-right'}`}
                      >
                        {h}
                      </th>
                    ))}
                    {!isOperator && <th className="px-4 py-2.5 font-medium text-center">대사 회신</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => {
                    const hit = r.deduction > 0;
                    return (
                      <tr
                        key={r.institutionId}
                        className={`border-t border-slate-100 ${hit ? 'bg-amber-50/80' : 'hover:bg-slate-50'}`}
                      >
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
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-brand-900">
                          {fmt(r.fee)}원
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <StatusBadge
                            status={r.status}
                            onClick={
                              isOperator ? () => setRowStatus(r.institutionId, NEXT_STATUS[r.status]) : undefined
                            }
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
                <TriangleAlert className="w-3.5 h-3.5" /> 노란색 행은 AI 이슈로 건수가 차감된 기관입니다. 차감 건수에
                마우스를 올리면 사유가 보입니다.
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
