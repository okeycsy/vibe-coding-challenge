import { useMemo, useRef, useState } from 'react';
import { calculateFees, EQUAL_RATIO } from './feeCalc.js';
import { parseRows, parseWorkbook, buildResultWorkbook, buildSampleWorkbook, saveWorkbook } from './excel.js';
import { groupByQuarter } from './period.js';
import { SAMPLE_FILENAME, SAMPLE_QUARTER_FEE, sampleSheetRows } from './sampleData.js';

const won = (n) => n.toLocaleString('ko-KR');
const pct = (x, d = 2) => (x * 100).toFixed(d);
const digitsOf = (v) => Number(String(v).replace(/[^\d]/g, '').slice(0, 15)) || 0;

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
  const [quarterFee, setQuarterFee] = useState(SAMPLE_QUARTER_FEE);
  const [overrides, setOverrides] = useState({}); // 분기별로 따로 정한 회비 총액
  const [source, setSource] = useState(sample); // { records, warnings, fileName, isSample }
  const [selectedKey, setSelectedKey] = useState(null);
  const [fileError, setFileError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const fileInput = useRef(null);

  const groups = useMemo(() => groupByQuarter(source.records), [source]);

  const quarters = useMemo(
    () =>
      groups.map((g) => {
        const fee = overrides[g.key] ?? quarterFee;
        try {
          return { ...g, fee, result: fee ? calculateFees(fee, g.orgs) : null, error: fee ? '' : '회비 총액이 없습니다.' };
        } catch (err) {
          return { ...g, fee, result: null, error: err.message };
        }
      }),
    [groups, overrides, quarterFee],
  );

  const selected = quarters.find((q) => q.key === selectedKey) ?? quarters.at(-1);
  const selectedIdx = quarters.indexOf(selected);
  const ready = quarters.filter((q) => q.result);
  const totalFees = ready.reduce((a, q) => a + q.result.totalFee, 0);
  const orgNames = new Set(source.records.map((r) => r.name));
  const mergedRows = source.records.length - groups.reduce((a, g) => a + g.orgs.length, 0);
  const maxCount = Math.max(1, ...quarters.map((q) => q.orgs.reduce((a, o) => a + o.seizure + o.collection + o.release, 0)));
  const isQuarterly = groups.length > 1 || groups[0]?.key !== 'ALL';

  const loadFile = async (f) => {
    if (!f) return;
    setFileError('');
    setSaveMsg('');
    try {
      const parsed = parseWorkbook(await f.arrayBuffer());
      setSource({ ...parsed, fileName: f.name, isSample: false });
      setOverrides({});
      setSelectedKey(null);
    } catch (err) {
      setFileError(`${f.name}을(를) 읽지 못했습니다. ${err.message}`);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    loadFile(e.dataTransfer.files?.[0]);
  };

  const setOverride = (key, value) =>
    setOverrides((o) => {
      const amount = digitsOf(value);
      const next = { ...o };
      if (amount === quarterFee) delete next[key];
      else next[key] = amount;
      return next;
    });

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

  const onDownloadAll = () =>
    save(
      buildResultWorkbook(
        ready.map((q) => ({ label: q.label, result: q.result })),
        { sourceName: source.fileName },
      ),
      `회비산출결과_${isQuarterly ? `${ready[0].label}~${ready.at(-1).label}`.replace(/\s/g, '') : today()}.xlsx`,
    );
  const onDownloadSample = () => save(buildSampleWorkbook(), '회비산출_입력양식_예시.xlsx');

  const warnings = [...source.warnings, ...quarters.flatMap((q) => q.result?.warnings.map((w) => `${q.label}: ${w}`) ?? [])];
  const errors = quarters.filter((q) => q.error).map((q) => `${q.label}: ${q.error}`);
  const ratioPct = Math.round(EQUAL_RATIO * 100);

  return (
    <div className="app">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <div className="brand">
            <span className="mark" aria-hidden="true">₩</span>
            <div>
              <h1>금융정보업무 회비 산출</h1>
              <p>3개월(분기)마다 기관별 압류·추심·해제 건수로 회비를 안분합니다</p>
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
              <label htmlFor="total-fee">분기 회비 총액</label>
            </div>
            <div className="amount">
              <input
                id="total-fee"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                value={quarterFee ? won(quarterFee) : ''}
                onChange={(e) => setQuarterFee(digitsOf(e.target.value))}
              />
              <span className="unit">원</span>
            </div>
            <p className="amount-read">
              {quarterFee ? `${koreanAmount(quarterFee)} · 3개월마다` : '한 분기(3개월)에 걷을 회비 총액을 입력하세요'}
            </p>
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
                <strong>{source.fileName}</strong>
                <span>
                  {source.records.length.toLocaleString('ko-KR')}행 · {orgNames.size}개 기관 · {source.isSample ? '예시 데이터' : '업로드한 파일'}
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
              기준년월(또는 일자·분기) 열과 기관명·압류·추심·해제 열이 있으면 됩니다.{' '}
              <button type="button" className="link" onClick={onDownloadSample}>
                입력 양식 내려받기
              </button>
            </p>
          </div>
        </section>

        {source.isSample && (
          <p className="notice">
            지금은 가상의 기관 8곳, 2024년 1월부터 2026년 12월까지 3년치 <b>예시 데이터</b>를 보여 주고 있습니다. 엑셀을 첨부하면 그 파일로 다시 계산합니다.
          </p>
        )}
        {fileError && <p className="alert alert-error">{fileError}</p>}
        {errors.length > 0 && (
          <ul className="alert alert-error">
            {errors.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {warnings.length > 0 && (
          <details className="alert alert-warn">
            <summary>확인할 내용 {warnings.length}건</summary>
            <ul>
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        )}

        <section className="summary" aria-label="전체 요약">
          <div className="stat stat-main">
            <span>산출 기간</span>
            <b>{isQuarterly ? `${quarters.length}개 분기` : '전체 1회'}</b>
            <small>{isQuarterly ? `${quarters[0].label} ~ ${quarters.at(-1).label}` : '파일에 기간 열이 없음'}</small>
          </div>
          <div className="stat">
            <span>회비 총액 합계</span>
            <b>{won(totalFees)}원</b>
            <small>{koreanAmount(totalFees) || '-'}</small>
          </div>
          <div className="stat">
            <span>대상 기관</span>
            <b>{orgNames.size}개 기관</b>
            <small>같은 기관명은 한 기관으로 합산</small>
          </div>
          <div className="stat">
            <span>읽은 행</span>
            <b>{won(source.records.length)}행</b>
            <small>{mergedRows > 0 ? `분기 안 중복 ${won(mergedRows)}행 합산` : '중복 기관명 없음'}</small>
          </div>
        </section>

        <section className="panel" aria-label="분기별 산출 현황">
          <div className="section-head">
            <h2>{isQuarterly ? '분기별 산출 현황' : '산출 현황'}</h2>
            <button type="button" className="btn-primary" onClick={onDownloadAll} disabled={ready.length === 0}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
              </svg>
              {isQuarterly ? '전체 분기 결과 엑셀 내려받기' : '결과 엑셀 내려받기'}
            </button>
          </div>
          {saveMsg && <p className="save-msg">{saveMsg}</p>}
          <div className="table-scroll">
            <table className="quarter-table">
              <thead>
                <tr>
                  <th className="col-name">분기</th>
                  <th>기관 수</th>
                  <th>압류+추심+해제 건수</th>
                  <th>회비 총액 (원)</th>
                  <th>최대 분담 기관</th>
                  <th aria-label="선택" />
                </tr>
              </thead>
              <tbody>
                {quarters.map((q) => {
                  const count = q.orgs.reduce((a, o) => a + o.seizure + o.collection + o.release, 0);
                  const top = q.result ? [...q.result.rows].sort((a, b) => b.fee - a.fee)[0] : null;
                  const isSel = q === selected;
                  return (
                    <tr key={q.key} className={isSel ? 'is-selected' : ''} onClick={() => setSelectedKey(q.key)}>
                      <td className="col-name">
                        <button type="button" className="row-btn" onClick={() => setSelectedKey(q.key)} aria-pressed={isSel}>
                          {q.label}
                        </button>
                      </td>
                      <td>{q.orgs.length}</td>
                      <td>
                        <span className="trend-cell">
                          <span className="trend">
                            <span className="trend-bar" style={{ width: `${(count / maxCount) * 100}%` }} />
                          </span>
                          {won(count)}
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          className={`fee-cell ${overrides[q.key] !== undefined ? 'is-custom' : ''}`}
                          id={`fee-${q.key}`}
                          type="text"
                          inputMode="numeric"
                          aria-label={`${q.label} 회비 총액`}
                          value={q.fee ? won(q.fee) : ''}
                          onChange={(e) => setOverride(q.key, e.target.value)}
                        />
                      </td>
                      <td className="col-top">{top ? `${top.name} ${won(top.fee)}` : q.error}</td>
                      <td className="col-go">{isSel ? '보는 중' : '보기 ›'}</td>
                    </tr>
                  );
                })}
              </tbody>
              {isQuarterly && (
                <tfoot>
                  <tr>
                    <td className="col-name">합계</td>
                    <td />
                    <td>{won(quarters.reduce((a, q) => a + (q.result?.totalCount ?? 0), 0))}</td>
                    <td>{won(totalFees)}</td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="table-note">회비 총액 칸을 고치면 그 분기만 따로 바뀝니다. 굵게 표시된 금액이 따로 정한 분기입니다.</p>
        </section>

        {selected?.result && (
          <QuarterDetail
            key={selected.key}
            quarter={selected}
            ratioPct={ratioPct}
            onPrev={selectedIdx > 0 ? () => setSelectedKey(quarters[selectedIdx - 1].key) : null}
            onNext={selectedIdx < quarters.length - 1 ? () => setSelectedKey(quarters[selectedIdx + 1].key) : null}
          />
        )}

        <section className="method" aria-label="산출 방법">
          <h2>산출 방법</h2>
          <dl>
            <div>
              <dt>분기</dt>
              <dd>1~3월 1분기, 4~6월 2분기, 7~9월 3분기, 10~12월 4분기. 분기마다 따로 산출합니다.</dd>
            </div>
            <div>
              <dt>같은 기관</dt>
              <dd>같은 분기 안에서 기관명이 같은 행은 건수를 더해 한 기관으로 계산합니다.</dd>
            </div>
            <div>
              <dt>균등분</dt>
              <dd>분기 회비 총액 × {ratioPct}% ÷ 그 분기 데이터에 있는 기관 수</dd>
            </div>
            <div>
              <dt>건수비례분</dt>
              <dd>분기 회비 총액 × {100 - ratioPct}% × (기관 압류+추심+해제 ÷ 그 분기 전체 건수)</dd>
            </div>
            <div>
              <dt>원 단위</dt>
              <dd>원 미만은 버리고, 남는 원은 버린 소수점이 큰 기관부터 1원씩 배정해 합계를 총액에 맞춥니다.</dd>
            </div>
          </dl>
        </section>
      </main>
    </div>
  );
}

function QuarterDetail({ quarter, ratioPct, onPrev, onNext }) {
  const { result } = quarter;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'index', dir: 1 });

  const rows = useMemo(() => {
    const q = query.trim();
    const list = result.rows.map((r, i) => ({ ...r, index: i + 1 })).filter((r) => !q || r.name.includes(q));
    const { key, dir } = sort;
    return list.sort((a, b) => (key === 'name' ? a.name.localeCompare(b.name, 'ko') : a[key] - b[key]) * dir);
  }, [result, query, sort]);

  const chartRows = [...result.rows].sort((a, b) => b.fee - a.fee);
  const maxFee = chartRows[0]?.fee || 1;
  const verified = result.rows.reduce((a, r) => a + r.fee, 0) === result.totalFee;
  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'name' || key === 'index' ? 1 : -1 }));

  return (
    <section className="detail" aria-label={`${quarter.label} 산출 결과`}>
      <div className="detail-head">
        <button type="button" className="nav-btn" onClick={onPrev} disabled={!onPrev} aria-label="이전 분기">
          ‹
        </button>
        <h2>{quarter.label} 회비</h2>
        <button type="button" className="nav-btn" onClick={onNext} disabled={!onNext} aria-label="다음 분기">
          ›
        </button>
        <span className={`verify ${verified ? 'ok' : 'bad'}`}>{verified ? '✓ 기관별 합계와 총액 일치' : '! 기관별 합계 불일치'}</span>
      </div>

      <div className="summary">
        <div className="stat">
          <span>분기 회비 총액</span>
          <b>{won(result.totalFee)}원</b>
          <small>{koreanAmount(result.totalFee)}</small>
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
          <span>기관 · 건수</span>
          <b>{result.rows.length}개 기관</b>
          <small>{won(result.totalCount)}건 (압류+추심+해제)</small>
        </div>
      </div>

      <div className="panel chart">
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
      </div>

      <div className="panel table-panel">
        <div className="section-head">
          <h2>기관별 산출 결과</h2>
          <div className="table-tools">
            <input id="org-search" type="search" placeholder="기관명 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
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
      </div>
    </section>
  );
}
