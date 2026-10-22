// 화면 2. 회비 산출 조건 설정
import { useState } from 'react';
import { QUARTER_METHODS } from '../engine/quarters.js';
import { EQUAL_METHODS } from '../engine/fee.js';
import { percentToBp, bpToPercent } from '../engine/money.js';
import { uid } from '../engine/model.js';
import { Section, Field, MoneyInput, Choice, Select, ROUNDING_OPTIONS, fmt, fmtWon, Issues, PendingBadge } from './common.jsx';

const SCREEN_NAMES = { conditions: '산출 조건', adjust: '금액 보정', data: '실적 데이터' };

export function PendingPanel({ run, business, confirm, goTo }) {
  if (!run.pending.length) return null;
  return (
    <div className="pending">
      <div className="pending-head">
        <PendingBadge text={`담당자 확인 필요 ${run.pending.length}건`} />
        <p>요구사항에 정해지지 않아 기본값으로 계산하고 있는 항목입니다. 값을 바꾸거나 맞으면 확인을 누르세요.</p>
      </div>
      <ul>
        {run.pending.map((d) => (
          <li key={d.key}>
            <span className="pending-label">{d.label}</span>
            <span className="pending-value">{d.value(business)}</span>
            <span className="pending-actions">
              {goTo && <button type="button" className="btn-link" onClick={() => goTo(d.screen)}>{SCREEN_NAMES[d.screen]}에서 바꾸기</button>}
              <button type="button" className="btn small" onClick={() => confirm(d.key)}>이 값으로 확인</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const isPending = (run, key) => run.pending.some((d) => d.key === key);

export default function ConditionsScreen({ business, run, update, setSettings, confirm, goTo }) {
  const s = business.settings;
  const sch = run.schedule;
  const fee = run.fee;
  const [eqText, setEqText] = useState(bpToPercent(s.equalRateBp));
  const [pfText, setPfText] = useState(bpToPercent(s.perfRateBp));
  const [newItem, setNewItem] = useState('');
  const setEqual = (patch, key) => setSettings({ equal: { ...s.equal, ...patch } }, key);
  const rateSum = s.equalRateBp + s.perfRateBp;

  const setRate = (which, text) => {
    const bp = percentToBp(text);
    if (which === 'equal') setEqText(text);
    else setPfText(text);
    if (Number.isNaN(bp) || bp > 10000) return;
    // 한쪽을 고치면 다른 쪽을 100%에서 뺀 값으로 맞춰 준다
    if (which === 'equal') {
      setPfText(bpToPercent(10000 - bp));
      setSettings({ equalRateBp: bp, perfRateBp: 10000 - bp });
    } else {
      setEqText(bpToPercent(10000 - bp));
      setSettings({ perfRateBp: bp, equalRateBp: 10000 - bp });
    }
  };

  const toggleItem = (id) =>
    update((b) => ({
      ...b,
      recognizedItemIds: b.recognizedItemIds.includes(id) ? b.recognizedItemIds.filter((x) => x !== id) : b.items.filter((i) => i.id === id || b.recognizedItemIds.includes(i.id)).map((i) => i.id),
    }));

  return (
    <div className="screen">
      <PendingPanel run={run} business={business} confirm={confirm} goTo={goTo} />

      <Section title="산출 대상">
        <div className="form-grid">
          <Field label="산출 연도" htmlFor="year">
            <input id="year" type="number" min="2000" max="2100" value={s.year} onChange={(e) => setSettings({ year: Number(e.target.value) || s.year })} />
          </Field>
          <Field label="산출 분기" htmlFor="quarter">
            <Select id="quarter" value={s.quarter} onChange={(v) => setSettings({ quarter: Number(v) })} options={[1, 2, 3, 4].map((q) => ({ value: q, label: `${q}분기` }))} />
          </Field>
        </div>
      </Section>

      <Section title="연간 회비와 분기별 배분" desc="1분기는 전기이월잉여금 확정 전에 당초 연간 회비 ÷ 4로 청구하고, 잉여금이 확정되면 남은 2~4분기에 반영합니다. 이미 청구한 1분기 금액은 바꾸지 않습니다.">
        <div className="form-grid">
          <Field label="A. 당초 연간 회비" htmlFor="annual">
            <MoneyInput id="annual" value={s.annualFee} onChange={(v) => setSettings({ annualFee: v })} />
          </Field>
          <Field label="B. 전기이월잉여금" htmlFor="surplus" hint={s.surplusConfirmed ? '결산 확정 금액으로 2~4분기에 반영합니다.' : '미확정이면 0원으로 계산하고 2~4분기는 잠정 금액입니다.'}>
            <MoneyInput id="surplus" value={s.surplus} onChange={(v) => setSettings({ surplus: v })} disabled={!s.surplusConfirmed} />
            <label className="check">
              <input type="checkbox" checked={s.surplusConfirmed} onChange={(e) => setSettings({ surplusConfirmed: e.target.checked })} />
              결산 완료, 잉여금 확정
            </label>
          </Field>
          <Field label="C. 1분기 기청구 회비" htmlFor="q1" pending={isPending(run, 'q1Source')} hint={s.q1Billed === null ? `자동: 당초 연간 회비 ÷ 4 = ${fmtWon(sch.q1Auto)}` : '실제로 청구한 금액입니다. 잉여금이 확정되어도 바뀌지 않습니다.'}>
            <Choice
              name="q1src"
              value={s.q1Billed === null ? 'auto' : 'manual'}
              onChange={(v) => setSettings({ q1Billed: v === 'auto' ? null : sch.q1Auto }, 'q1Source')}
              options={[{ value: 'auto', label: 'A ÷ 4 자동' }, { value: 'manual', label: '실제 청구액 입력' }]}
            />
            {s.q1Billed !== null && <MoneyInput id="q1" value={s.q1Billed} onChange={(v) => setSettings({ q1Billed: v }, 'q1Source')} />}
          </Field>
        </div>

        <Field label="분기별 회비 배분 방식" wide>
          <Choice
            name="qmethod"
            value={s.quarterMethod}
            onChange={(v) => setSettings({ quarterMethod: v })}
            options={[
              { value: 'A', label: QUARTER_METHODS.A, desc: '2분기 = D/2 − C, 3분기 = 4분기 = D/4' },
              { value: 'B', label: QUARTER_METHODS.B, desc: '2분기 = 3분기 = 4분기 = (D − C)/3' },
            ]}
          />
        </Field>

        <div className="schedule">
          <table className="grid">
            <thead>
              <tr>
                <th className="l">분기</th>
                <th>청구 대상 총액</th>
                <th className="l">계산식</th>
              </tr>
            </thead>
            <tbody>
              {sch.quarters.map((q) => (
                <tr key={q.quarter} className={q.quarter === s.quarter ? 'is-selected' : ''}>
                  <td className="l">
                    {q.quarter}분기 {q.quarter === 1 && <span className="tag">기청구</span>} {q.quarter === s.quarter && <span className="tag tag-accent">이번 산출</span>}
                  </td>
                  <td className="strong">{fmt(q.amount)}</td>
                  <td className="l formula">{q.formula}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="l">합계 (D = A − B = {fmt(sch.D)})</td>
                <td className="strong">{fmt(sch.sum)}</td>
                <td className="l">{sch.sum === sch.D ? '최종 연간 회비와 일치' : `차액 ${fmtWon(sch.D - sch.sum)}`}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="form-grid">
          <Field label="분기 금액 원 단위 처리" htmlFor="qround" pending={isPending(run, 'quarterRounding')} hint="D/4, (D − C)/3 등이 나누어떨어지지 않을 때">
            <Select id="qround" value={s.quarterRounding} onChange={(v) => setSettings({ quarterRounding: v }, 'quarterRounding')} options={ROUNDING_OPTIONS} />
          </Field>
          <Field label="차액을 반영할 분기" htmlFor="qdiff" pending={isPending(run, 'quarterDiff')} hint={sch.diff ? `지금 ${fmtWon(sch.diff)} 차액이 있습니다.` : '지금은 나누어떨어져 차액이 없습니다.'}>
            <Select
              id="qdiff"
              value={s.quarterDiffQuarter ?? ''}
              onChange={(v) => setSettings({ quarterDiffQuarter: v ? Number(v) : null }, 'quarterDiff')}
              options={[{ value: '', label: '선택 안 함' }, { value: 2, label: '2분기' }, { value: 3, label: '3분기' }, { value: 4, label: '4분기' }]}
            />
          </Field>
        </div>
        <Issues issues={sch.issues} />
      </Section>

      <Section title="균등회비와 실적회비 비율">
        <div className="form-grid">
          <Field label="균등회비 비율 (%)" htmlFor="eqrate">
            <input id="eqrate" type="text" inputMode="decimal" value={eqText} onChange={(e) => setRate('equal', e.target.value)} />
          </Field>
          <Field label="실적회비 비율 (%)" htmlFor="pfrate">
            <input id="pfrate" type="text" inputMode="decimal" value={pfText} onChange={(e) => setRate('perf', e.target.value)} />
          </Field>
          <Field label="합계">
            <p className={`rate-sum ${rateSum === 10000 ? 'ok' : 'bad'}`}>{bpToPercent(rateSum)}% {rateSum === 10000 ? '✓' : '(100%가 되어야 합니다)'}</p>
          </Field>
        </div>
      </Section>

      <Section title="균등회비 산출 방식">
        <Choice
          name="eqmethod"
          value={s.equal.method}
          onChange={(v) => setEqual({ method: v })}
          options={[
            { value: 'A', label: EQUAL_METHODS.A, desc: '균등회비 총액을 비율대로 정확히 맞추고, 나누어떨어지지 않는 원은 일부 기관에 1원씩 더하거나 뺍니다.' },
            { value: 'B', label: EQUAL_METHODS.B, desc: '모든 기관이 같은 금액을 내고, 실제 균등회비 비율이 설정 비율과 조금 달라지는 것을 허용합니다.' },
          ]}
        />
        {s.equal.method === 'A' && fee && (
          <div className="form-grid">
            <Field label="균등회비 총액의 원 미만 처리" htmlFor="eqpool" pending={isPending(run, 'equalPoolRounding')} hint={`${fmtWon(run.total)} × ${bpToPercent(s.equalRateBp)}% → ${fmtWon(fee.equal.pool)}`}>
              <Select id="eqpool" value={s.equal.poolRounding} onChange={(v) => setEqual({ poolRounding: v }, 'equalPoolRounding')} options={ROUNDING_OPTIONS} />
            </Field>
            <Field label="기관별 금액 조정">
              <p className="field-text">
                기관별 기본금액 {fmtWon(fee.equal.unit)}, 차액 {fmtWon(fee.equal.diff)}.{' '}
                <button type="button" className="btn-link" onClick={() => goTo('adjust')}>금액 보정 화면에서 조정</button>
              </p>
            </Field>
          </div>
        )}
        {s.equal.method === 'B' && fee && (
          <>
            <div className="form-grid">
              <Field label="기관별 동일 금액 정하기" pending={isPending(run, 'equalBRounding')}>
                <Choice
                  name="bmode"
                  value={s.equal.bMode}
                  onChange={(v) => setEqual({ bMode: v, bAmount: v === 'manual' ? fee.equal.unit : s.equal.bAmount }, 'equalBRounding')}
                  options={[{ value: 'auto', label: '자동 산출' }, { value: 'manual', label: '직접 지정' }]}
                />
              </Field>
              {s.equal.bMode === 'auto' ? (
                <>
                  <Field label="금액 단위" htmlFor="bunit">
                    <Select id="bunit" value={s.equal.bUnit} onChange={(v) => setEqual({ bUnit: Number(v) }, 'equalBRounding')} options={[1, 10, 100, 1000].map((u) => ({ value: u, label: `${fmt(u)}원 단위` }))} />
                  </Field>
                  <Field label="단위 미만 처리" htmlFor="bround">
                    <Select id="bround" value={s.equal.bRounding} onChange={(v) => setEqual({ bRounding: v }, 'equalBRounding')} options={ROUNDING_OPTIONS} />
                  </Field>
                </>
              ) : (
                <Field label="기관별 균등회비" htmlFor="bamount">
                  <MoneyInput id="bamount" value={s.equal.bAmount} onChange={(v) => setEqual({ bAmount: v }, 'equalBRounding')} />
                </Field>
              )}
            </div>
            <dl className="kv">
              <div><dt>기관별 균등회비</dt><dd>{fmtWon(fee.equal.unit)} × {fee.orgCount}개</dd></div>
              <div><dt>균등회비 총액</dt><dd>{fmtWon(fee.equal.pool)}</dd></div>
              <div><dt>실제 비율 / 설정 비율</dt><dd>{fee.equal.actualPercent} / {fee.equal.setPercent}</dd></div>
              <div><dt>차이</dt><dd>{fee.equal.gapPercent}</dd></div>
              <div><dt>실적회비 총액 (총액 − 균등회비 총액)</dt><dd>{fmtWon(fee.perf.pool)}</dd></div>
            </dl>
          </>
        )}
      </Section>

      <Section title="실적 인정 항목" desc="체크한 항목의 건수 합이 기관별 인정 실적입니다. 바꾸면 바로 다시 계산합니다.">
        <ul className="items">
          {business.items.map((it) => (
            <li key={it.id}>
              <label className="check">
                <input type="checkbox" checked={business.recognizedItemIds.includes(it.id)} onChange={() => toggleItem(it.id)} />
                <input
                  className="cell-input"
                  aria-label="실적 항목 이름"
                  value={it.name}
                  onChange={(e) => update((b) => ({ ...b, items: b.items.map((x) => (x.id === it.id ? { ...x, name: e.target.value } : x)) }))}
                />
              </label>
              <span className="muted">합계 {fmt(business.orgs.filter((o) => o.active).reduce((a, o) => a + (business.perf[o.id]?.[it.id] ?? 0), 0))}건</span>
              <RemoveItem onRemove={() => update((b) => ({ ...b, items: b.items.filter((x) => x.id !== it.id), recognizedItemIds: b.recognizedItemIds.filter((x) => x !== it.id) }))} />
            </li>
          ))}
        </ul>
        <form
          className="row-form"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newItem.trim();
            if (!name) return;
            const id = uid('item');
            update((b) => ({ ...b, items: [...b.items, { id, name }], recognizedItemIds: [...b.recognizedItemIds, id] }));
            setNewItem('');
          }}
        >
          <label htmlFor="new-item">실적 항목 추가</label>
          <input id="new-item" type="text" placeholder="예: API 호출건수" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
          <button type="submit" className="btn">추가</button>
        </form>
        <p className="field-hint">현재 인정 실적: {run.fee?.perf.recognizedNames || '없음'} · 전체 {fmt(run.fee?.perf.totalRecognized ?? 0)}건</p>
      </Section>
    </div>
  );
}

function RemoveItem({ onRemove }) {
  const [ask, setAsk] = useState(false);
  return ask ? (
    <span className="confirm-inline">
      항목과 건수를 지울까요?
      <button type="button" className="btn small danger" onClick={onRemove}>지우기</button>
      <button type="button" className="btn small" onClick={() => setAsk(false)}>취소</button>
    </span>
  ) : (
    <button type="button" className="btn-link danger" onClick={() => setAsk(true)}>삭제</button>
  );
}
