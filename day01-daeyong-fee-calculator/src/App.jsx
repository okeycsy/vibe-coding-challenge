import { useMemo, useRef, useState } from 'react';
import { calculateFees, EQUAL_RATIO } from './feeCalc.js';
import { parseRows, parseWorkbook, buildResultWorkbook, buildSampleWorkbook, saveWorkbook } from './excel.js';
import { SAMPLE_FILENAME, SAMPLE_TOTAL_FEE, sampleSheetRows } from './sampleData.js';

const won = (n) => n.toLocaleString('ko-KR');
const pct = (x, d = 2) => (x * 100).toFixed(d);

// 123456789 → "1억 2,345만 6,789원"
function koreanAmount(n) {
  if (!n) return '';
  const eok = Math.floor(n / 1e8);
  const man = Math.floor((n % 1e8) / 1e4);
  const rest = n % 1e4;
  const parts = [];
  if (eok) parts.push(`${won(eok)}억`);
  if (man) parts.push(`${won(man)}만`);
  if (rest) parts.push(won(rest));
  return `${parts.join(' ')}원`;
}

const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

const COLUMNS = [
  { key: 'index', label: '순번', sortable: false },
  { key: 'name', label: '기관명' },
  { key: 'seizure', label: '압류' },
  { key: 'collection', label: '추심' },
  { key: 'release', label: '해제' },
  { key: 'count', label: '합계건수' },
  { key: 'ratio', label: '건수비율' },
  { key: 'equalShare', label: '균등분담액' },
  { key: 'ratioShare', label: '건수비례분담액' },
  { key: 'fee', label: '회비' },
];

const sample = { ...parseRows(sampleSheetRows()), fileName: SAMPLE_FILENAME, isSample: true };

export default function App() {
  const [fee, setFee] = useState(SAMPLE_TOTAL_FEE);
  const [source, setSource] = useState(sample); // { orgs, warnings, fileName, isSample }
  const [fileError, setFileError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'index', dir: 1 });
  const [saveMsg, setSaveMsg] = useState('');
  const fileInput = useRef(null);

  const { result, calcError } = useMemo(() => {
    if (!source || !fee) return { result: null, calcError: '' };
    try {
      return { result: calculateFees(fee, source.orgs), calcError: '' };
    } catch (err) {
      return { result: null, calcError: err.message };
    }
  }, [fee, source]);

  const rows = useMemo(() => {
    if (!result) return [];
    const q = query.trim();
    const list = result.rows
      .map((r, i) => ({ ...r, index: i + 1 }))
      .filter((r) => !q || r.name.includes(q));
    const { key, dir } = sort;
    return list.sort((a, b) => (key === 'name' ? a.name.localeCompare(b.name, 'ko') : a[key] - b[key]) * dir);
  }, [result, query, sort]);

  const chartRows = useMemo(() => (result ? [...result.rows].sort((a, b) => b.fee - a.fee) : []), [result]);
  const maxFee = chartRows[0]?.fee || 1;
  const verified = result && result.rows.reduce((a, r) => a + r.fee, 0) === result.totalFee;

  const onFeeChange = (e) => {
    const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 15);
    setFee(Number(digits) || 0);
  };

  const loadFile = async (f) => {
    if (!f) return;
    setFileError('');
    setSaveMsg('');
    try {
      const parsed = parseWorkbook(await f.arrayBuffer());
      setSource({ ...parsed, fileName: f.name, isSample: false });
      setQuery('');
      setSort({ key: 'index', dir: 1 });
    } catch (err) {
      setFileError(`${f.name}을(를) 읽지 못했습니다. ${err.message}`);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    loadFile(e.dataTransfer.files?.[0]);
  };

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'name' || key === 'index' ? 1 : -1 }));

  const save = async (wb, filename) => {
    setSaveMsg('');
    try {
      await saveWorkbook(wb, filename);
      setSaveMsg(`${filename} 파일을 내려받았습니다.`);
    } catch (err) {
      if (err?.code === 'declined') return;
      setSaveMsg(`파일을 저장하지 못했습니다. ${err?.message ?? ''}`);
    }
  };

  const onDownloadResult = () =>
    save(buildResultWorkbook(result, { sourceName: source.fileName }), `회비산출결과_${today()}.xlsx`);
  const onDownloadSample = () => save(buildSampleWorkbook(), '회비산출_입력양식_예시.xlsx');

  const warnings = [...(source?.warnings ?? []), ...(result?.warnings ?? [])];
  const ratioPct = Math.round(EQUAL_RATIO * 100);

  return (
    <div className="app">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <div className="brand">
            <span className="mark" aria-hidden="true">₩</span>
            <div>
              <h1>금융정보업무 회비 산출</h1>
              <p>기관별 압류·추심·해제 건수로 연간 회비를 안분합니다</p>
            </div>
          </div>
          <div className="rule-chips" aria-label="안분 기준">
            <span className="chip">균등 {ratioPct}%</span>
            <span className="chip chip-accent">건수비례 {100 - ratioPct}%</span>
          </div>
        </div>
      </header>

      <main className="wrap main">
        <section className="panel inputs" aria-label="산출 입력">
          <div className="step">
            <div className="step-head">
              <span className="step-no">1</span>
              <label htmlFor="total-fee">회비 총액</label>
            </div>
            <div className="amount">
              <input
                id="total-fee"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                value={fee ? won(fee) : ''}
                onChange={onFeeChange}
              />
              <span className="unit">원</span>
            </div>
            <p className="amount-read">{fee ? koreanAmount(fee) : '회비 총액을 원 단위로 입력하세요'}</p>
          </div>

          <div className="step">
            <div className="step-head">
              <span className="step-no">2</span>
              <span>건수 엑셀 첨부</span>
            </div>
            <div
              className={`drop ${dragging ? 'is-over' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <svg className="drop-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <path d="M14 3v5h5M9 13l2 2 4-4" />
              </svg>
              <div className="drop-text">
                <strong>{source?.fileName ?? '파일을 끌어다 놓거나 눌러서 선택'}</strong>
                <span>
                  {source
                    ? `${source.orgs.length}개 기관 · ${source.isSample ? '예시 데이터' : '업로드한 파일'}`
                    : '.xlsx · .xls · .csv'}
                </span>
              </div>
              <span className="drop-action">파일 선택</span>
              <input
                ref={fileInput}
                id="fee-file"
                type="file"
                accept=".xlsx,.xls,.csv"
                hidden
                onChange={(e) => {
                  loadFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
            <p className="drop-help">
              첫 시트에 기관명·압류·추심·해제 열이 있으면 됩니다.{' '}
              <button type="button" className="link" onClick={onDownloadSample}>
                입력 양식 내려받기
              </button>
            </p>
          </div>
        </section>

        {source?.isSample && (
          <p className="notice">
            지금은 가상의 기관 8곳으로 만든 <b>예시 데이터</b>를 보여 주고 있습니다. 엑셀을 첨부하면 그 파일로 다시 계산합니다.
          </p>
        )}
        {fileError && <p className="alert alert-error">{fileError}</p>}
        {calcError && <p className="alert alert-error">{calcError}</p>}
        {warnings.length > 0 && (
          <ul className="alert alert-warn">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        {result && (
          <>
            <section className="summary" aria-label="산출 요약">
              <div className="stat stat-main">
                <span>회비 총액</span>
                <b>{won(result.totalFee)}원</b>
                <small className={verified ? 'ok' : 'bad'}>
                  {verified ? '기관별 합계와 일치' : '기관별 합계 불일치'}
                </small>
              </div>
              <div className="stat">
                <span>균등분 {ratioPct}%</span>
                <b>{won(result.equalPool)}원</b>
                <small>기관당 약 {won(Math.round(result.equalPool / result.rows.length))}원</small>
              </div>
              <div className="stat">
                <span>건수비례분 {100 - ratioPct}%</span>
                <b>{won(result.ratioPool)}원</b>
                <small>건당 약 {result.totalCount ? won(Math.round(result.ratioPool / result.totalCount)) : 0}원</small>
              </div>
              <div className="stat">
                <span>대상 기관 · 전체 건수</span>
                <b>{result.rows.length}개 기관</b>
                <small>{won(result.totalCount)}건 (압류+추심+해제)</small>
              </div>
            </section>

            <section className="panel chart" aria-label="기관별 회비 구성">
              <div className="section-head">
                <h2>기관별 회비 구성</h2>
                <div className="legend">
                  <span><i className="sw sw-equal" />균등분</span>
                  <span><i className="sw sw-ratio" />건수비례분</span>
                </div>
              </div>
              <ol className="bars">
                {chartRows.map((r) => (
                  <li key={r.name}>
                    <span className="bar-name">{r.name}</span>
                    <span className="bar-track">
                      <span className="bar-seg seg-equal" style={{ width: `${(r.equalShare / maxFee) * 100}%` }} />
                      <span className="bar-seg seg-ratio" style={{ width: `${(r.ratioShare / maxFee) * 100}%` }} />
                    </span>
                    <span className="bar-val">
                      {won(r.fee)}
                      <em>{pct(r.fee / result.totalFee, 1)}%</em>
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="panel table-panel" aria-label="기관별 산출 결과">
              <div className="section-head">
                <h2>기관별 산출 결과</h2>
                <div className="table-tools">
                  <input
                    id="org-search"
                    type="search"
                    placeholder="기관명 검색"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button type="button" className="btn-primary" onClick={onDownloadResult}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
                    </svg>
                    결과 엑셀 내려받기
                  </button>
                </div>
              </div>
              {saveMsg && <p className="save-msg">{saveMsg}</p>}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {COLUMNS.map((c) => (
                        <th key={c.key} className={`col-${c.key}`} aria-sort={sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
                          {c.sortable === false ? (
                            c.label
                          ) : (
                            <button type="button" onClick={() => toggleSort(c.key)}>
                              {c.label}
                              <span className="sort">{sort.key === c.key ? (sort.dir > 0 ? '▲' : '▼') : ''}</span>
                            </button>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.name}-${r.index}`}>
                        <td className="col-index">{r.index}</td>
                        <td className="col-name">{r.name}</td>
                        <td>{won(r.seizure)}</td>
                        <td>{won(r.collection)}</td>
                        <td>{won(r.release)}</td>
                        <td>{won(r.count)}</td>
                        <td>{pct(r.ratio)}%</td>
                        <td>{won(r.equalShare)}</td>
                        <td>{won(r.ratioShare)}</td>
                        <td className="col-fee">{won(r.fee)}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={COLUMNS.length} className="empty">
                          '{query}'에 해당하는 기관이 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>합계</td>
                      <td>{won(result.totals.seizure)}</td>
                      <td>{won(result.totals.collection)}</td>
                      <td>{won(result.totals.release)}</td>
                      <td>{won(result.totals.count)}</td>
                      <td>100.00%</td>
                      <td>{won(result.totals.equalShare)}</td>
                      <td>{won(result.totals.ratioShare)}</td>
                      <td className="col-fee">{won(result.totals.fee)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            <section className="method" aria-label="산출 방법">
              <h2>산출 방법</h2>
              <dl>
                <div>
                  <dt>균등분</dt>
                  <dd>회비 총액 × {ratioPct}% ÷ 기관 수</dd>
                </div>
                <div>
                  <dt>건수비례분</dt>
                  <dd>회비 총액 × {100 - ratioPct}% × (기관 압류+추심+해제 ÷ 전체 건수)</dd>
                </div>
                <div>
                  <dt>원 단위</dt>
                  <dd>원 미만은 버리고, 남는 원은 버린 소수점이 큰 기관부터 1원씩 배정해 합계를 총액에 맞춥니다.</dd>
                </div>
              </dl>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
