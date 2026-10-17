import { useMemo, useRef, useState } from 'react';
import { Building2, Calculator, Download, FileSpreadsheet, RotateCcw, Upload, X } from 'lucide-react';
import { api } from '../api.js';
import { koreanAmount, monthLabel, num, won } from '../format.js';
import { Alert, Button, Card, Stat } from '../ui.jsx';

const THIS_YEAR = new Date().getFullYear();
const YEARS = [THIS_YEAR - 1, THIS_YEAR, THIS_YEAR + 1];

export default function CalculatePage({ works, accept = ['.xlsx', '.csv', '.hwp', '.hwpx'] }) {
  const [workCode, setWorkCode] = useState('');
  const [year, setYear] = useState(THIS_YEAR);
  const [quarter, setQuarter] = useState(Math.min(4, Math.floor(new Date().getMonth() / 3) + 1));
  const [fee, setFee] = useState('');
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const work = works.find((w) => w.code === workCode);
  const feeDigits = fee.replace(/\D/g, '');
  const payload = () => ({ workCode, year, quarter, totalFee: feeDigits, records: parsed?.records });
  const reset = () => { setResult(null); setError(''); };

  async function onFile(f) {
    if (!f) return;
    setFile(f); setParsed(null); reset(); setBusy('parse');
    try { setParsed(await api.parseFile(f, year)); } catch (e) { setError(e.message); } finally { setBusy(''); }
  }

  async function calculate() {
    setError(''); setBusy('calc');
    try { setResult(await api.calculate(payload())); } catch (e) { setResult(null); setError(e.message); } finally { setBusy(''); }
  }

  async function download() {
    setBusy('xlsx');
    try { await api.exportXlsx(payload()); } catch (e) { setError(e.message); } finally { setBusy(''); }
  }

  const preview = useMemo(() => {
    if (!parsed) return null;
    const inst = new Set(parsed.records.map((r) => r.institution));
    const months = [...new Set(parsed.records.map((r) => r.month))].sort();
    const items = [...new Set(parsed.records.map((r) => r.item))];
    return { inst: inst.size, months, items, total: parsed.records.reduce((s, r) => s + r.count, 0) };
  }, [parsed]);

  const ready = work?.rule && feeDigits && parsed?.records?.length;

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <div className="space-y-5">
        <Card step={1} title="업무 · 기간 · 총회비">
          <div className="space-y-4">
            <div>
              <label className="label">업무</label>
              <div className="space-y-2">
                {works.map((w) => (
                  <button
                    key={w.code}
                    type="button"
                    onClick={() => { setWorkCode(w.code); reset(); }}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                      w.code === workCode ? 'border-navy-600 bg-navy-50 ring-1 ring-navy-600' : 'border-slate-200 hover:border-navy-300'
                    }`}
                  >
                    <div className="flex items-center justify-between text-sm font-semibold text-navy-900">
                      {w.name}
                      <span className="text-[11px] font-medium text-slate-500">{w.rule ? `기준 v${w.activeVersion}` : '기준 없음'}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{w.rule?.summary ?? '분담기준 관리에서 기준을 등록하세요.'}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">연도</label>
                <select className="input" value={year} onChange={(e) => { setYear(Number(e.target.value)); reset(); setParsed(null); setFile(null); }}>
                  {YEARS.map((y) => <option key={y} value={y}>{y}년</option>)}
                </select>
              </div>
              <div>
                <label className="label">분기</label>
                <div className="grid grid-cols-4 overflow-hidden rounded-md border border-slate-300">
                  {[1, 2, 3, 4].map((q) => (
                    <button key={q} type="button" onClick={() => { setQuarter(q); reset(); }}
                      className={`py-2 text-sm font-semibold ${q === quarter ? 'bg-navy-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                      {q}Q
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label className="label">분기 총회비 (원)</label>
              <input
                className="input text-right font-semibold tabular-nums"
                inputMode="numeric"
                placeholder="예: 120,000,000"
                value={feeDigits ? Number(feeDigits).toLocaleString('ko-KR') : ''}
                onChange={(e) => { setFee(e.target.value.replace(/\D/g, '').slice(0, 15)); reset(); }}
              />
              <div className="mt-1 h-4 text-right text-xs text-slate-500">{koreanAmount(feeDigits)}</div>
            </div>
          </div>
        </Card>

        <Card step={2} title="실적 데이터 업로드">
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}
            className="cursor-pointer rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition hover:border-navy-400 hover:bg-navy-50"
          >
            <Upload className="mx-auto h-6 w-6 text-navy-500" />
            <div className="mt-2 text-sm font-semibold text-navy-900">파일을 끌어오거나 눌러서 선택</div>
            <div className="mt-1 text-xs text-slate-500">{accept.join(' · ')} — 금융기관명 열과 월별 건수가 있는 표</div>
            <input ref={inputRef} type="file" accept={accept.join(',')} className="hidden" onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }} />
          </div>
          {file && (
            <div className="mt-3 flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
              <span className="flex items-center gap-2 truncate"><FileSpreadsheet className="h-4 w-4 shrink-0 text-navy-500" />{file.name}</span>
              <button type="button" onClick={() => { setFile(null); setParsed(null); reset(); }} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
            </div>
          )}
          {busy === 'parse' && <div className="mt-3 text-sm text-slate-500">파일을 읽는 중…</div>}
          {preview && (
            <div className="mt-3 space-y-2 rounded-md bg-navy-50 px-3 py-2.5 text-xs text-navy-800">
              <div><b>{parsed.source}</b>에서 {parsed.layout === 'long' ? '세로형' : '가로형'} 표를 읽었습니다.</div>
              <div>기관 {preview.inst}곳 · 월 {preview.months.map((m) => (m.startsWith('????') ? m : monthLabel(m))).join(', ')} · 항목 {preview.items.join(', ')}</div>
              <div>실적 합계 {num(preview.total)}건</div>
            </div>
          )}
          {parsed?.problems?.length > 0 && (
            <div className="mt-2"><Alert kind="warn">{parsed.problems.slice(0, 5).map((p) => <div key={p}>{p}</div>)}</Alert></div>
          )}
        </Card>

        <Button className="w-full py-3" icon={Calculator} loading={busy === 'calc'} disabled={!ready} onClick={calculate}>
          회비 산출
        </Button>
        {!ready && <p className="-mt-3 text-center text-xs text-slate-500">업무 선택, 총회비 입력, 실적 파일 업로드를 마치면 산출할 수 있습니다.</p>}
      </div>

      <div className="space-y-5">
        <Alert>{error}</Alert>
        {result ? (
          <Result result={result} work={work} onDownload={download} downloading={busy === 'xlsx'} onReset={() => setResult(null)} />
        ) : (
          <Card>
            <div className="grid place-items-center py-24 text-center text-slate-400">
              <Building2 className="h-10 w-10" />
              <p className="mt-3 text-sm">왼쪽에서 조건을 입력하고 <b className="text-navy-700">회비 산출</b>을 누르면<br />기관별 산출 내역이 여기에 나옵니다.</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function Result({ result, work, onDownload, downloading, onReset }) {
  const { period, rows, totals, components } = result;
  const showMetric = rows.some((r) => r.metric !== r.totalCount);
  const maxShare = Math.max(...rows.map((r) => r.share));
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="업무 · 기간" value={`${period.year}년 ${period.quarter}분기`} sub={work?.name} />
        <Stat label="분기 총회비" value={won(result.totalFee)} sub={`산출 합계 ${won(totals.fee)}`} />
        <Stat label="참가기관" value={`${rows.length}곳`} sub={`실적 합계 ${num(totals.totalCount)}건`} />
        <Stat label="적용 분담기준" value={`v${result.criteriaVersion}`} sub={components.map((c) => `${c.name} ${won(c.amount)}`).join(' · ')} />
      </div>
      <Alert kind="warn">{result.warnings.map((w) => <div key={w}>{w}</div>)}</Alert>
      <Card
        title="기관별 회비 산출내역"
        icon={FileSpreadsheet}
        right={(
          <div className="flex gap-2">
            <Button variant="secondary" icon={RotateCcw} onClick={onReset}>다시</Button>
            <Button variant="gold" icon={Download} loading={downloading} onClick={onDownload}>Excel 다운로드</Button>
          </div>
        )}
      >
        <div className="-m-5 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="th text-left">금융기관명</th>
                {period.months.map((m) => <th key={m} className="th text-right">{monthLabel(m)}</th>)}
                <th className="th text-right">분기 합계</th>
                {showMetric && <th className="th text-right">반영실적</th>}
                {components.map((c) => <th key={c.name} className="th text-right">{c.name}</th>)}
                <th className="th text-right">산출 회비</th>
                <th className="th w-40 text-left">분담 비율</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.institution} className="hover:bg-navy-50/50">
                  <td className="td font-semibold text-navy-900">{r.institution}</td>
                  {r.monthly.map((v, i) => <td key={i} className="td text-right text-slate-600">{num(v)}</td>)}
                  <td className="td text-right">{num(r.totalCount)}</td>
                  {showMetric && <td className="td text-right text-slate-600">{num(r.metric)}</td>}
                  {r.components.map((v, i) => <td key={i} className="td text-right text-slate-600">{num(v)}</td>)}
                  <td className="td text-right font-bold text-navy-900">{num(r.fee)}</td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-slate-100">
                        <div className="h-1.5 rounded-full bg-navy-600" style={{ width: `${(r.share / maxShare) * 100}%` }} />
                      </div>
                      <span className="w-14 text-right text-xs text-slate-600">{r.share.toFixed(2)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="bg-navy-50 font-bold text-navy-900">
                <td className="td">합계</td>
                {totals.monthly.map((v, i) => <td key={i} className="td text-right">{num(v)}</td>)}
                <td className="td text-right">{num(totals.totalCount)}</td>
                {showMetric && <td className="td text-right">{num(totals.metric)}</td>}
                {totals.components.map((v, i) => <td key={i} className="td text-right">{num(v)}</td>)}
                <td className="td text-right">{num(totals.fee)}</td>
                <td className="td text-xs">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
