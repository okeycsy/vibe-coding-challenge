// 화면 5. 산출 결과: 기관별 회비 표, 합계, 검증 결과, 엑셀 다운로드
import { useState } from 'react';
import { STATUS_LABEL } from '../engine/pipeline.js';
import { buildResultWorkbook, workbookBytes, saveFile } from '../excel.js';
import { Section, StatusBadge, Issues, fmt, fmtWon, fmtSigned } from './common.jsx';
import { PendingPanel } from './ConditionsScreen.jsx';

export default function ResultScreen({ business, run, confirm, openDetail, goTo }) {
  const fee = run.fee;
  const s = business.settings;
  const [msg, setMsg] = useState('');

  const download = async () => {
    setMsg('');
    try {
      const name = `회비산출_${business.name}_${s.year}년${s.quarter}분기.xlsx`.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
      await saveFile(name, workbookBytes(buildResultWorkbook(business, run)), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      setMsg(`${name}을(를) 저장했습니다.`);
    } catch (err) {
      if (err?.code !== 'declined') setMsg(`엑셀을 저장하지 못했습니다. ${err?.message ?? ''}`);
    }
  };

  return (
    <div className="screen">
      <Section
        title={`${s.year}년 ${s.quarter}분기 기관별 회비`}
        desc={fee ? `분기 청구 대상 총액 ${fmtWon(run.total)} · 균등회비 ${fee.equal.ratePercent}% ${fmtWon(fee.equal.pool)} · 실적회비 ${fmtWon(fee.perf.pool)} · 인정 실적 ${fee.perf.recognizedNames || '없음'}. 기관명을 누르면 산출 근거가 열립니다.` : ''}
        actions={
          <>
            <StatusBadge status={run.status} text={`검증 ${STATUS_LABEL[run.status]}`} />
            <button type="button" className="btn-primary" onClick={download} disabled={!fee}>결과 엑셀 다운로드</button>
          </>
        }
      >
        {msg && <p className="note">{msg}</p>}
        {fee ? (
          <div className="table-scroll">
            <table className="grid result">
              <thead>
                <tr>
                  <th className="c">순번</th>
                  <th className="l">기관명</th>
                  <th>인정 실적</th>
                  <th>실적 점유율</th>
                  <th>균등회비</th>
                  <th>실적회비</th>
                  <th>조정금액</th>
                  <th>최종 회비</th>
                </tr>
              </thead>
              <tbody>
                {fee.rows.map((r, i) => (
                  <tr key={r.id}>
                    <td className="c muted">{i + 1}</td>
                    <td className="l">
                      <button type="button" className="btn-link org-link" onClick={() => openDetail(r.id)}>{r.name}</button>
                      {!r.hasData && <span className="tag tag-warn">실적 없음</span>}
                    </td>
                    <td>{fmt(r.recognized)}</td>
                    <td>{r.sharePercent}</td>
                    <td>{fmt(r.equalFinal)}</td>
                    <td>{fmt(r.perfFinal)}</td>
                    <td className={r.adjustment ? 'accent' : 'muted'} title={r.trace.adjust.map((a) => `${a.kind} ${fmtSigned(a.amount)}: ${a.reason}`).join('\n')}>
                      {r.adjustment || r.trace.adjust.length ? fmtSigned(r.adjustment) : '-'}
                    </td>
                    <td className="strong">{fmt(r.final)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td className="l">합계 ({fee.orgCount}개 기관)</td>
                  <td>{fmt(fee.perf.totalRecognized)}</td>
                  <td>100%</td>
                  <td>{fmt(fee.totals.equal)}</td>
                  <td>{fmt(fee.totals.perf)}</td>
                  <td>{fmtSigned(fee.totals.adjustment)}</td>
                  <td className="strong">{fmt(fee.totals.final)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <Issues issues={run.issues} />
        )}
        <p className="field-hint">조정금액은 원 단위 조정, 잔액 배정, 우체국 보정을 합한 금액이며 균등회비·실적회비에 이미 들어 있습니다. 최종 회비 = 균등회비 + 실적회비.</p>
      </Section>

      <Section title="검증 결과" desc="설정을 바꾸거나 금액을 보정할 때마다 다시 검증합니다.">
        <div className="table-scroll">
          <table className="grid checks">
            <thead>
              <tr>
                <th className="l">검증 항목</th>
                <th className="c">결과</th>
                <th>기대 금액</th>
                <th>실제 금액</th>
                <th>차이</th>
                <th className="l">원인 / 보정 대상</th>
              </tr>
            </thead>
            <tbody>
              {run.checks.map((c) => (
                <tr key={c.id} className={c.status === 'fail' ? 'is-bad' : c.status === 'warn' ? 'is-warn' : ''}>
                  <td className="l">{c.label}</td>
                  <td className="c"><StatusBadge status={c.status} /></td>
                  <td>{showValue(c, c.expected)}</td>
                  <td>{showValue(c, c.actual)}</td>
                  <td>{c.unit === 'bp' ? `${fmtSigned(c.diff / 100)}%p` : c.unit === 'count' ? (c.diff ? `${fmtSigned(c.diff)}개` : '0') : fmtSigned(c.diff)}</td>
                  <td className="l">
                    {c.cause}
                    {c.targets && <span className="muted">{c.cause ? ' · ' : ''}대상: {c.targets}</span>}
                    {!c.cause && !c.targets && <span className="muted">-</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Issues issues={run.issues} />
      </Section>

      <PendingPanel run={run} business={business} confirm={confirm} goTo={goTo} />

      <Section title="분기별 회비" desc={`최종 연간 회비 D = ${fmtWon(run.schedule.D)}${s.surplusConfirmed ? '' : ' (잉여금 미확정, 잠정)'}`}>
        <div className="quarter-strip">
          {run.schedule.quarters.map((q) => (
            <div key={q.quarter} className={`q-card ${q.quarter === s.quarter ? 'is-on' : ''}`}>
              <span>{q.quarter}분기{q.quarter === 1 ? ' · 기청구' : ''}</span>
              <b>{fmtWon(q.amount)}</b>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function showValue(c, v) {
  if (c.unit === 'bp') return `${v / 100}%`;
  if (c.unit === 'count') return `${fmt(v)}개`;
  return fmt(v);
}
