// 화면 1. 업무 및 참가기관 관리
import { useRef, useState } from 'react';
import { newBusiness, uid, sampleBusinesses } from '../engine/model.js';
import { saveFile, readWorkbook } from '../excel.js';
import { extractOrgNames } from '../engine/perfImport.js';
import { Section, fmt } from './common.jsx';

export default function BusinessScreen({ business, run, update, state, setState }) {
  const [newOrg, setNewOrg] = useState('');
  const [bulk, setBulk] = useState('');
  const [msg, setMsg] = useState('');
  const [orgMsg, setOrgMsg] = useState('');
  const fileRef = useRef(null);
  const orgFileRef = useRef(null);
  const orgs = business.orgs;
  const active = orgs.filter((o) => o.active).length;
  const finalOf = Object.fromEntries((run.fee?.rows ?? []).map((r) => [r.id, r.final]));

  const setOrgs = (fn) => update((b) => ({ ...b, orgs: fn(b.orgs) }));
  // 띄어쓰기만 다른 이름은 같은 기관으로 본다 (실적 업로드의 기관명 연결 기준과 같음)
  const key = (n) => n.replace(/\s+/g, '').toLowerCase();
  const addOrgs = (names, source = '') => {
    const exists = new Set(orgs.map((o) => key(o.name)));
    const fresh = [];
    for (const n of names.map((x) => x.trim())) {
      if (!n || exists.has(key(n))) continue;
      exists.add(key(n));
      fresh.push(n);
    }
    if (fresh.length) setOrgs((list) => [...list, ...fresh.map((name) => ({ id: uid('org'), name, active: true }))]);
    setOrgMsg(fresh.length ? `${source}${fresh.length}개 기관을 추가했습니다: ${fresh.join(', ')}` : `${source}추가할 새 기관명이 없습니다(빈칸이거나 이미 있음).`);
  };
  const importOrgs = async (file) => {
    try {
      const names = readWorkbook(await file.arrayBuffer()).flatMap((sh) => extractOrgNames(sh.aoa));
      addOrgs(names, `${file.name}에서 기관명 ${names.length}개를 읽어 `);
    } catch (err) {
      setOrgMsg(`${file.name}을(를) 읽지 못했습니다. ${err.message}`);
    }
  };
  const removeOrg = (id) =>
    update((b) => {
      const perf = { ...b.perf };
      delete perf[id];
      return { ...b, orgs: b.orgs.filter((o) => o.id !== id), perf };
    });

  const setBusinesses = (fn, currentId) => setState((st) => ({ businesses: fn(st.businesses), currentId: currentId ?? st.currentId }));
  const addBusiness = (b) => setBusinesses((list) => [...list, b], b.id);

  const exportSettings = async () => {
    try {
      await saveFile(`회비산출_설정_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), 'application/json');
      setMsg('설정 파일을 내려받았습니다.');
    } catch (err) {
      if (err?.code !== 'declined') setMsg(`설정 파일을 저장하지 못했습니다. ${err?.message ?? ''}`);
    }
  };
  const importSettings = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.businesses) || !data.businesses.length) throw new Error('업무 목록이 없습니다.');
      setState({ businesses: data.businesses, currentId: data.currentId ?? data.businesses[0].id });
      setMsg(`${file.name}에서 업무 ${data.businesses.length}개를 불러왔습니다.`);
    } catch (err) {
      setMsg(`설정 파일을 읽지 못했습니다. ${err.message}`);
    }
  };

  return (
    <div className="screen">
      <Section
        title="업무"
        desc="업무마다 참가기관, 실적 항목, 산출 옵션, 실적 데이터를 따로 저장합니다. 다음 분기나 다음 연도에는 업무를 복제해서 이어 쓰면 됩니다."
      >
        <div className="row-form">
          <label htmlFor="biz-name">업무명</label>
          <input id="biz-name" type="text" value={business.name} onChange={(e) => update((b) => ({ ...b, name: e.target.value }))} />
        </div>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => addBusiness(newBusiness('새 업무'))}>새 업무</button>
          <button
            type="button"
            className="btn"
            onClick={() => addBusiness({ ...structuredClone(business), id: uid('biz'), name: `${business.name} 복사본` })}
          >
            이 업무 복제
          </button>
          <DeleteBusiness
            disabled={state.businesses.length < 2}
            onDelete={() => setBusinesses((list) => list.filter((b) => b.id !== business.id), state.businesses.find((b) => b.id !== business.id)?.id)}
          />
          <span className="btn-sep" />
          <button type="button" className="btn" onClick={exportSettings}>설정 내보내기</button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>설정 불러오기</button>
          <ResetSamples onReset={() => {
            const s = sampleBusinesses();
            setState({ businesses: s, currentId: s[0].id });
          }}
          />
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { if (e.target.files?.[0]) importSettings(e.target.files[0]); e.target.value = ''; }} />
        </div>
        {msg && <p className="note">{msg}</p>}
      </Section>

      <Section
        title="참가기관"
        desc="분담 대상에서 빼면 균등회비와 실적회비 산출에서 모두 빠집니다. 기관명은 실적 엑셀의 기관명과 맞춰 두면 업로드할 때 자동으로 연결됩니다."
        actions={<span className="count-chip">전체 {orgs.length}개 · 분담 대상 <b>{active}개</b></span>}
      >
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th className="c">순번</th>
                <th className="l">기관명</th>
                <th className="c">분담 대상</th>
                <th>인정 실적</th>
                <th>이번 분기 회비</th>
                <th aria-label="삭제" />
              </tr>
            </thead>
            <tbody>
              {orgs.map((o, i) => {
                const recognized = business.recognizedItemIds.reduce((a, id) => a + (business.perf[o.id]?.[id] ?? 0), 0);
                return (
                  <tr key={o.id} className={o.active ? '' : 'is-off'}>
                    <td className="c muted">{i + 1}</td>
                    <td className="l">
                      <input
                        className="cell-input"
                        aria-label={`${i + 1}번 기관명`}
                        value={o.name}
                        onChange={(e) => setOrgs((list) => list.map((x) => (x.id === o.id ? { ...x, name: e.target.value } : x)))}
                      />
                    </td>
                    <td className="c">
                      <input
                        type="checkbox"
                        aria-label={`${o.name} 분담 대상`}
                        checked={o.active}
                        onChange={(e) => setOrgs((list) => list.map((x) => (x.id === o.id ? { ...x, active: e.target.checked } : x)))}
                      />
                    </td>
                    <td>{fmt(recognized)}</td>
                    <td>{o.active && finalOf[o.id] !== undefined ? fmt(finalOf[o.id]) : <span className="muted">제외</span>}</td>
                    <td className="c">
                      <button type="button" className="btn-link danger" onClick={() => removeOrg(o.id)}>삭제</button>
                    </td>
                  </tr>
                );
              })}
              {orgs.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">등록된 기관이 없습니다. 아래에서 추가하거나 실적 엑셀을 올릴 때 등록하세요.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => orgFileRef.current?.click()}>엑셀에서 기관명 불러오기</button>
          <span className="field-hint">기관명 열(기관명·기관·참가기관·회원사·은행명)을 찾아 아직 없는 기관만 추가합니다. 실적 엑셀을 올려도 됩니다.</span>
          <input ref={orgFileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { if (e.target.files?.[0]) importOrgs(e.target.files[0]); e.target.value = ''; }} />
        </div>
        {orgMsg && <p className="note">{orgMsg}</p>}
        <div className="add-grid">
          <form
            className="row-form"
            onSubmit={(e) => {
              e.preventDefault();
              addOrgs([newOrg]);
              setNewOrg('');
            }}
          >
            <label htmlFor="new-org">기관 추가</label>
            <input id="new-org" type="text" placeholder="기관명" value={newOrg} onChange={(e) => setNewOrg(e.target.value)} />
            <button type="submit" className="btn">추가</button>
          </form>
          <div className="bulk">
            <label htmlFor="bulk-orgs">여러 기관 한 번에 추가 (한 줄에 하나)</label>
            <textarea id="bulk-orgs" rows={3} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'가나은행\n다라증권'} />
            <button type="button" className="btn" onClick={() => { addOrgs(bulk.split(/\r?\n/)); setBulk(''); }}>모두 추가</button>
          </div>
        </div>
      </Section>
    </div>
  );
}

// 되돌릴 수 없는 동작은 화면 안에서 한 번 더 확인
function DeleteBusiness({ disabled, onDelete }) {
  const [ask, setAsk] = useState(false);
  if (ask) {
    return (
      <span className="confirm-inline">
        이 업무를 지울까요?
        <button type="button" className="btn danger" onClick={() => { setAsk(false); onDelete(); }}>지우기</button>
        <button type="button" className="btn" onClick={() => setAsk(false)}>취소</button>
      </span>
    );
  }
  return <button type="button" className="btn" disabled={disabled} onClick={() => setAsk(true)} title={disabled ? '업무가 하나뿐이면 지울 수 없습니다' : ''}>업무 삭제</button>;
}

function ResetSamples({ onReset }) {
  const [ask, setAsk] = useState(false);
  if (ask) {
    return (
      <span className="confirm-inline">
        모든 업무를 예시로 되돌릴까요?
        <button type="button" className="btn danger" onClick={() => { setAsk(false); onReset(); }}>되돌리기</button>
        <button type="button" className="btn" onClick={() => setAsk(false)}>취소</button>
      </span>
    );
  }
  return <button type="button" className="btn" onClick={() => setAsk(true)}>예시로 초기화</button>;
}
