// 화면 상태와 동작. 계산은 전부 rules/ 에서 하고 화면은 runBusiness() 결과만 보여 준다 (R-1.3).
import { runBusiness } from '../rules/run.js';
import { newBusiness, sampleBusinesses, normalizeBusiness, uid } from '../rules/model.js';
import { dec, decisionById } from '../rules/decisions.js';
import { percentToBp } from '../rules/money.js';
import { detectHeaderRow, guessMapping, buildPreview, applyPreview, extractOrgNames, normalizeName } from '../rules/importer.js';
import { fromV4Business, isV4State, isProtoState } from '../rules/compat.js';
import { readWorkbook, saveFile, downloadResult, downloadTemplate, readResultSheet } from './excel.js';
import { renderShell } from './screens.js';

const KEY = 'fee-rules-proto.v1';
const root = document.getElementById('app');

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved?.businesses?.length) return { businesses: saved.businesses.map(normalizeBusiness), currentId: saved.currentId };
  } catch { /* 저장소를 못 쓰면 예시로 시작 */ }
  const businesses = sampleBusinesses();
  return { businesses, currentId: businesses[0].id };
}
let state = load();
export const ui = { tab: 'orgs', upload: null, detail: null, cmp: null, toast: null, savedAt: null, canSave: true };

const biz = () => state.businesses.find((b) => b.id === state.currentId) ?? state.businesses[0];
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); ui.savedAt = new Date(); ui.canSave = true; } catch { ui.canSave = false; }
}
function render() {
  const b = biz();
  const run = runBusiness(b);
  const preview = ui.upload ? previewOf(b) : null;
  root.innerHTML = renderShell({ state, b, run, ui, preview });
}
function commit() { save(); render(); }
function toast(msg) { ui.toast = msg; render(); setTimeout(() => { if (ui.toast === msg) { ui.toast = null; render(); } }, 2500); }

// ── 값 설정 (data-field) ────────────────────────────────────────────
function coerce(type, el) {
  const raw = el.type === 'checkbox' ? el.checked : el.value;
  switch (type) {
    case 'int': { const v = Number(String(raw).replace(/,/g, '').trim()); return Number.isFinite(v) ? Math.trunc(v) : 0; }
    case 'intOrNull': { const t = String(raw).replace(/,/g, '').trim(); if (t === '') return null; const v = Number(t); return Number.isFinite(v) ? Math.trunc(v) : null; }
    case 'bool': return Boolean(raw);
    case 'bp': { const v = percentToBp(raw); return Number.isNaN(v) ? null : v; }
    default: return raw;
  }
}
function setField(el) {
  const b = biz();
  const path = el.dataset.field;
  const v = coerce(el.dataset.type ?? 'str', el);
  if (v === null && el.dataset.type === 'bp') { toast('비율은 소수점 둘째 자리까지 숫자로 입력하세요.'); return; }
  if (path.startsWith('org:')) {
    const [, id, key] = path.split(':');
    const o = b.orgs.find((x) => x.id === id);
    if (o) o[key] = key === 'name' ? String(v).trim() || o.name : v;
    return;
  }
  const parts = path.split('.');
  let cur = b;
  for (const p of parts.slice(0, -1)) { if (cur[p] === undefined || cur[p] === null) cur[p] = {}; cur = cur[p]; }
  cur[parts.at(-1)] = v;
  if (path === 'cond.equalBp' && typeof v === 'number') b.cond.perfBp = 10000 - v;
  if (path === 'cond.perfBp' && typeof v === 'number') b.cond.equalBp = 10000 - v;
}

// ── 업로드 미리보기 ─────────────────────────────────────────────────
function previewOf(b) {
  const u = ui.upload;
  const sheet = u.sheets[u.sheetIdx];
  return buildPreview({
    aoa: sheet.aoa, headerIdx: u.headerIdx, mapping: u.mapping, items: b.items, recognized: b.recognized, orgs: b.orgs,
    period: { start: u.info.start, end: u.info.end },
    d: { 'D-11': dec(b, 'D-11').value, 'D-12': dec(b, 'D-12').value, 'D-15': dec(b, 'D-15').value },
    nameMap: u.nameMap, edits: u.edits, autoAddOrgs: b.cond.autoAddOrgs, defaultYear: u.info.year,
  });
}
function startUpload(sheets, fileName) {
  const b = biz();
  const sheetIdx = Math.max(0, sheets.findIndex((s) => s.aoa.length > 1));
  const headerIdx = detectHeaderRow(sheets[sheetIdx].aoa);
  ui.upload = {
    fileName, sheets, sheetIdx, headerIdx,
    mapping: guessMapping(sheets[sheetIdx].aoa[headerIdx] ?? [], b.items, b.mapping),
    nameMap: {}, edits: {},
    info: { year: b.cond.year, quarter: b.cond.quarter, start: b.cond.perfPeriod.start, end: b.cond.perfPeriod.end },
  };
}
function remap() {
  const b = biz();
  const u = ui.upload;
  u.headerIdx = Math.min(u.headerIdx, Math.max(0, u.sheets[u.sheetIdx].aoa.length - 1));
  u.mapping = guessMapping(u.sheets[u.sheetIdx].aoa[u.headerIdx] ?? [], b.items, b.mapping);
}

// ── 동작 (data-act / data-on-change) ───────────────────────────────
const actions = {
  tab: (d) => { ui.tab = d.arg; render(); },
  selectBiz: (d, el) => { state.currentId = el.value; ui.upload = null; commit(); },
  newBiz: () => { const b = newBusiness(`새 업무 ${state.businesses.length + 1}`); state.businesses.push(b); state.currentId = b.id; ui.upload = null; commit(); },
  dupBiz: () => { const c = normalizeBusiness(structuredClone(biz())); c.id = uid('biz'); c.name = `${c.name} (복사)`; state.businesses.push(c); state.currentId = c.id; commit(); },
  delBiz: () => {
    if (state.businesses.length <= 1) { toast('업무가 하나뿐이라 삭제할 수 없습니다.'); return; }
    if (!confirm(`'${biz().name}' 업무를 삭제할까요?`)) return;
    state.businesses = state.businesses.filter((b) => b.id !== state.currentId);
    state.currentId = state.businesses[0].id;
    commit();
  },
  renameBiz: () => { const n = prompt('업무 이름', biz().name); if (n?.trim()) { biz().name = n.trim(); commit(); } },
  resetSample: () => { if (!confirm('모든 업무를 지우고 예시 업무로 되돌릴까요?')) return; state.businesses = sampleBusinesses(); state.currentId = state.businesses[0].id; ui.upload = null; commit(); },
  exportSettings: async () => {
    try { await saveFile(`회비산출_규칙프로토_설정_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), 'application/json'); }
    catch (e) { toast(e.message); }
  },
  importSettings: async (d, el) => {
    const file = el.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      let added = [];
      if (isV4State(data)) added = data.businesses.map(fromV4Business).map((b) => ({ ...b, name: `${b.name} [v4]` }));
      else if (isProtoState(data)) added = data.businesses.map(normalizeBusiness);
      else throw new Error('이 프로토타입 또는 v4 프로그램의 설정 JSON이 아닙니다.');
      const ids = new Set(state.businesses.map((b) => b.id));
      for (const b of added) { if (ids.has(b.id)) b.id = uid('biz'); state.businesses.push(b); }
      state.currentId = added[0]?.id ?? state.currentId;
      toast(`${added.length}개 업무를 불러왔습니다${isV4State(data) ? ' (v4 설정을 변환)' : ''}.`);
      commit();
    } catch (e) { toast(`불러오기 실패: ${e.message}`); }
    el.value = '';
  },
  confirm: (d) => { const b = biz(); b.decisions[d.arg] = { ...dec(b, d.arg), confirmed: true }; commit(); },
  unconfirm: (d) => { const b = biz(); b.decisions[d.arg] = { ...dec(b, d.arg), confirmed: false }; commit(); },

  // 참가기관
  addOrg: () => {
    const input = root.querySelector('#newOrgName');
    const name = input?.value.trim();
    if (!name) return;
    addOrgNames([name]);
  },
  addOrgs: () => {
    const ta = root.querySelector('#newOrgNames');
    const names = (ta?.value ?? '').split(/\r?\n|,|、/).map((s) => s.trim()).filter(Boolean);
    if (names.length) addOrgNames(names);
  },
  delOrg: (d) => { const b = biz(); b.orgs = b.orgs.filter((o) => o.id !== d.arg); delete b.perf[d.arg]; commit(); },
  moveOrg: (d) => {
    const b = biz();
    const i = b.orgs.findIndex((o) => o.id === d.arg);
    const j = i + Number(d.dir);
    if (i < 0 || j < 0 || j >= b.orgs.length) return;
    [b.orgs[i], b.orgs[j]] = [b.orgs[j], b.orgs[i]];
    commit();
  },
  setPostOffice: (d) => { const b = biz(); for (const o of b.orgs) o.postOffice = o.id === d.arg; commit(); },
  clearPostOffice: () => { const b = biz(); for (const o of b.orgs) o.postOffice = false; commit(); },
  importOrgNames: async (d, el) => {
    const file = el.files?.[0];
    if (!file) return;
    try {
      const sheets = await readWorkbook(file);
      const names = sheets.flatMap((s) => extractOrgNames(s.aoa, dec(biz(), 'D-15').value));
      const added = addOrgNames(names, true);
      toast(`${names.length}개 이름 중 ${added}곳을 새로 등록했습니다.`);
    } catch (e) { toast(`읽기 실패: ${e.message}`); }
    el.value = '';
  },

  // 실적 항목
  toggleRecognized: (d) => { const b = biz(); b.recognized = b.recognized.includes(d.arg) ? b.recognized.filter((x) => x !== d.arg) : [...b.recognized, d.arg]; commit(); },
  addItem: () => {
    const input = root.querySelector('#newItemName');
    const name = input?.value.trim();
    if (!name) return;
    const b = biz();
    const it = { id: uid('item'), name };
    b.items.push(it);
    b.recognized.push(it.id);
    commit();
  },
  renameItem: (d, el) => { const it = biz().items.find((i) => i.id === d.arg); if (it && el.value.trim()) { it.name = el.value.trim(); commit(); } },
  delItem: (d) => {
    const b = biz();
    if (b.items.length <= 1) { toast('실적 항목은 하나 이상 있어야 합니다.'); return; }
    b.items = b.items.filter((i) => i.id !== d.arg);
    b.recognized = b.recognized.filter((i) => i !== d.arg);
    for (const p of Object.values(b.perf)) delete p[d.arg];
    commit();
  },

  // 실적 업로드
  uploadPerf: async (d, el) => {
    const file = el.files?.[0];
    if (!file) return;
    try { startUpload(await readWorkbook(file), file.name); ui.tab = 'data'; render(); }
    catch (e) { toast(`엑셀 읽기 실패: ${e.message}`); }
    el.value = '';
  },
  selectSheet: (d, el) => { ui.upload.sheetIdx = Number(el.value); ui.upload.headerIdx = detectHeaderRow(ui.upload.sheets[ui.upload.sheetIdx].aoa); remap(); render(); },
  setHeaderRow: (d, el) => { ui.upload.headerIdx = Math.max(0, Number(el.value) - 1); remap(); render(); },
  setMapping: (d, el) => { ui.upload.mapping[d.arg] = el.value; render(); },
  addItemFromColumn: (d) => {
    const b = biz();
    const header = String(ui.upload.sheets[ui.upload.sheetIdx].aoa[ui.upload.headerIdx]?.[d.arg] ?? '').trim() || '새 항목';
    const it = { id: uid('item'), name: header };
    b.items.push(it);
    b.recognized.push(it.id);
    ui.upload.mapping[d.arg] = `item:${it.id}`;
    commit();
  },
  setNameMap: (d, el) => { ui.upload.nameMap[d.arg] = el.value === '__new__' ? undefined : el.value; if (el.value === '__new__') delete ui.upload.nameMap[d.arg]; render(); },
  editCount: (d, el) => { const u = ui.upload; u.edits[d.arg] = { ...(u.edits[d.arg] ?? {}), [d.item]: el.value }; render(); },
  setUploadInfo: (d, el) => { ui.upload.info[d.arg] = el.type === 'number' ? Number(el.value) : el.value; render(); },
  applyPerf: () => {
    const b = biz();
    const p = previewOf(b);
    if (!p.canApply) { toast('오류를 먼저 해결하세요.'); return; }
    const { perf, newOrgs } = applyPreview(p, () => uid('org'));
    b.orgs.push(...newOrgs);
    if (newOrgs.some((o) => o.postOffice) && b.orgs.filter((o) => o.postOffice).length > 1) for (const o of newOrgs) o.postOffice = false;
    b.perf = perf;
    const u = ui.upload;
    const headers = u.sheets[u.sheetIdx].aoa[u.headerIdx] ?? [];
    b.mapping = Object.fromEntries(Object.entries(u.mapping).filter(([i]) => String(headers[i] ?? '').trim()).map(([i, role]) => [String(headers[i]).trim(), role]));
    b.cond.year = u.info.year; b.cond.quarter = u.info.quarter;
    b.cond.perfPeriod = { start: u.info.start, end: u.info.end };
    b.perfMeta = { fileName: u.fileName, sheet: u.sheets[u.sheetIdx].name, start: u.info.start, end: u.info.end, year: u.info.year, quarter: u.info.quarter, appliedAt: new Date().toISOString().slice(0, 10), rows: p.rows.length, newOrgs: newOrgs.length };
    ui.upload = null;
    toast(`실적 데이터를 적용했습니다${newOrgs.length ? ` (새 기관 ${newOrgs.length}곳 등록)` : ''}.`);
    commit();
  },
  cancelUpload: () => { ui.upload = null; render(); },
  editPerf: (d, el) => {
    const b = biz();
    const v = Number(String(el.value).replace(/,/g, ''));
    if (!Number.isInteger(v) || v < 0) { toast('건수는 0 이상 정수로 입력하세요.'); render(); return; }
    b.perf[d.arg] = { ...(b.perf[d.arg] ?? {}), [d.item]: v };
    if (b.perfMeta) b.perfMeta.edited = true;
    commit();
  },
  clearPerf: () => { if (!confirm('적용한 실적 데이터를 모두 지울까요?')) return; const b = biz(); b.perf = {}; b.perfMeta = null; commit(); },
  downloadTemplate: async () => { try { await downloadTemplate(biz()); } catch (e) { toast(e.message); } },

  // 금액 보정
  toggleD6: (d) => { const b = biz(); const v = dec(b, 'D-6'); const ids = v.orgIds.includes(d.arg) ? v.orgIds.filter((x) => x !== d.arg) : [...v.orgIds, d.arg]; b.decisions['D-6'] = { ...v, orgIds: ids }; commit(); },
  toggleD8: (d) => { const b = biz(); const v = dec(b, 'D-8'); const ids = v.orgIds.includes(d.arg) ? v.orgIds.filter((x) => x !== d.arg) : [...v.orgIds, d.arg]; b.decisions['D-8'] = { ...v, orgIds: ids }; commit(); },

  // 결과
  detail: (d) => { ui.detail = d.arg; render(); },
  closeDetail: () => { ui.detail = null; render(); },
  prevOrg: () => { const rows = runBusiness(biz()).alloc?.rows ?? []; const i = rows.findIndex((r) => r.id === ui.detail); if (i > 0) { ui.detail = rows[i - 1].id; render(); } },
  nextOrg: () => { const rows = runBusiness(biz()).alloc?.rows ?? []; const i = rows.findIndex((r) => r.id === ui.detail); if (i >= 0 && i < rows.length - 1) { ui.detail = rows[i + 1].id; render(); } },
  downloadResult: async () => { try { await downloadResult(biz(), runBusiness(biz())); } catch (e) { toast(e.message); } },

  // 병행검증
  compareFile: async (d, el) => {
    const file = el.files?.[0];
    if (!file) return;
    try {
      const r = readResultSheet(await readWorkbook(file));
      if (!r) throw new Error("'기관명'과 '최종 회비' 열이 있는 시트를 찾지 못했습니다.");
      ui.cmp = { fileName: file.name, ...r };
      render();
    } catch (e) { toast(`읽기 실패: ${e.message}`); }
    el.value = '';
  },
  clearCmp: () => { ui.cmp = null; render(); },
  pick: (d) => { root.querySelector(`#${d.arg}`)?.click(); },
};

function addOrgNames(names, fromFile = false) {
  const b = biz();
  const mode = dec(b, 'D-15').value;
  const known = new Set(b.orgs.map((o) => normalizeName(o.name, mode)));
  let added = 0;
  for (const name of names) {
    const key = normalizeName(name, mode);
    if (!key || known.has(key)) continue;
    known.add(key);
    b.orgs.push({ id: uid('org'), name: name.trim(), active: true, postOffice: /우체국/.test(key) && !b.orgs.some((o) => o.postOffice) });
    added += 1;
  }
  if (!fromFile && added === 0) toast('이미 등록된 이름입니다.');
  commit();
  return added;
}

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.matches('input, select, textarea') && el.dataset.act === undefined) return;
  if (el.tagName === 'INPUT' && el.type === 'checkbox' && !el.dataset.act) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el.dataset, el, e);
});
root.addEventListener('change', (e) => {
  const f = e.target.closest('[data-field]');
  if (f) { setField(f); commit(); return; }
  const a = e.target.closest('[data-on-change]');
  if (a) actions[a.dataset.onChange]?.(a.dataset, a, e);
});
root.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'newOrgName') actions.addOrg();
  if (e.key === 'Enter' && e.target.id === 'newItemName') actions.addItem();
  if (e.key === 'Escape' && ui.detail) actions.closeDetail();
});

save();
render();
