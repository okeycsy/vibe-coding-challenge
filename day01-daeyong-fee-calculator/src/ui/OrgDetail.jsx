// 화면 6. 기관별 산출 근거. 엔진이 계산하면서 남긴 trace를 그대로 보여 준다(9장, 12-3 계산 투명성).
import { useEffect, useRef } from 'react';
import { QUARTER_METHODS } from '../engine/quarters.js';
import { EQUAL_METHODS, REMAINDER_MODES } from '../engine/fee.js';
import { ROUNDING, bpToPercent } from '../engine/money.js';
import { fmt, fmtWon, fmtSigned } from './common.jsx';

export default function OrgDetail({ business, run, orgId, onClose, onMove }) {
  const rows = run.fee.rows;
  const idx = rows.findIndex((r) => r.id === orgId);
  const r = rows[idx];
  const s = business.settings;
  const closeRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && rows[idx + 1]) onMove(rows[idx + 1].id);
      if (e.key === 'ArrowLeft' && rows[idx - 1]) onMove(rows[idx - 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, rows, onClose, onMove]);
  useEffect(() => closeRef.current?.focus(), []);

  if (!r) {
    return (
      <div className="modal-back" onClick={onClose}>
        <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <p>이 기관은 지금 분담 대상이 아닙니다.</p>
          <button type="button" className="btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    );
  }

  const meta = business.perfMeta;
  const options = [
    ['분기별 회비 배분', QUARTER_METHODS[s.quarterMethod]],
    ['균등 / 실적 비율', `${bpToPercent(s.equalRateBp)}% / ${bpToPercent(s.perfRateBp)}%`],
    ['균등회비 방식', EQUAL_METHODS[s.equal.method]],
    s.equal.method === 'A'
      ? ['균등회비 원 단위', `총액 ${ROUNDING[s.equal.poolRounding]}, 기관별 ${ROUNDING[s.equal.unitRounding]}, 차액 ${s.equal.targetMode === 'auto' ? '목록 순서 자동' : '담당자 지정'}`]
      : ['균등회비 금액', s.equal.bMode === 'manual' ? '담당자 직접 지정' : `${fmt(s.equal.bUnit)}원 단위 ${ROUNDING[s.equal.bRounding]}`],
    ['실적 인정 항목', run.fee.perf.recognizedNames],
    ['실적회비 잔액 배정', REMAINDER_MODES[s.perfRemainder.mode]],
    ['우체국 특수 처리', s.postOffice.enabled ? `${s.postOffice.direction === 'down' ? '내림' : '올림'}, 차액 반영 ${run.fee.postOffice.counterpartName ?? '-'}` : '사용 안 함'],
  ];

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="detail-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <p className="modal-kicker">{business.name} · {s.year}년 {s.quarter}분기</p>
            <h2 id="detail-title">{r.name} 산출 근거</h2>
          </div>
          <div className="modal-nav">
            <button type="button" className="btn small" disabled={idx === 0} onClick={() => onMove(rows[idx - 1].id)} aria-label="이전 기관">‹ 이전</button>
            <span className="muted">{idx + 1} / {rows.length}</span>
            <button type="button" className="btn small" disabled={idx === rows.length - 1} onClick={() => onMove(rows[idx + 1].id)} aria-label="다음 기관">다음 ›</button>
            <button ref={closeRef} type="button" className="btn small" onClick={onClose}>닫기</button>
          </div>
        </header>

        <div className="final-box">
          <div><span>균등회비</span><b>{fmtWon(r.equalFinal)}</b></div>
          <span className="op">+</span>
          <div><span>실적회비</span><b>{fmtWon(r.perfFinal)}</b></div>
          <span className="op">=</span>
          <div className="final"><span>최종 청구금액</span><b>{fmtWon(r.final)}</b></div>
        </div>

        <div className="modal-body">
          <TraceBlock title="① 균등회비 산출" lines={r.trace.equal} />
          <TraceBlock title="② 실적회비 산출" lines={r.trace.perf} />

          <section className="trace">
            <h3>③ 조정 내역</h3>
            {r.trace.adjust.length ? (
              <ul className="adjust-list">
                {r.trace.adjust.map((a, k) => (
                  <li key={k}>
                    <span className="tag">{a.kind}</span>
                    <b className={a.amount < 0 ? 'neg' : 'pos'}>{fmtSigned(a.amount)}원</b>
                    <span>{a.reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">조정 없음</p>
            )}
          </section>

          <section className="trace">
            <h3>④ 최종 청구금액</h3>
            <dl className="trace-lines">
              <div><dt>최종 균등회비</dt><dd>{fmtWon(r.equalFinal)}</dd></div>
              <div><dt>최종 실적회비</dt><dd>{fmtWon(r.perfFinal)}</dd></div>
              <div><dt>조정금액 합계 (위 금액에 포함)</dt><dd>{fmtSigned(r.adjustment)}원</dd></div>
              <div className="total"><dt>최종 청구금액</dt><dd>{fmtWon(r.final)}</dd></div>
            </dl>
          </section>

          <section className="trace">
            <h3>⑤ 원천 데이터</h3>
            <dl className="trace-lines">
              <div><dt>실적 파일</dt><dd>{meta ? `${meta.fileName}${meta.sample ? ' (예시)' : ''}` : '적용 안 함'}</dd></div>
              <div><dt>실적 기준기간</dt><dd>{meta ? `${meta.start || '-'} ~ ${meta.end || '-'}` : '-'}</dd></div>
              <div><dt>적용일</dt><dd>{meta ? `${meta.appliedAt}${meta.edited ? ` (수정 ${meta.edited})` : ''}` : '-'}</dd></div>
              {business.items.map((it) => (
                <div key={it.id}>
                  <dt>{it.name}{business.recognizedItemIds.includes(it.id) ? '' : ' (미인정)'}</dt>
                  <dd>{fmt(r.counts[it.id] ?? 0)}건</dd>
                </div>
              ))}
              {!r.hasData && <div><dt>비고</dt><dd>실적 데이터가 없어 0건으로 계산</dd></div>}
            </dl>
          </section>

          <section className="trace">
            <h3>⑥ 적용 옵션</h3>
            <dl className="trace-lines">
              {options.map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

function TraceBlock({ title, lines }) {
  return (
    <section className="trace">
      <h3>{title}</h3>
      <dl className="trace-lines">
        {lines.map((l, k) => (
          <div key={k} className={l.label.startsWith('최종') ? 'total' : ''}>
            <dt>{l.label}</dt>
            <dd>
              {l.value}
              {l.formula && <small className="formula">{l.formula}</small>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
