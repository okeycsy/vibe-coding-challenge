// 화면 3. 엑셀 실적 데이터 업로드 및 관리
// 흐름: 파일 선택 → 열 매핑 → 데이터 검증 → 미리보기(수정) → 실적 데이터 적용
import { useMemo, useRef, useState } from 'react';
import { buildPreview, detectHeaderRow, guessMapping, applyPreview, ROLE_LABELS } from '../engine/perfImport.js';
import { quarterRange } from '../engine/period.js';
import { uid } from '../engine/model.js';
import { readWorkbook, buildTemplateWorkbook, workbookBytes, saveFile } from '../excel.js';
import { Section, Field, Select, Issues, CountInput, fmt, PendingBadge } from './common.jsx';

const today = () => new Date().toISOString().slice(0, 10);

export default function DataScreen({ business, run, update, setSettings, confirm }) {
  const s = business.settings;
  const autoAddOrgs = s.autoAddOrgs ?? true;
  const [upload, setUpload] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);

  const openFile = async (file) => {
    if (!file) return;
    setError('');
    setMsg('');
    try {
      const sheets = readWorkbook(await file.arrayBuffer());
      const sheetIdx = Math.max(0, sheets.findIndex((sh) => detectHeaderRow(sh.aoa) !== -1));
      const headerIdx = Math.max(0, detectHeaderRow(sheets[sheetIdx].aoa));
      setUpload({
        fileName: file.name,
        sheets,
        sheetIdx,
        headerIdx,
        mapping: guessMapping(sheets[sheetIdx].aoa[headerIdx] ?? [], business.items, business.columnMapping),
        nameMap: {},
        edits: {},
        year: s.year,
        quarter: s.quarter,
        start: s.perfPeriod.start,
        end: s.perfPeriod.end,
        saveMapping: true,
      });
    } catch (err) {
      setError(`${file.name}을(를) 읽지 못했습니다. ${err.message}`);
    }
  };

  const sheet = upload?.sheets[upload.sheetIdx];
  const header = sheet?.aoa[upload.headerIdx] ?? [];
  const preview = useMemo(() => {
    if (!upload) return null;
    return buildPreview({
      aoa: sheet.aoa,
      headerIdx: upload.headerIdx,
      mapping: upload.mapping,
      items: business.items,
      recognizedItemIds: business.recognizedItemIds,
      orgs: business.orgs,
      period: { start: upload.start, end: upload.end },
      duplicatePolicy: s.duplicatePolicy,
      nameMap: upload.nameMap,
      edits: upload.edits,
      autoAddOrgs,
    });
  }, [upload, sheet, business.items, business.recognizedItemIds, business.orgs, s.duplicatePolicy, autoAddOrgs]);

  const setU = (patch) => setUpload((u) => ({ ...u, ...patch }));
  const setRole = (col, role) => {
    if (role === 'new') {
      const id = uid('item');
      const name = String(header[col] || `항목${col + 1}`).trim();
      update((b) => ({ ...b, items: [...b.items, { id, name }] }));
      role = `item:${id}`;
    }
    setU({ mapping: { ...upload.mapping, [col]: role } });
  };
  const resetMapping = (sheetIdx, headerIdx) =>
    setU({ sheetIdx, headerIdx, mapping: guessMapping(upload.sheets[sheetIdx].aoa[headerIdx] ?? [], business.items, business.columnMapping), nameMap: {}, edits: {} });

  const registerOrg = (rawName) => {
    const id = uid('org');
    update((b) => ({ ...b, orgs: [...b.orgs, { id, name: rawName, active: true }] }));
    setU({ nameMap: { ...upload.nameMap, [rawName]: id } });
  };

  const apply = () => {
    const { newOrgs, perf } = applyPreview(preview, () => uid('org'));
    const saved = { ...business.columnMapping };
    if (upload.saveMapping) {
      for (const [col, role] of Object.entries(upload.mapping)) {
        const h = String(header[col] ?? '').trim();
        if (h) saved[h] = role;
      }
    }
    update((b) => ({
      ...b,
      orgs: [...b.orgs, ...newOrgs],
      perf,
      columnMapping: saved,
      perfMeta: {
        fileName: upload.fileName,
        sheet: sheet.name,
        appliedAt: today(),
        start: upload.start,
        end: upload.end,
        year: upload.year,
        quarter: upload.quarter,
        rows: preview.stats.rowsRead,
        orgs: preview.entries.filter((e) => e.orgId || e.willAdd).length,
        newOrgs: newOrgs.map((o) => o.name),
      },
      settings: { ...b.settings, year: upload.year, quarter: upload.quarter, perfPeriod: { start: upload.start, end: upload.end } },
    }));
    setUpload(null);
    setMsg(`${upload.fileName}의 실적을 적용했습니다.${newOrgs.length ? ` 새 참가기관 ${newOrgs.length}곳(${newOrgs.map((o) => o.name).join(', ')})을 등록했습니다.` : ''} 산출 결과에 바로 반영됩니다.`);
  };

  const downloadTemplate = async () => {
    try {
      await saveFile(`실적_업로드_양식_${business.name}.xlsx`.replace(/[\\/:*?"<>|]/g, ''), workbookBytes(buildTemplateWorkbook(business)));
    } catch (err) {
      if (err?.code !== 'declined') setError(`양식을 저장하지 못했습니다. ${err?.message ?? ''}`);
    }
  };

  const roleOptions = [
    { value: 'ignore', label: ROLE_LABELS.ignore },
    { value: 'org', label: ROLE_LABELS.org },
    { value: 'total', label: ROLE_LABELS.total },
    { value: 'period', label: ROLE_LABELS.period },
    ...business.items.map((it) => ({ value: `item:${it.id}`, label: `실적: ${it.name}` })),
    { value: 'new', label: '새 실적 항목으로 추가' },
  ];
  const errorCount = preview?.issues.filter((i) => i.level === 'error').length ?? 0;
  const itemIds = preview?.stats.itemIds ?? [];
  const itemName = Object.fromEntries(business.items.map((i) => [i.id, i.name]));
  const qr = upload ? quarterRange(upload.year, upload.quarter) : null;

  return (
    <div className="screen">
      <Section
        title="실적 엑셀 업로드"
        desc="파일을 올리면 열 이름을 읽어 실적 항목에 연결하고, 데이터를 검증한 뒤 미리보기에서 확인하고 적용합니다."
        actions={<button type="button" className="btn" onClick={downloadTemplate}>업로드 양식 내려받기</button>}
      >
        <div
          className={`drop ${dragging ? 'is-over' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); openFile(e.dataTransfer.files?.[0]); }}
        >
          <svg className="drop-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5M12 18v-6m0 0-2.5 2.5M12 12l2.5 2.5" />
          </svg>
          <div className="drop-text">
            <strong>{upload ? upload.fileName : '엑셀 파일을 끌어다 놓거나 눌러서 선택'}</strong>
            <span>.xlsx · .xls · .csv</span>
          </div>
          <span className="drop-action">파일 선택</span>
          <input ref={fileRef} id="perf-file" type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {error && <p className="alert alert-error">{error}</p>}
        {msg && <p className="note">{msg}</p>}

        {upload && (
          <div className="wizard">
            <h3><span className="step-no">1</span>업로드 정보</h3>
            <div className="form-grid">
              <Field label="적용 업무">
                <p className="field-text">{business.name}</p>
              </Field>
              <Field label="산출 연도" htmlFor="up-year">
                <input id="up-year" type="number" value={upload.year} onChange={(e) => setU({ year: Number(e.target.value) || upload.year })} />
              </Field>
              <Field label="산출 대상 분기" htmlFor="up-q">
                <Select id="up-q" value={upload.quarter} onChange={(v) => setU({ quarter: Number(v) })} options={[1, 2, 3, 4].map((q) => ({ value: q, label: `${q}분기` }))} />
              </Field>
              <Field label="실적 데이터 시작일" htmlFor="up-start" hint="업무마다 다를 수 있어 분기에 고정하지 않습니다.">
                <input id="up-start" type="date" value={upload.start} onChange={(e) => setU({ start: e.target.value })} />
              </Field>
              <Field label="실적 데이터 종료일" htmlFor="up-end">
                <input id="up-end" type="date" value={upload.end} onChange={(e) => setU({ end: e.target.value })} />
              </Field>
              <Field label="빠른 선택">
                <div className="btn-row">
                  {qr && <button type="button" className="btn small" onClick={() => setU({ start: qr.from, end: qr.to })}>산출 분기와 같은 기간</button>}
                  {upload.quarter > 1 && (
                    <button type="button" className="btn small" onClick={() => { const r = quarterRange(upload.year, upload.quarter - 1); setU({ start: r.from, end: r.to }); }}>
                      직전 분기
                    </button>
                  )}
                  <button type="button" className="btn small" onClick={() => setU({ start: '', end: '' })}>기간 제한 없음</button>
                </div>
              </Field>
            </div>
            {upload.start && upload.end && upload.start > upload.end && <p className="alert alert-error">시작일이 종료일보다 늦습니다.</p>}

            <h3><span className="step-no">2</span>열 매핑</h3>
            <div className="form-grid">
              {upload.sheets.length > 1 && (
                <Field label="시트" htmlFor="up-sheet">
                  <Select id="up-sheet" value={upload.sheetIdx} onChange={(v) => resetMapping(Number(v), Math.max(0, detectHeaderRow(upload.sheets[Number(v)].aoa)))} options={upload.sheets.map((sh, i) => ({ value: i, label: sh.name }))} />
                </Field>
              )}
              <Field label="머리글 행" htmlFor="up-head" hint="열 이름이 있는 행 번호">
                <input id="up-head" type="number" min="1" max={sheet.aoa.length} value={upload.headerIdx + 1} onChange={(e) => resetMapping(upload.sheetIdx, Math.min(sheet.aoa.length - 1, Math.max(0, Number(e.target.value) - 1)))} />
              </Field>
              <Field label="매핑 저장">
                <label className="check">
                  <input type="checkbox" checked={upload.saveMapping} onChange={(e) => setU({ saveMapping: e.target.checked })} />
                  같은 양식을 다음에도 이 매핑으로 읽기
                </label>
              </Field>
            </div>
            <div className="table-scroll">
              <table className="grid mapping">
                <thead>
                  <tr>
                    <th className="l">엑셀 열</th>
                    <th className="l">첫 값</th>
                    <th className="l">프로그램 항목</th>
                  </tr>
                </thead>
                <tbody>
                  {header.map((h, col) => (
                    <tr key={col}>
                      <td className="l strong">{String(h || `(${col + 1}번째 열, 이름 없음)`)}</td>
                      <td className="l muted">{showCell(sheet.aoa[upload.headerIdx + 1]?.[col])}</td>
                      <td className="l">
                        <Select aria-label={`${h} 열의 항목`} value={upload.mapping[col] ?? 'ignore'} onChange={(v) => setRole(col, v)} options={roleOptions} />
                        {upload.mapping[col]?.startsWith('item:') && business.recognizedItemIds.includes(upload.mapping[col].slice(5)) && <span className="tag tag-accent">인정</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3><span className="step-no">3</span>데이터 검증</h3>
            <div className="form-grid">
              <Field label="같은 기관명이 여러 행일 때" htmlFor="dup" pending={run.pending.some((d) => d.key === 'duplicatePolicy')}>
                <Select id="dup" value={s.duplicatePolicy} onChange={(v) => setSettings({ duplicatePolicy: v }, 'duplicatePolicy')} options={[{ value: 'sum', label: '같은 기관으로 보고 합산' }, { value: 'error', label: '오류로 표시' }]} />
              </Field>
              <Field label="파일에 없는 분담 대상 기관" pending={run.pending.some((d) => d.key === 'missingOrgs')}>
                <p className="field-text">
                  실적 0건으로 보고 균등회비만 부과합니다.{' '}
                  {run.pending.some((d) => d.key === 'missingOrgs') && <button type="button" className="btn-link" onClick={() => confirm('missingOrgs')}>이대로 확인</button>}
                </p>
              </Field>
            </div>
            <label className="check">
              <input type="checkbox" checked={autoAddOrgs} onChange={(e) => setSettings({ autoAddOrgs: e.target.checked })} />
              엑셀에만 있는 기관은 적용할 때 참가기관으로 자동 등록
            </label>
            <div className="stats">
              <span>읽은 행 <b>{fmt(preview.stats.rowsRead)}</b></span>
              {preview.stats.rowsOutside > 0 && <span>기간 밖 제외 <b>{fmt(preview.stats.rowsOutside)}</b></span>}
              <span>파일 기관 수 <b>{fmt(preview.stats.fileOrgCount)}</b></span>
              <span>분담 대상 기관 <b>{preview.stats.matchedActive} / {preview.stats.activeOrgCount}</b></span>
              {preview.stats.newOrgCount > 0 && <span>새로 등록 <b>{preview.stats.newOrgCount}</b></span>}
              {preview.stats.periodRange && <span>파일 기간 <b>{preview.stats.periodRange.from} ~ {preview.stats.periodRange.to}</b></span>}
              <span className={errorCount ? 'bad' : 'ok'}>{errorCount ? `오류 ${errorCount}건` : '오류 없음'}</span>
            </div>
            <Issues issues={preview.issues} />

            <h3><span className="step-no">4</span>미리보기와 수정</h3>
            <div className="table-scroll">
              <table className="grid">
                <thead>
                  <tr>
                    <th className="l">엑셀 기관명</th>
                    <th className="l">연결할 등록 기관</th>
                    {itemIds.map((id) => (
                      <th key={id}>{itemName[id]}{business.recognizedItemIds.includes(id) ? '' : ' (미인정)'}</th>
                    ))}
                    <th>인정 실적</th>
                    <th className="c">행</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.entries.map((e) => (
                    <tr key={e.rawName} className={!e.orgId && !e.willAdd ? 'is-warn' : ''}>
                      <td className="l strong">{e.rawName}{e.willAdd && <span className="tag tag-accent">신규</span>}</td>
                      <td className="l">
                        <Select
                          aria-label={`${e.rawName} 연결 기관`}
                          value={e.willAdd ? '__auto' : e.orgId ?? ''}
                          onChange={(v) => {
                            if (v === '__new') return registerOrg(e.rawName);
                            const nameMap = { ...upload.nameMap, [e.rawName]: v };
                            if (v === '__auto') delete nameMap[e.rawName];
                            setU({ nameMap });
                          }}
                          options={[
                            ...(autoAddOrgs && !business.orgs.some((o) => o.id === e.orgId) ? [{ value: '__auto', label: '새 참가기관으로 자동 등록' }] : []),
                            { value: '', label: '연결 안 함 (산출 제외)' },
                            ...business.orgs.map((o) => ({ value: o.id, label: `${o.name}${o.active ? '' : ' (제외 기관)'}` })),
                            ...(autoAddOrgs ? [] : [{ value: '__new', label: `'${e.rawName}' 새 기관으로 등록` }]),
                          ]}
                        />
                      </td>
                      {itemIds.map((id) => (
                        <td key={id}>
                          <CountInput
                            aria-label={`${e.rawName} ${itemName[id]}`}
                            value={upload.edits[e.rawName]?.[id] ?? e.counts[id] ?? ''}
                            invalid={Boolean(e.cellErrors[id])}
                            onChange={(v) => setU({ edits: { ...upload.edits, [e.rawName]: { ...upload.edits[e.rawName], [id]: v } } })}
                          />
                        </td>
                      ))}
                      <td className="strong">{fmt(e.recognized)}</td>
                      <td className="c muted">{e.rows.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="apply-bar">
              <span>{upload.fileName} · {preview.entries.length}개 기관</span>
              <button type="button" className="btn" onClick={() => setUpload(null)}>취소</button>
              <button type="button" className="btn-primary" disabled={!preview.canApply || (upload.start && upload.end && upload.start > upload.end)} onClick={apply}>
                실적 데이터 적용
              </button>
            </div>
            {!preview.canApply && <p className="field-hint">오류를 고치면 적용할 수 있습니다. 숫자 칸은 위 표에서 바로 고칠 수 있습니다.</p>}
          </div>
        )}
      </Section>

      <AppliedData business={business} run={run} update={update} />
    </div>
  );
}

const showCell = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === undefined || v === '' ? '' : String(v));

// 적용된 실적 데이터: 기관별로 바로 고칠 수 있고, 고치면 즉시 다시 계산된다
function AppliedData({ business, run, update }) {
  const meta = business.perfMeta;
  const [bad, setBad] = useState({});
  const rows = Object.fromEntries((run.fee?.rows ?? []).map((r) => [r.id, r]));
  const setCount = (orgId, itemId, text) => {
    const v = String(text).replace(/[,\s]/g, '');
    const key = `${orgId}:${itemId}`;
    if (v !== '' && !/^\d+$/.test(v)) {
      setBad((b) => ({ ...b, [key]: true }));
      return;
    }
    setBad((b) => ({ ...b, [key]: false }));
    update((b) => ({
      ...b,
      perf: { ...b.perf, [orgId]: { ...b.perf[orgId], [itemId]: v === '' ? 0 : Number(v) } },
      perfMeta: b.perfMeta ? { ...b.perfMeta, edited: today() } : { fileName: '직접 입력', appliedAt: today(), start: b.settings.perfPeriod.start, end: b.settings.perfPeriod.end, edited: today() },
    }));
  };
  return (
    <Section
      title="적용된 실적 데이터"
      desc="산출에 쓰는 건수입니다. 칸을 고치면 해당 기관의 인정 실적과 실적회비가 바로 다시 계산됩니다."
      actions={meta ? <span className="count-chip">{meta.fileName}{meta.sample ? ' (예시)' : ''} · 기준기간 {meta.start || '-'} ~ {meta.end || '-'} · 적용 {meta.appliedAt}{meta.edited ? ` · 수정 ${meta.edited}` : ''}</span> : <PendingBadge text="아직 적용한 실적 없음" />}
    >
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th className="l">기관명</th>
              {business.items.map((it) => (
                <th key={it.id}>{it.name}{business.recognizedItemIds.includes(it.id) ? '' : ' (미인정)'}</th>
              ))}
              <th>인정 실적</th>
              <th>실적 점유율</th>
              <th>실적회비</th>
            </tr>
          </thead>
          <tbody>
            {business.orgs.map((o) => (
              <tr key={o.id} className={o.active ? '' : 'is-off'}>
                <td className="l strong">{o.name}{!o.active && <span className="tag">제외</span>}{o.active && !business.perf[o.id] && <span className="tag tag-warn">데이터 없음</span>}</td>
                {business.items.map((it) => (
                  <td key={it.id}>
                    <CountInput
                      aria-label={`${o.name} ${it.name}`}
                      value={business.perf[o.id]?.[it.id] ?? ''}
                      invalid={bad[`${o.id}:${it.id}`]}
                      onChange={(v) => setCount(o.id, it.id, v)}
                    />
                  </td>
                ))}
                <td className="strong">{fmt(rows[o.id]?.recognized ?? 0)}</td>
                <td>{rows[o.id]?.sharePercent ?? '-'}</td>
                <td>{rows[o.id] ? fmt(rows[o.id].perfFinal) : '-'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="l">합계 (분담 대상)</td>
              {business.items.map((it) => (
                <td key={it.id}>{fmt(business.orgs.filter((o) => o.active).reduce((a, o) => a + (business.perf[o.id]?.[it.id] ?? 0), 0))}</td>
              ))}
              <td className="strong">{fmt(run.fee?.perf.totalRecognized ?? 0)}</td>
              <td>100%</td>
              <td>{fmt(run.fee?.totals.perf ?? 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Section>
  );
}

