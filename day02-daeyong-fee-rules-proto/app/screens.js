// 화면 1~6 + 병행검증. 모두 HTML 문자열을 돌려주는 순수 함수.
import { esc, n, won, signed, badge, rule, select, issuesList, field, STATUS_KO } from './html.js';
import { DECISIONS, dec, describeDecision, decisionById } from '../rules/decisions.js';
import { QUARTER_METHODS } from '../rules/schedule.js';
import { EQUAL_METHODS } from '../rules/allocate.js';
import { STATUS } from '../rules/verify.js';
import { bpToPercent, ROUNDING_MODES } from '../rules/money.js';
import { ROLE_LABELS, roleLabel, normalizeName } from '../rules/importer.js';
import { runBusiness as runV4 } from '../reference/v4-engine/pipeline.js';
import { toV4Business, compareRuns } from '../rules/compat.js';
import V4_COMMIT from '../reference/v4-engine/COMMIT.txt';

const TABS = [
  ['orgs', '1 업무·참가기관'], ['cond', '2 산출 조건'], ['data', '3 실적 데이터'], ['adjust', '4 금액 보정'], ['result', '5 산출 결과'], ['cross', '7 병행검증'],
];

export function renderShell({ state, b, run, ui, preview }) {
  const screen = { orgs, cond, data, adjust, result, cross }[ui.tab] ?? orgs;
  return `
    <div class="top">
      <div>
        <h1>회비 산출 규칙 프로토타입 <small class="muted">공통 규칙 초안 R-1~R-15 · D-1~D-15</small></h1>
        <small class="muted">${ui.canSave ? `설정과 데이터는 이 브라우저에만 저장됩니다${ui.savedAt ? ` (${ui.savedAt.toLocaleTimeString('ko-KR')})` : ''}.` : '이 화면에서는 저장할 수 없습니다. 업무 화면의 설정 내보내기를 쓰세요.'} 실제 데이터는 서버로 전송되지 않습니다.</small>
      </div>
      <div class="row">
        ${select('data-on-change="selectBiz"', state.businesses.map((x) => ({ value: x.id, label: x.name })), b.id)}
        ${badge(run.status, `검증 ${STATUS[run.status]}`)}
        <span class="muted">${b.cond.year}년 ${b.cond.quarter}분기 · 청구 대상 <b>${won(run.T)}</b></span>
      </div>
    </div>
    <div class="tabs">${TABS.map(([id, label]) => `<button class="${ui.tab === id ? 'on' : ''}" data-act="tab" data-arg="${id}">${label}</button>`).join('')}</div>
    ${screen({ state, b, run, ui, preview })}
    ${ui.detail ? detail({ b, run, ui }) : ''}
    ${ui.toast ? `<div class="toast">${esc(ui.toast)}</div>` : ''}
  `;
}

// 담당자 확인 항목 한 줄 (값 선택 + 확인 버튼)
function decisionRow(b, id, extra = '') {
  const d = decisionById[id];
  const v = dec(b, id);
  return `<div class="decision ${v.confirmed ? 'confirmed' : ''}">
    <div class="t">${rule(id)} <b>${esc(d.title)}</b><br><small class="muted">${esc(describeDecision(b, d))}</small></div>
    ${select(`data-field="decisions.${id}.value" data-type="${typeof d.def === 'number' || id === 'D-3' ? 'intOrNull' : 'str'}"`, d.options, v.value)}
    ${extra}
    ${v.confirmed ? `${badge('ok', '확인함')} <button data-act="unconfirm" data-arg="${id}">취소</button>` : `${badge('warn', '확인 필요')} <button class="primary" data-act="confirm" data-arg="${id}">이 값으로 확인</button>`}
  </div>`;
}

// ── 화면 1 ─────────────────────────────────────────────────────────
function orgs({ b, run }) {
  const active = b.orgs.filter((o) => o.active);
  return `
  <div class="panel">
    <h2>업무</h2>
    <div class="row">
      <b>${esc(b.name)}</b>
      <button data-act="renameBiz">이름 변경</button>
      <button data-act="newBiz">새 업무</button>
      <button data-act="dupBiz">복제</button>
      <button class="danger" data-act="delBiz">삭제</button>
      <span class="muted">|</span>
      <button data-act="exportSettings">설정 내보내기 (JSON)</button>
      <button data-act="pick" data-arg="importFile">설정 불러오기 (이 프로토타입 또는 v4 JSON)</button>
      <input id="importFile" type="file" accept=".json,application/json" hidden data-on-change="importSettings">
      <button data-act="resetSample">예시로 되돌리기</button>
    </div>
    <p class="inline-note">${rule('R-2.1')} 업무마다 참가기관·실적 항목·산출 옵션·실적 데이터를 따로 가집니다. v4 프로그램의 "설정 내보내기" JSON을 불러오면 같은 입력으로 병행검증할 수 있습니다.</p>
  </div>
  <div class="panel">
    <h2>참가기관 <small class="muted">분담 대상 ${active.length}곳 / 등록 ${b.orgs.length}곳</small></h2>
    <div class="row" style="margin-bottom:8px">
      <input id="newOrgName" type="text" placeholder="기관명 한 건 입력 후 Enter">
      <button data-act="addOrg">추가</button>
      <button data-act="pick" data-arg="orgFile">엑셀에서 기관명 불러오기</button>
      <input id="orgFile" type="file" accept=".xlsx,.xls,.csv" hidden data-on-change="importOrgNames">
      <span class="inline-note">${rule('R-10.7')} 실적 엑셀을 올리면 없는 기관은 적용할 때 자동 등록되므로 여기서 일일이 입력하지 않아도 됩니다.</span>
    </div>
    <details><summary class="muted">여러 건 붙여넣기</summary>
      <textarea id="newOrgNames" placeholder="한 줄에 한 기관"></textarea>
      <button data-act="addOrgs">모두 추가</button>
    </details>
    <div class="tbl"><table>
      <thead><tr><th>#</th><th>기관명</th><th>분담 대상</th><th>우체국</th><th>실적</th><th></th></tr></thead>
      <tbody>${b.orgs.map((o, i) => `<tr>
        <td class="n">${i + 1}</td>
        <td><input type="text" value="${esc(o.name)}" data-field="org:${o.id}:name"></td>
        <td><input type="checkbox" ${o.active ? 'checked' : ''} data-field="org:${o.id}:active" data-type="bool"></td>
        <td><input type="radio" name="po" ${o.postOffice ? 'checked' : ''} data-act="setPostOffice" data-arg="${o.id}"></td>
        <td class="muted">${b.perf[o.id] ? '있음' : '없음'}</td>
        <td class="row"><button data-act="moveOrg" data-arg="${o.id}" data-dir="-1" title="위로">↑</button><button data-act="moveOrg" data-arg="${o.id}" data-dir="1" title="아래로">↓</button><button class="danger" data-act="delOrg" data-arg="${o.id}">삭제</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">참가기관이 없습니다. 실적 엑셀을 올리거나 이름을 입력하세요.</td></tr>'}</tbody>
    </table></div>
    <p class="inline-note">${rule('R-11.2')} 분담 대상을 바꾸면 균등회비 분모와 실적 합계에 바로 반영됩니다. 우체국 라디오는 ${rule('R-7')} 대상 기관입니다${b.orgs.some((o) => o.postOffice) ? ` <button class="link" data-act="clearPostOffice">지정 해제</button>` : ''}. 목록 순서는 D-6·D-8의 "목록 순서" 배정에 쓰입니다.</p>
    ${decisionRow(b, 'D-14')}
  </div>`;
}

// ── 화면 2 ─────────────────────────────────────────────────────────
function cond({ b, run }) {
  const c = b.cond;
  const s = run.sch;
  const d1 = dec(b, 'D-1');
  return `
  <div class="grid2">
  <div class="panel">
    <h2>산출 대상과 연간 회비 ${rule('R-4')}</h2>
    <div class="grid">
      ${field('산출 연도', `<input type="number" value="${c.year}" data-field="cond.year" data-type="int">`)}
      ${field('산출 대상 분기', select('data-field="cond.quarter" data-type="int"', [1, 2, 3, 4].map((q) => ({ value: q, label: `${q}분기` })), c.quarter))}
      ${field('A 당초 연간 회비 (원)', `<input type="text" class="num" value="${n(c.A)}" data-field="cond.A" data-type="int">`)}
      ${field('B 전기이월잉여금 (원)', `<input type="text" class="num" value="${n(c.B)}" data-field="cond.B" data-type="int">`, `<label><input type="checkbox" ${c.bConfirmed ? 'checked' : ''} data-field="cond.bConfirmed" data-type="bool"> 결산으로 확정됨</label>`)}
      ${field('C 1분기 기청구 회비 (원)', `<input type="text" class="num" value="${d1.value === 'manual' && c.C != null ? n(c.C) : ''}" placeholder="${n(s.C)} (자동)" data-field="cond.C" data-type="intOrNull" ${d1.value === 'manual' ? '' : 'disabled'}>`, `${rule('R-1.6')} 이미 청구한 1분기는 바꾸지 않습니다`)}
    </div>
    ${decisionRow(b, 'D-1')}
    <h3>분기 배분 방식 ${rule('R-4.3')}</h3>
    <div class="choice">${['A', 'B'].map((m) => `<label class="${c.quarterMethod === m ? 'on' : ''}"><input type="radio" name="qm" value="${m}" ${c.quarterMethod === m ? 'checked' : ''} data-field="cond.quarterMethod"> ${esc(QUARTER_METHODS[m])}</label>`).join('')}</div>
    <div class="tbl" style="margin-top:10px"><table>
      <thead><tr><th>분기</th><th class="n">청구 대상 총액</th><th>계산식</th></tr></thead>
      <tbody>${s.quarters.map((q) => `<tr ${q.q === c.quarter ? 'style="font-weight:600"' : ''}><td>${q.q}분기${q.q === c.quarter ? ' ◀' : ''}</td><td class="n">${won(q.amount)}</td><td class="formula">${esc(q.formula)}</td></tr>`).join('')}
      <tr class="total"><td>합계</td><td class="n">${won(s.sum)}</td><td>${s.balanced ? badge('ok', 'D와 일치') : `${badge('fail', `D와 ${won(s.diff)} 차이`)} <span class="muted">D-3에서 반영할 분기를 고르세요</span>`}</td></tr></tbody>
    </table></div>
    <p class="formula">D = A − B = ${won(s.D)} · E = D − C = ${won(s.E)}</p>
    ${decisionRow(b, 'D-2')}
    ${decisionRow(b, 'D-3')}
    ${decisionRow(b, 'D-13')}
  </div>
  <div class="panel">
    <h2>회비 구성 ${rule('R-3')}</h2>
    <div class="grid">
      ${field('균등회비 비율 (%)', `<input type="text" class="num" value="${bpToPercent(c.equalBp).replace('%', '')}" data-field="cond.equalBp" data-type="bp">`)}
      ${field('실적회비 비율 (%)', `<input type="text" class="num" value="${bpToPercent(c.perfBp).replace('%', '')}" data-field="cond.perfBp" data-type="bp">`, c.equalBp + c.perfBp === 10000 ? '합계 100%' : `<span style="color:var(--fail)">합계 ${bpToPercent(c.equalBp + c.perfBp)} — 100%여야 합니다 (R-3.2)</span>`)}
    </div>
    <h3>균등회비 방식 ${rule('R-5')}</h3>
    <div class="choice">${['A', 'B'].map((m) => `<label class="${c.equalMethod === m ? 'on' : ''}"><input type="radio" name="em" value="${m}" ${c.equalMethod === m ? 'checked' : ''} data-field="cond.equalMethod"> ${esc(EQUAL_METHODS[m])}<br><small class="muted">${m === 'A' ? '균등회비 총액 = T × 비율을 정확히 맞추고 기관별로 ±1원 차이를 허용' : '모든 기관이 같은 금액. 실제 비율이 설정 비율과 조금 달라지고, 차이는 실적회비 총액으로 흡수'}</small></label>`).join('')}</div>
    ${c.equalMethod === 'A' ? decisionRow(b, 'D-4') : decisionRow(b, 'D-7', `<span class="row">단위 ${select('data-field="decisions.D-7.unit" data-type="int"', [1, 10, 100, 1000, 10000].map((u) => ({ value: u, label: `${n(u)}원` })), dec(b, 'D-7').unit)} ${select('data-field="decisions.D-7.rounding"', Object.entries(ROUNDING_MODES).map(([value, label]) => ({ value, label })), dec(b, 'D-7').rounding)} 금액 <input type="text" class="num sm" value="${n(dec(b, 'D-7').amount)}" data-field="decisions.D-7.amount" data-type="int" ${dec(b, 'D-7').value === 'manual' ? '' : 'disabled'}></span>`)}
    ${run.alloc ? `<p class="formula">균등회비 총액 ${won(run.alloc.equal.pool)} (실제 ${run.alloc.equal.actualPercent}, 설정 ${run.alloc.equal.setPercent}) · 실적회비 총액 ${won(run.alloc.perf.pool)}</p>` : ''}
    <h3>실적 인정 항목 ${rule('R-6.2')}</h3>
    ${b.items.length ? '' : `<p class="inline-note">아직 실적 항목이 없습니다. <b>3 실적 데이터</b>에서 엑셀을 올리면 파일의 건수 열(예: 압류·추심·해제, API 호출건수 등)이 자동으로 실적 항목이 되고 모두 인정 항목으로 들어옵니다. 필요하면 아래에서 직접 추가할 수도 있습니다.</p>`}
    <div class="choice">${b.items.map((it) => `<label class="${b.recognized.includes(it.id) ? 'on' : ''}"><input type="checkbox" ${b.recognized.includes(it.id) ? 'checked' : ''} data-act="toggleRecognized" data-arg="${it.id}"> <input type="text" value="${esc(it.name)}" data-on-change="renameItem" data-arg="${it.id}" style="flex:1"> <button class="danger" data-act="delItem" data-arg="${it.id}">삭제</button></label>`).join('')}</div>
    <div class="row" style="margin-top:8px"><input id="newItemName" type="text" placeholder="새 실적 항목 (예: API 호출건수)"><button data-act="addItem">항목 추가</button></div>
    <p class="inline-note">인정 실적 = 체크한 항목 건수의 합. 바꾸면 즉시 다시 계산됩니다 (R-6.3). 항목 이름은 엑셀 머리글에서 가져오며 여기서 고칠 수 있습니다.</p>
    <h3>실적 기준기간 ${rule('R-10.3')}</h3>
    <div class="grid">
      ${field('시작일', `<input type="date" value="${esc(c.perfPeriod.start)}" data-field="cond.perfPeriod.start">`)}
      ${field('종료일', `<input type="date" value="${esc(c.perfPeriod.end)}" data-field="cond.perfPeriod.end">`, '업무별로 다르므로 분기에 고정하지 않습니다')}
    </div>
  </div></div>`;
}

// ── 화면 3 ─────────────────────────────────────────────────────────
function data({ b, run, ui, preview }) {
  const u = ui.upload;
  const active = b.orgs.filter((o) => o.active);
  const uploadPanel = `
  <div class="panel">
    <h2>엑셀 실적 업로드 ${rule('R-10.1')}</h2>
    <div class="row">
      <button class="primary" data-act="pick" data-arg="perfFile">엑셀 파일 선택 (.xlsx)</button>
      <input id="perfFile" type="file" accept=".xlsx,.xls,.csv" hidden data-on-change="uploadPerf">
      <button data-act="downloadTemplate">업로드 양식 내려받기</button>
      <label><input type="checkbox" ${b.cond.autoAddOrgs ? 'checked' : ''} data-field="cond.autoAddOrgs" data-type="bool"> 없는 기관명은 적용할 때 자동 등록 (R-10.7)</label>
    </div>
    <p class="inline-note">업로드 → 열 매핑 → 검증 → 미리보기·수정 → "실적 데이터 적용" 순서로 진행합니다. 파일의 건수 열은 적용할 때 실적 항목으로 자동 등록되어 산출 조건의 인정 항목에 들어갑니다. 파일은 이 브라우저 안에서만 읽습니다.</p>
    ${decisionRow(b, 'D-11')}${decisionRow(b, 'D-12')}${decisionRow(b, 'D-15')}
  </div>`;

  if (!u) {
    return uploadPanel + `
    <div class="panel">
      <h2>적용된 실적 데이터 ${rule('R-10.6')}</h2>
      ${b.perfMeta ? `<p class="muted">${esc(b.perfMeta.fileName)}${b.perfMeta.sheet ? ` · ${esc(b.perfMeta.sheet)}` : ''} · 기준기간 ${esc(b.perfMeta.start || '-')} ~ ${esc(b.perfMeta.end || '-')} · 적용 ${esc(b.perfMeta.appliedAt)}${b.perfMeta.edited ? ' · 적용 후 수정됨' : ''}${b.perfMeta.sample ? ' · 예시 데이터' : ''} <button data-act="clearPerf">지우기</button></p>` : '<p class="muted">아직 적용한 실적이 없습니다.</p>'}
      <div class="tbl"><table>
        <thead><tr><th>기관명</th>${b.items.map((it) => `<th class="n">${esc(it.name)}${b.recognized.includes(it.id) ? '' : ' <small>(미인정)</small>'}</th>`).join('')}<th class="n">인정 실적</th></tr></thead>
        <tbody>${active.map((o) => { const rec = b.recognized.reduce((s, id) => s + (b.perf[o.id]?.[id] ?? 0), 0); return `<tr><td>${esc(o.name)}${b.perf[o.id] ? '' : ' <small class="muted">(파일에 없음 · D-11)</small>'}</td>${b.items.map((it) => `<td class="n"><input type="text" class="num sm" value="${n(b.perf[o.id]?.[it.id] ?? 0)}" data-on-change="editPerf" data-arg="${o.id}" data-item="${it.id}"></td>`).join('')}<td class="n">${n(rec)}</td></tr>`; }).join('')}
        <tr class="total"><td>합계</td>${b.items.map((it) => `<td class="n">${n(active.reduce((s, o) => s + (b.perf[o.id]?.[it.id] ?? 0), 0))}</td>`).join('')}<td class="n">${n(run.alloc?.perf.totalRecognized ?? 0)}</td></tr></tbody>
      </table></div>
      <p class="inline-note">값을 고치면 인정 실적과 실적회비가 바로 다시 계산됩니다.</p>
    </div>`;
  }

  const sheet = u.sheets[u.sheetIdx];
  const headers = sheet.aoa[u.headerIdx] ?? [];
  const roleOptions = [{ value: 'org', label: ROLE_LABELS.org }, ...b.items.map((it) => ({ value: `item:${it.id}`, label: `실적 항목: ${it.name}` })), { value: 'total', label: ROLE_LABELS.total }, { value: 'period', label: ROLE_LABELS.period }, { value: 'year', label: ROLE_LABELS.year }, { value: 'new', label: ROLE_LABELS.new }, { value: 'ignore', label: ROLE_LABELS.ignore }];
  const statusBadge = { ok: badge('ok', '등록 기관'), linked: badge('ok', '연결함'), new: badge('info', '신규 → 자동 등록'), unlinked: badge('warn', '미등록'), excluded: badge('info', '제외'), inactive: badge('warn', '분담 제외 기관') };
  return uploadPanel + `
  <div class="panel">
    <h2>① 업로드 정보 <small class="muted">${esc(u.fileName)}</small> <button data-act="cancelUpload">취소</button></h2>
    <div class="grid">
      ${field('시트', select('data-on-change="selectSheet"', u.sheets.map((s, i) => ({ value: i, label: `${s.name} (${s.aoa.length}행)` })), u.sheetIdx))}
      ${field('머리글 행 번호', `<input type="number" min="1" value="${u.headerIdx + 1}" data-on-change="setHeaderRow">`, '자동으로 찾았습니다. 다르면 고치세요')}
      ${field('산출 연도', `<input type="number" value="${u.info.year}" data-on-change="setUploadInfo" data-arg="year">`)}
      ${field('산출 대상 분기', select('data-on-change="setUploadInfo" data-arg="quarter"', [1, 2, 3, 4].map((q) => ({ value: q, label: `${q}분기` })), u.info.quarter))}
      ${field('실적 시작일', `<input type="date" value="${esc(u.info.start)}" data-on-change="setUploadInfo" data-arg="start">`)}
      ${field('실적 종료일', `<input type="date" value="${esc(u.info.end)}" data-on-change="setUploadInfo" data-arg="end">`, '기간 열이 있으면 이 범위 밖 행은 제외')}
      ${field('적용 업무명', `<input type="text" value="${esc(b.name)}" disabled>`)}
    </div>
  </div>
  <div class="panel">
    <h2>② 열 매핑 ${rule('R-10.2')} <small class="muted">같은 양식은 적용할 때 매핑이 저장되어 다음에 자동으로 붙습니다</small></h2>
    <div class="tbl"><table>
      <thead><tr><th>엑셀 열</th><th>예시 값</th><th>역할</th></tr></thead>
      <tbody>${headers.map((h, i) => `<tr><td><b>${esc(h ?? '(빈 머리글)')}</b></td><td class="muted">${esc(sheet.aoa.slice(u.headerIdx + 1, u.headerIdx + 4).map((r) => r?.[i]).filter((v) => v !== null && v !== undefined && v !== '').slice(0, 3).join(', '))}</td><td class="row">${select(`data-on-change="setMapping" data-arg="${i}"`, roleOptions, u.mapping[i] ?? 'ignore')}${u.mapping[i] === 'new' ? `<span class="inline-note">적용할 때 실적 항목 '${esc(h)}'(으)로 등록</span>` : ''}</td></tr>`).join('')}</tbody>
    </table></div>
  </div>
  <div class="panel">
    <h2>③ 검증 ${rule('R-10.4')} ${preview.canApply ? badge('ok', '적용 가능') : badge('fail', '오류 해결 필요')}</h2>
    ${issuesList(preview.issues) || '<p class="muted">문제 없음</p>'}
    <p class="muted">파일 행 ${n(preview.stats.fileRows)} · 기관 ${n(preview.stats.orgCount)}곳 (신규 ${preview.stats.newOrgCount} · 미등록 ${preview.stats.unlinkedCount} · 제외 ${preview.stats.excludedCount}) · 분담 대상 ${n(preview.stats.activeOrgCount)}곳 (파일에 없음 ${preview.stats.missingOrgCount}) · 인정 실적 합계 ${n(preview.stats.recognizedTotal)}건</p>
  </div>
  <div class="panel">
    <h2>④ 미리보기·수정 ${rule('R-10.6')}</h2>
    <div class="tbl"><table>
      <thead><tr><th>파일 기관명</th><th>상태 / 연결</th>${preview.itemCols.map((c) => `<th class="n">${esc(c.name)}${c.isNew ? ' <small>(새 항목)</small>' : ''}</th>`).join('')}<th class="n">인정 실적</th><th class="n">파일 합계</th><th>행</th></tr></thead>
      <tbody>${preview.rows.map((r) => {
        const linkOptions = [{ value: '__new__', label: b.cond.autoAddOrgs ? '새 기관으로 등록' : '연결 안 함 (적용에서 제외)' }, ...b.orgs.map((o) => ({ value: o.id, label: `기존: ${o.name}` })), { value: '', label: '제외' }];
        const linkSel = r.status === 'new' || r.status === 'unlinked' || r.status === 'excluded' || r.status === 'linked'
          ? select(`data-on-change="setNameMap" data-arg="${esc(r.name)}"`, linkOptions, u.nameMap[r.name] === undefined ? '__new__' : u.nameMap[r.name])
          : '';
        return `<tr><td><b>${esc(r.name)}</b></td><td>${statusBadge[r.status] ?? r.status} ${linkSel}</td>${preview.itemCols.map((c) => { const err = r.errors.find((e) => e.itemId === c.itemId); return `<td class="n"><input type="text" class="num sm" value="${esc(u.edits[r.name]?.[c.itemId] ?? n(r.counts[c.itemId]))}" data-on-change="editCount" data-arg="${esc(r.name)}" data-item="${c.itemId}" ${err ? 'style="border-color:var(--fail)"' : ''} ${r.srcRows.length > 1 ? 'disabled title="여러 행을 합산한 값은 적용 후 수정하세요"' : ''}></td>`; }).join('')}<td class="n">${n(r.recognizedSum)}</td><td class="n">${r.fileTotal === null ? '-' : n(r.fileTotal)}</td><td class="muted">${r.srcRows.join(', ')}</td></tr>`;
      }).join('')}</tbody>
    </table></div>
    <div class="row" style="margin-top:10px">
      <button class="primary" data-act="applyPerf" ${preview.canApply ? '' : 'disabled'}>실적 데이터 적용</button>
      <button data-act="cancelUpload">취소</button>
      <span class="inline-note">적용하면 산출 연도·분기·기준기간이 위 값으로 바뀌고${b.cond.autoAddOrgs ? ', 신규 기관은 참가기관으로 등록되며' : ''}, 인정 항목 기준으로 실적회비가 바로 계산됩니다.</span>
    </div>
  </div>`;
}

// ── 화면 4 ─────────────────────────────────────────────────────────
function adjust({ b, run }) {
  const a = run.alloc;
  const active = b.orgs.filter((o) => o.active);
  const orgChecks = (id, selected) => `<div class="row" style="margin:6px 0 0 8px">${active.map((o) => `<label><input type="checkbox" ${selected.includes(o.id) ? 'checked' : ''} data-act="${id}" data-arg="${o.id}"> ${esc(o.name)}</label>`).join('')}</div>`;
  const poRow = a?.po.enabled ? a.rows.find((r) => r.id === a.po.orgId) : null;
  const cp = a?.po.counterpartId ? a.rows.find((r) => r.id === a.po.counterpartId) : null;
  return `
  <div class="grid2">
  <div class="panel">
    <h2>균등회비 원 단위 조정 ${rule('R-5.1')}</h2>
    ${b.cond.equalMethod === 'A' ? `
      ${a ? `<p class="formula">균등회비 총액 ${won(a.equal.pool)} ÷ ${active.length}곳 = 기본 ${won(a.equal.base ?? 0n)} · 차액 ${signed(a.equal.diff)} → ${a.equal.targets.length}곳에 ${a.equal.diff < 0n ? '−1원' : '+1원'}씩</p>` : ''}
      ${decisionRow(b, 'D-5')}
      ${decisionRow(b, 'D-6')}
      ${dec(b, 'D-6').value === 'manual' ? orgChecks('toggleD6', dec(b, 'D-6').orgIds) : ''}
    ` : `<p class="muted">균등회비 방식 B(기관별 동일 금액)에서는 원 단위 조정이 없습니다. 금액 단위와 처리는 산출 조건 화면의 D-7에서 정합니다.</p>`}
    <h2 style="margin-top:16px">실적회비 원 단위 잔액 ${rule('R-6.5')}</h2>
    ${a && a.perf.leftover !== undefined ? `<p class="formula">실적회비 총액 ${won(a.perf.pool)} − 기관별 원 미만 버림 합계 = 잔액 ${won(a.perf.leftover)} → ${a.perf.leftoverTargets.length}곳에 1원씩</p>` : ''}
    ${decisionRow(b, 'D-8')}
    ${dec(b, 'D-8').value === 'manual' ? orgChecks('toggleD8', dec(b, 'D-8').orgIds) : ''}
  </div>
  <div class="panel">
    <h2>우체국 특수 처리 ${rule('R-7')}</h2>
    <label><input type="checkbox" ${b.cond.postOffice ? 'checked' : ''} data-field="cond.postOffice" data-type="bool"> 적용 (우체국 최종 청구액의 1원 자리를 0으로)</label>
    <p class="inline-note">대상 기관: ${b.orgs.find((o) => o.postOffice)?.name ? `<b>${esc(b.orgs.find((o) => o.postOffice).name)}</b>` : '<span style="color:var(--warn)">미지정 — 참가기관 화면에서 우체국 라디오를 고르세요</span>'}. 보정은 균등회비가 아니라 실적회비에서 합니다 (R-7.3).</p>
    ${b.cond.postOffice ? `${decisionRow(b, 'D-9')}${decisionRow(b, 'D-10', dec(b, 'D-10').value === 'manual' ? select('data-field="decisions.D-10.orgId"', [{ value: '', label: '기관 선택' }, ...active.filter((o) => !o.postOffice).map((o) => ({ value: o.id, label: o.name }))], dec(b, 'D-10').orgId ?? '') : '')}` : ''}
    ${poRow ? `<h3>조정 전후 ${rule('R-7.5')}</h3><div class="tbl"><table>
      <thead><tr><th>기관</th><th class="n">조정 전</th><th class="n">조정</th><th class="n">조정 후</th></tr></thead>
      <tbody>
        <tr><td>${esc(poRow.name)} (우체국)</td><td class="n">${won(a.po.before)}</td><td class="n">${signed(a.po.delta)}</td><td class="n">${won(a.po.after)}</td></tr>
        ${cp ? `<tr><td>${esc(cp.name)} (반대 조정)</td><td class="n">${won(cp.final + a.po.delta)}</td><td class="n">${signed(-a.po.delta)}</td><td class="n">${won(cp.final)}</td></tr>` : ''}
        <tr class="total"><td>전체 합계</td><td class="n">${won(a.T)}</td><td class="n">0원</td><td class="n">${won(a.rows.reduce((s, r) => s + r.final, 0n))}</td></tr>
      </tbody></table></div>` : ''}
  </div></div>
  <div class="panel">
    <h2>재검증 ${rule('R-12')}</h2>
    ${checksTable(run)}
  </div>`;
}

function checksTable(run) {
  return `<div class="tbl"><table>
    <thead><tr><th>결과</th><th>규칙</th><th>검증 항목</th><th class="n">기대</th><th class="n">실제</th><th class="n">차이</th><th>원인 · 대상</th></tr></thead>
    <tbody>${run.checks.map((k) => `<tr><td>${badge(k.status, STATUS[k.status])}</td><td>${rule(k.rule)}</td><td>${esc(k.label)}</td><td class="n">${n(k.expected)}</td><td class="n">${n(k.actual)}</td><td class="n">${k.diff === 0n ? '' : n(k.diff)}</td><td class="muted">${esc(k.cause)}${k.targets ? ` → ${esc(k.targets)}` : ''}</td></tr>`).join('')}</tbody>
  </table></div>${issuesList(run.issues)}`;
}

// ── 화면 5 ─────────────────────────────────────────────────────────
function result({ b, run }) {
  const a = run.alloc;
  const rows = a?.rows ?? [];
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0n);
  return `
  <div class="cards">
    <div class="card"><div class="k">청구 대상 총액 (${b.cond.quarter}분기)</div><div class="v">${won(run.T)}</div></div>
    <div class="card"><div class="k">균등회비 총액 ${a ? `(${a.equal.actualPercent})` : ''}</div><div class="v">${won(a?.equal.pool)}</div></div>
    <div class="card"><div class="k">실적회비 총액</div><div class="v">${won(a?.perf.pool)}</div></div>
    <div class="card"><div class="k">분담 기관 수</div><div class="v">${rows.length}곳</div></div>
    <div class="card"><div class="k">검증</div><div class="v">${badge(run.status, STATUS[run.status])}</div><small class="muted">확인 필요 항목 ${run.pending.length}개</small></div>
  </div>
  <div class="panel">
    <div class="row" style="justify-content:space-between"><h2>기관별 회비 ${rule('R-14.1')}</h2><button class="primary" data-act="downloadResult">결과 엑셀 내려받기 (R-14.2)</button></div>
    <div class="tbl"><table>
      <thead><tr><th>#</th><th>기관명</th><th class="n">인정 실적</th><th class="n">실적 점유율</th><th class="n">균등회비</th><th class="n">실적회비</th><th class="n">조정금액</th><th class="n">최종 회비</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr><td class="n">${i + 1}</td><td><button class="link" data-act="detail" data-arg="${r.id}">${esc(r.name)}</button>${r.id === a.po.orgId && a.po.enabled ? ' <small class="muted">우체국</small>' : ''}</td><td class="n">${n(r.recognized)}</td><td class="n">${r.share ?? '-'}</td><td class="n">${won(r.equalFinal)}</td><td class="n">${won(r.perfFinal)}</td><td class="n">${r.adjust === 0n ? '' : signed(r.adjust)}</td><td class="n"><b>${won(r.final)}</b></td></tr>`).join('') || '<tr><td colspan="8" class="muted">분담 대상 기관이 없습니다.</td></tr>'}
      ${rows.length ? `<tr class="total"><td></td><td>합계 (${rows.length}곳)</td><td class="n">${n(a.perf.totalRecognized)}</td><td></td><td class="n">${won(sum('equalFinal'))}</td><td class="n">${won(sum('perfFinal'))}</td><td class="n">${signed(sum('adjust'))}</td><td class="n">${won(sum('final'))}</td></tr>
      <tr class="total"><td></td><td>청구 대상 총액</td><td colspan="5"></td><td class="n">${won(run.T)} ${sum('final') === run.T ? badge('ok', '일치') : badge('fail', `차액 ${won(sum('final') - run.T)}`)}</td></tr>` : ''}</tbody>
    </table></div>
    <p class="inline-note">기관명을 누르면 산출 근거(R-13)를 봅니다.</p>
  </div>
  <div class="panel"><h2>검증 ${rule('R-12')}</h2>${checksTable(run)}</div>
  <div class="panel">
    <h2>담당자 확인 필요 항목 ${rule('9장')} <small class="muted">${run.pending.length}개 남음</small></h2>
    ${run.pending.length ? run.pending.map((d) => decisionRow(b, d.id)).join('') : '<p class="muted">이 업무의 확인 항목을 모두 확인했습니다.</p>'}
  </div>`;
}

// ── 화면 6: 기관별 산출 근거 ─────────────────────────────────────────
function detail({ b, run, ui }) {
  const a = run.alloc;
  const r = a?.rows.find((x) => x.id === ui.detail);
  if (!r) return '';
  const idx = a.rows.indexOf(r);
  const line = (l) => `<li>${rule(l.rule)} ${esc(l.label)}: <b>${typeof l.value === 'bigint' ? won(l.value) : esc(l.value)}</b>${l.formula ? ` <span class="formula">= ${esc(l.formula)}</span>` : ''}</li>`;
  return `<div class="modal-bg" data-act="closeDetail"><div class="modal" onclick="event.stopPropagation()">
    <div class="row" style="justify-content:space-between">
      <h2>${esc(r.name)} 회비 산출 상세내역 ${rule('R-13')}</h2>
      <div class="row"><button data-act="prevOrg" ${idx === 0 ? 'disabled' : ''}>◀ 이전</button><button data-act="nextOrg" ${idx === a.rows.length - 1 ? 'disabled' : ''}>다음 ▶</button><button data-act="closeDetail">닫기</button></div>
    </div>
    <p class="muted">기관명 ${esc(r.name)} · 산출 ${b.cond.year}년 ${b.cond.quarter}분기 · 업무 ${esc(b.name)}</p>
    <div class="cards">
      <div class="card"><div class="k">최종 균등회비</div><div class="v">${won(r.equalFinal)}</div></div>
      <div class="card"><div class="k">최종 실적회비</div><div class="v">${won(r.perfFinal)}</div></div>
      <div class="card"><div class="k">최종 청구금액</div><div class="v">${won(r.final)}</div></div>
    </div>
    <h3>1. 균등회비 산출 (분기 총액 ${won(a.T)} · 비율 ${a.equal.setPercent} · 대상 ${a.rows.length}곳)</h3>
    <ul class="steps">${r.trace.equal.map(line).join('')}</ul>
    <h3>2. 실적회비 산출 (실적회비 총액 ${won(a.perf.pool)} · 인정 항목 ${esc(a.perf.recognizedNames.join(' + ') || '없음')})</h3>
    <ul class="steps">${b.items.map((it) => `<li>${esc(it.name)}: ${n(r.counts[it.id])}건${b.recognized.includes(it.id) ? '' : ' <small class="muted">(미인정)</small>'}</li>`).join('')}${r.trace.perf.map(line).join('')}</ul>
    <h3>3. 회비 조정 내역</h3>
    ${r.trace.adjust.length ? `<ul class="steps">${r.trace.adjust.map((l) => `<li>${rule(l.rule)} ${esc(l.label)}: <b>${signed(l.value)}</b> <span class="formula">— ${esc(l.formula)}</span></li>`).join('')}</ul>` : '<p class="muted">조정 없음</p>'}
    <h3>4. 최종 청구금액</h3>
    <p>균등회비 ${won(r.equalFinal)} + 실적회비 ${won(r.perfFinal)} = <b>${won(r.final)}</b></p>
    <h3>원본 데이터와 적용 옵션 ${rule('R-13.1')}</h3>
    <p class="muted">${b.perfMeta ? `${esc(b.perfMeta.fileName)} · 기준기간 ${esc(b.perfMeta.start || '-')} ~ ${esc(b.perfMeta.end || '-')}${b.perfMeta.edited ? ' · 적용 후 수정됨' : ''}` : '실적 파일 없음'}<br>
    ${esc(QUARTER_METHODS[b.cond.quarterMethod])} · ${esc(EQUAL_METHODS[b.cond.equalMethod])} · 우체국 처리 ${b.cond.postOffice ? `적용 (${a.po.direction === 'down' ? '내림' : '올림'})` : '안 함'}<br>
    ${DECISIONS.filter((d) => (!d.when || d.when(b)) && ['D-2', 'D-4', 'D-5', 'D-6', 'D-7', 'D-8', 'D-9', 'D-10'].includes(d.id)).map((d) => `${d.id} ${esc(describeDecision(b, d))}${dec(b, d.id).confirmed ? '' : ' <small>(확인 필요)</small>'}`).join(' · ')}</p>
  </div></div>`;
}

// ── 병행검증 ────────────────────────────────────────────────────────
function cross({ b, run, ui }) {
  let ref; let cmp; let err = '';
  try { ref = runV4(toV4Business(b)); cmp = compareRuns(run, ref); } catch (e) { err = e.message; }
  const cell = (x) => (x.mine === x.ref ? `<td class="n diff-same">${n(x.mine)}</td>` : `<td class="n diff-ne">${n(x.mine)} / ${n(x.ref)}${x.diff !== null ? ` (${signed(x.diff)})` : ''}</td>`);
  const fileCmp = ui.cmp ? fileCompare(b, run, ui.cmp) : null;
  return `
  <div class="panel">
    <h2>병행검증 ① 같은 입력으로 두 엔진 계산</h2>
    <p class="inline-note">이 프로토타입 엔진(공통 규칙 초안으로 새로 작성)과 v4 프로그램 엔진(day01-daeyong-fee-calculator, 커밋 ${esc(V4_COMMIT.trim())}, 복사본)을 지금 이 업무의 같은 입력으로 돌려 기관별 금액을 비교합니다. 셀이 "프로토 / v4 (차이)"로 보이면 다른 값입니다.</p>
    ${err ? `<p style="color:var(--fail)">v4 엔진 실행 오류: ${esc(err)}</p>` : `
    <p>${cmp.same ? badge('ok', '모든 금액 일치') : badge('fail', '차이 있음')} · 프로토 검증 ${badge(run.status, STATUS[run.status])} · v4 검증 ${badge(ref.status, STATUS[ref.status])}</p>
    <div class="tbl"><table>
      <thead><tr><th>분기</th>${cmp.quarters.map((q) => `<th class="n">${q.q}분기</th>`).join('')}<th class="n">T</th><th class="n">균등 총액</th><th class="n">실적 총액</th><th class="n">최종 합계</th></tr></thead>
      <tbody><tr><td>프로토 / v4</td>${cmp.quarters.map(cell).join('')}${cell(cmp.totals.T)}${cell(cmp.totals.equalPool)}${cell(cmp.totals.perfPool)}${cell(cmp.totals.sumFinal)}</tr></tbody>
    </table></div>
    <div class="tbl" style="margin-top:10px"><table>
      <thead><tr><th>기관명</th><th class="n">인정 실적</th><th class="n">균등회비</th><th class="n">실적회비</th><th class="n">최종 회비</th><th>결과</th></tr></thead>
      <tbody>${cmp.rows.map((r) => `<tr><td>${esc(r.name)}</td>${cell(r.recognized)}${cell(r.equal)}${cell(r.perf)}${cell(r.final)}<td>${r.same ? badge('ok', '일치') : badge('fail', r.diffs.join(', '))}</td></tr>`).join('')}</tbody>
    </table></div>
    ${cmp.status.mineFails.length || cmp.status.refFails.length ? `<p class="muted">불일치 검증 — 프로토: ${esc(cmp.status.mineFails.join('; ') || '없음')} / v4: ${esc(cmp.status.refFails.join('; ') || '없음')}</p>` : ''}`}
  </div>
  <div class="panel">
    <h2>병행검증 ② v4 프로그램이 내려준 결과 엑셀과 비교</h2>
    <p class="inline-note">실제 v4 화면에서 같은 데이터로 산출해 내려받은 "회비산출결과" 엑셀(또는 '기관명'·'최종 회비' 열이 있는 어떤 결과 파일)을 올리면 기관명 기준으로 이 프로토타입 결과와 맞춰 봅니다.</p>
    <div class="row"><button data-act="pick" data-arg="cmpFile">결과 엑셀 선택</button><input id="cmpFile" type="file" accept=".xlsx,.xls" hidden data-on-change="compareFile">${ui.cmp ? `<span class="muted">${esc(ui.cmp.fileName)} · ${esc(ui.cmp.sheet)}</span><button data-act="clearCmp">지우기</button>` : ''}</div>
    ${fileCmp ? `<p style="margin-top:8px">${fileCmp.allSame ? badge('ok', `${fileCmp.rows.length}곳 모두 일치`) : badge('fail', `${fileCmp.rows.filter((r) => !r.same).length}곳 차이`)}${fileCmp.onlyFile.length ? ` · 파일에만 있는 기관: ${esc(fileCmp.onlyFile.join(', '))}` : ''}${fileCmp.onlyMine.length ? ` · 프로토에만 있는 기관: ${esc(fileCmp.onlyMine.join(', '))}` : ''}</p>
    <div class="tbl"><table>
      <thead><tr><th>기관명</th><th class="n">균등회비 (프로토 / 파일)</th><th class="n">실적회비</th><th class="n">최종 회비</th><th>결과</th></tr></thead>
      <tbody>${fileCmp.rows.map((r) => `<tr><td>${esc(r.name)}</td>${['equal', 'perf', 'final'].map((k) => (r[k].ref === null ? `<td class="n muted">${n(r[k].mine)} / -</td>` : cell(r[k]))).join('')}<td>${r.same ? badge('ok', '일치') : badge('fail', '차이')}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}
  </div>
  <div class="panel">
    <h2>병행검증 ③ 자동 검증 (명령줄)</h2>
    <p class="inline-note"><code>npm test</code> 규칙 예시 테스트 22개, <code>npm run crosscheck</code> 예시 업무 2개 + 시드 고정 무작위 업무 500개를 두 엔진에 넣어 전부 비교합니다. 자세한 내용은 README.</p>
  </div>`;
}

function fileCompare(b, run, cmp) {
  const mode = dec(b, 'D-15').value;
  const mine = new Map((run.alloc?.rows ?? []).map((r) => [normalizeName(r.name, mode), r]));
  const file = new Map(cmp.rows.map((r) => [normalizeName(r.name, mode), r]));
  const rows = [];
  for (const [key, m] of mine) {
    const f = file.get(key);
    const col = (a, b2) => ({ mine: Number(a), ref: b2 ?? null, diff: b2 === null || b2 === undefined ? null : Number(a) - b2 });
    const row = { name: m.name, equal: col(m.equalFinal, f?.equal), perf: col(m.perfFinal, f?.perf), final: col(m.final, f?.final) };
    row.same = Boolean(f) && [row.equal, row.perf, row.final].every((x) => x.ref === null || x.diff === 0);
    rows.push(row);
  }
  return { rows, allSame: rows.every((r) => r.same) && rows.length > 0, onlyFile: [...file.keys()].filter((k) => !mine.has(k)).map((k) => file.get(k).name), onlyMine: rows.filter((r) => !file.has(normalizeName(r.name, mode))).map((r) => r.name) };
}
