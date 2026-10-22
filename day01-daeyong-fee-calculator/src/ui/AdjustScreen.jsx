// 화면 4. 금액 보정: 균등회비 원 단위 조정, 실적회비 원 단위 잔액, 우체국 특수 처리
// 담당자가 바꾸면 App이 다시 계산하고, 아래 검증 표가 바로 갱신된다(12-6 수동 보정 후 자동 검증).
import { REMAINDER_MODES } from '../engine/fee.js';
import { postOfficeOrgId } from '../engine/model.js';
import { Section, Field, Choice, Select, ROUNDING_OPTIONS, fmt, fmtWon, fmtSigned, StatusBadge, Issues } from './common.jsx';

const isPending = (run, key) => run.pending.some((d) => d.key === key);

export default function AdjustScreen({ business, run, setSettings, confirm, openDetail }) {
  const s = business.settings;
  const fee = run.fee;
  if (!fee) {
    return (
      <div className="screen">
        <Issues issues={run.issues} />
      </div>
    );
  }
  const rows = fee.rows;
  const setEqual = (patch, key) => setSettings({ equal: { ...s.equal, ...patch } }, key);
  const setRemainder = (patch, key) => setSettings({ perfRemainder: { ...s.perfRemainder, ...patch } }, key);
  const setPO = (patch, key) => setSettings({ postOffice: { ...s.postOffice, ...patch } }, key);
  const checkFor = (...ids) => run.checks.filter((c) => ids.includes(c.id));

  return (
    <div className="screen">
      <EqualAdjust business={business} run={run} fee={fee} setEqual={setEqual} confirm={confirm} openDetail={openDetail} checks={checkFor('equalPool', 'equalSame')} />
      <RemainderAdjust business={business} run={run} fee={fee} setRemainder={setRemainder} confirm={confirm} />
      <PostOffice business={business} run={run} fee={fee} setPO={setPO} confirm={confirm} openDetail={openDetail} checks={checkFor('poTotal', 'poUnit')} rows={rows} />
    </div>
  );
}

function ConfirmButton({ run, k, confirm }) {
  if (!isPending(run, k)) return null;
  return <button type="button" className="btn small" onClick={() => confirm(k)}>이 값으로 확인</button>;
}

function MiniChecks({ checks }) {
  if (!checks.length) return null;
  return (
    <ul className="mini-checks">
      {checks.map((c) => (
        <li key={c.id}>
          <StatusBadge status={c.status} />
          <span>{c.label}</span>
          <span className="mono">기대 {fmt(c.expected)} · 실제 {fmt(c.actual)} · 차이 {fmtSigned(c.diff)}</span>
          {c.cause && <span className="muted">{c.cause}</span>}
        </li>
      ))}
    </ul>
  );
}

function EqualAdjust({ business, run, fee, setEqual, confirm, openDetail, checks }) {
  const s = business.settings;
  const eq = fee.equal;
  if (s.equal.method === 'B') {
    return (
      <Section title="균등회비 원 단위 조정" desc={`방식 B(기관별 금액 동일 우선)라서 모든 기관이 ${fmtWon(eq.unit)}을 냅니다. 설정 비율과의 차이는 실적회비 총액이 흡수하므로 기관별 원 단위 조정이 없습니다.`}>
        <dl className="kv">
          <div><dt>실제 균등회비 비율 / 설정 비율</dt><dd>{eq.actualPercent} / {eq.setPercent}</dd></div>
          <div><dt>차이</dt><dd>{eq.gapPercent}</dd></div>
        </dl>
        <MiniChecks checks={checks} />
      </Section>
    );
  }
  const k = Math.abs(eq.diff);
  const chosen = s.equal.targetOrgIds.filter((id) => fee.rows.some((r) => r.id === id));
  const toggle = (id) => setEqual({ targetOrgIds: chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id] }, 'equalTargets');
  return (
    <Section
      title="균등회비 원 단위 조정 (방식 A)"
      desc="균등회비 총액을 기관 수로 나눈 금액을 원 단위로 처리하면 총액과 차이가 생깁니다. 그 차액을 어느 기관에 1원씩 더하거나 뺄지 정합니다."
    >
      <div className="form-grid">
        <Field label="기관별 기본금액의 원 미만 처리" htmlFor="unitround" pending={isPending(run, 'equalUnitRounding')} hint={`${fmtWon(eq.pool)} ÷ ${fee.orgCount}개 → ${fmtWon(eq.unit)}`}>
          <Select id="unitround" value={s.equal.unitRounding} onChange={(v) => setEqual({ unitRounding: v }, 'equalUnitRounding')} options={ROUNDING_OPTIONS} />
          <ConfirmButton run={run} k="equalUnitRounding" confirm={confirm} />
        </Field>
        <Field label="균등회비 총액 대비 차액">
          <p className="big-num">{fmtSigned(eq.diff)}원</p>
          <p className="field-hint">{k ? `${k}개 기관에 ${eq.diff > 0 ? '+1원' : '−1원'}씩 조정합니다.` : '나누어떨어져 조정할 금액이 없습니다.'}</p>
        </Field>
        {k > 0 && (
          <Field label="조정할 기관 정하기" pending={isPending(run, 'equalTargets')}>
            <Choice
              name="eqtarget"
              value={s.equal.targetMode}
              onChange={(v) => setEqual({ targetMode: v, targetOrgIds: v === 'manual' && !chosen.length ? eq.targets : chosen }, 'equalTargets')}
              options={[{ value: 'auto', label: '목록 순서대로 자동' }, { value: 'manual', label: '담당자가 직접 선택' }]}
            />
            <ConfirmButton run={run} k="equalTargets" confirm={confirm} />
          </Field>
        )}
      </div>
      {k > 0 && s.equal.targetMode === 'manual' && (
        <p className={`pick-count ${chosen.length === k ? 'ok' : 'bad'}`}>
          {chosen.length} / {k}개 선택{chosen.length > k ? ` (앞에서부터 ${k}개만 반영)` : chosen.length < k ? ` (${k - chosen.length}개 더 골라야 합니다)` : ''}
        </p>
      )}
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              {k > 0 && s.equal.targetMode === 'manual' && <th className="c">선택</th>}
              <th className="l">기관명</th>
              <th>기본금액</th>
              <th>원 단위 조정</th>
              <th>최종 균등회비</th>
            </tr>
          </thead>
          <tbody>
            {fee.rows.map((r) => (
              <tr key={r.id} className={r.equalAdj ? 'is-selected' : ''}>
                {k > 0 && s.equal.targetMode === 'manual' && (
                  <td className="c">
                    <input type="checkbox" aria-label={`${r.name} 조정 대상`} checked={chosen.includes(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                )}
                <td className="l"><button type="button" className="btn-link" onClick={() => openDetail(r.id)}>{r.name}</button></td>
                <td>{fmt(r.equalBase)}</td>
                <td className={r.equalAdj ? 'strong accent' : 'muted'}>{r.equalAdj ? fmtSigned(r.equalAdj) : '-'}</td>
                <td className="strong">{fmt(r.equalFinal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              {k > 0 && s.equal.targetMode === 'manual' && <td />}
              <td className="l">합계</td>
              <td>{fmt(eq.unit * fee.orgCount)}</td>
              <td>{fmtSigned(fee.rows.reduce((a, r) => a + r.equalAdj, 0))}</td>
              <td className="strong">{fmt(fee.totals.equal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <MiniChecks checks={checks} />
    </Section>
  );
}

function RemainderAdjust({ business, run, fee, setRemainder, confirm }) {
  const s = business.settings;
  const R = fee.perf.remainder;
  const chosen = s.perfRemainder.orgIds.filter((id) => fee.rows.some((r) => r.id === id));
  const toggle = (id) => setRemainder({ orgIds: chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id] }, 'perfRemainder');
  const got = fee.rows.filter((r) => r.perfRemainderAdj);
  return (
    <Section
      title="실적회비 원 단위 잔액"
      desc="실적회비를 기관별로 원 미만 버림하면 합계가 실적회비 총액보다 조금 적어집니다. 그 남은 원을 누구에게 1원씩 줄지 정합니다."
    >
      <div className="form-grid">
        <Field label="남은 금액">
          <p className="big-num">{fmt(R)}원</p>
        </Field>
        <Field label="배정 방법" htmlFor="remmode" pending={isPending(run, 'perfRemainder')} wide>
          <Choice
            name="remmode"
            value={s.perfRemainder.mode}
            onChange={(v) => setRemainder({ mode: v }, 'perfRemainder')}
            options={Object.entries(REMAINDER_MODES).map(([value, label]) => ({ value, label }))}
          />
          <ConfirmButton run={run} k="perfRemainder" confirm={confirm} />
        </Field>
      </div>
      {s.perfRemainder.mode === 'manual' && (
        <>
          <p className={`pick-count ${chosen.length ? 'ok' : 'bad'}`}>
            {chosen.length}개 선택. 고른 순서대로 1원씩 돌아가며 배정합니다{R ? ` (${fmt(R)}원)` : ''}.
          </p>
          <div className="pick-list">
            {fee.rows.map((r) => (
              <label key={r.id} className={`check pick ${chosen.includes(r.id) ? 'is-on' : ''}`}>
                <input type="checkbox" checked={chosen.includes(r.id)} onChange={() => toggle(r.id)} />
                {r.name}
                {chosen.includes(r.id) && <span className="tag tag-accent">{chosen.indexOf(r.id) + 1}</span>}
              </label>
            ))}
          </div>
        </>
      )}
      <p className="field-hint">
        {got.length ? `이번 배정: ${got.map((r) => `${r.name} ${fmtSigned(r.perfRemainderAdj)}`).join(', ')}` : '배정할 잔액이 없습니다.'}
      </p>
    </Section>
  );
}

function PostOffice({ business, run, fee, setPO, confirm, openDetail, checks, rows }) {
  const s = business.settings;
  const po = fee.postOffice;
  const poId = postOfficeOrgId(business);
  const others = rows.filter((r) => r.id !== poId);
  const before = (r) => r.final - r.perfPostOfficeAdj;
  const changed = rows.filter((r) => r.perfPostOfficeAdj);
  return (
    <Section
      title="우체국 특수 처리"
      desc="우체국 최종 회비는 1원 단위가 0이어야 합니다. 우체국 실적회비에서 10원 단위로 올리거나 내리고, 같은 금액을 다른 기관의 실적회비에서 반대로 조정해 전체 합계를 유지합니다."
      actions={
        <label className="check switch">
          <input type="checkbox" checked={s.postOffice.enabled} onChange={(e) => setPO({ enabled: e.target.checked })} />
          이 업무에 적용
        </label>
      }
    >
      {!s.postOffice.enabled ? (
        <p className="note">이 업무에는 우체국 특수 처리를 적용하지 않습니다.</p>
      ) : (
        <>
          <div className="form-grid">
            <Field label="대상 기관" htmlFor="poorg" hint={s.postOffice.orgId ? '' : '지정하지 않으면 이름에 우체국이 들어간 기관을 씁니다.'}>
              <Select
                id="poorg"
                value={s.postOffice.orgId ?? ''}
                onChange={(v) => setPO({ orgId: v || null })}
                options={[{ value: '', label: `자동 (${business.orgs.find((o) => o.id === poId)?.name ?? '찾지 못함'})` }, ...business.orgs.filter((o) => o.active).map((o) => ({ value: o.id, label: o.name }))]}
              />
            </Field>
            <Field label="10원 단위 처리" pending={isPending(run, 'poDirection')}>
              <Choice
                name="podir"
                value={s.postOffice.direction}
                onChange={(v) => setPO({ direction: v }, 'poDirection')}
                options={[
                  { value: 'up', label: '올림', desc: po.before !== undefined ? previewText(po.before, 'up') : '' },
                  { value: 'down', label: '내림', desc: po.before !== undefined ? previewText(po.before, 'down') : '' },
                ]}
              />
              <ConfirmButton run={run} k="poDirection" confirm={confirm} />
            </Field>
            <Field label="차액을 반대로 반영할 기관" htmlFor="pocp" pending={isPending(run, 'poCounterpart')}>
              <Select
                id="pocp"
                value={s.postOffice.counterpartMode === 'auto' ? '' : s.postOffice.counterpartOrgId ?? ''}
                onChange={(v) => setPO(v ? { counterpartMode: 'manual', counterpartOrgId: v } : { counterpartMode: 'auto', counterpartOrgId: null }, 'poCounterpart')}
                options={[{ value: '', label: '자동: 실적회비가 가장 큰 기관' }, ...others.map((r) => ({ value: r.id, label: `${r.name} (실적회비 ${fmt(r.perfFinal - r.perfPostOfficeAdj)})` }))]}
              />
              <ConfirmButton run={run} k="poCounterpart" confirm={confirm} />
            </Field>
          </div>
          {po.orgId && (
            <dl className="kv">
              <div><dt>보정 전 우체국 회비</dt><dd>{fmtWon(po.before)}</dd></div>
              <div><dt>보정 금액</dt><dd>{fmtSigned(po.delta)}원 ({po.delta ? (po.direction === 'down' ? '내림' : '올림') : '이미 10원 단위'})</dd></div>
              <div><dt>보정 후 우체국 회비</dt><dd className="strong">{fmtWon(po.after)}</dd></div>
              <div><dt>반대 조정 기관</dt><dd>{po.counterpartName ?? '-'}{po.counterpartName && po.delta ? ` (${fmtSigned(-po.delta)}원)` : ''}</dd></div>
            </dl>
          )}
          {changed.length > 0 && (
            <div className="table-scroll">
              <table className="grid">
                <thead>
                  <tr>
                    <th className="l">기관명</th>
                    <th>보정 전 실적회비</th>
                    <th>보정 금액</th>
                    <th>보정 후 실적회비</th>
                    <th>보정 전 최종 회비</th>
                    <th>보정 후 최종 회비</th>
                  </tr>
                </thead>
                <tbody>
                  {changed.map((r) => (
                    <tr key={r.id}>
                      <td className="l"><button type="button" className="btn-link" onClick={() => openDetail(r.id)}>{r.name}</button></td>
                      <td>{fmt(r.perfFinal - r.perfPostOfficeAdj)}</td>
                      <td className="strong accent">{fmtSigned(r.perfPostOfficeAdj)}</td>
                      <td>{fmt(r.perfFinal)}</td>
                      <td>{fmt(before(r))}</td>
                      <td className="strong">{fmt(r.final)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="l">합계</td>
                    <td>{fmt(changed.reduce((a, r) => a + r.perfFinal - r.perfPostOfficeAdj, 0))}</td>
                    <td>{fmtSigned(changed.reduce((a, r) => a + r.perfPostOfficeAdj, 0))}</td>
                    <td>{fmt(changed.reduce((a, r) => a + r.perfFinal, 0))}</td>
                    <td>{fmt(changed.reduce((a, r) => a + before(r), 0))}</td>
                    <td className="strong">{fmt(changed.reduce((a, r) => a + r.final, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <Issues issues={fee.issues.filter((i) => i.message.includes('우체국'))} />
          <MiniChecks checks={checks} />
        </>
      )}
    </Section>
  );
}

function previewText(before, dir) {
  const mod = ((before % 10) + 10) % 10;
  if (!mod) return `${fmt(before)}원 그대로`;
  const after = dir === 'down' ? before - mod : before + 10 - mod;
  return `${fmt(before)} → ${fmt(after)}원`;
}
