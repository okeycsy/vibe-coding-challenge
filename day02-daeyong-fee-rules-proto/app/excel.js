// 엑셀 읽기·쓰기 (SheetJS). 계산은 하지 않는다.
import * as XLSX from 'xlsx';
import { dec, DECISIONS, describeDecision } from '../rules/decisions.js';
import { QUARTER_METHODS } from '../rules/schedule.js';
import { EQUAL_METHODS } from '../rules/allocate.js';
import { STATUS } from '../rules/verify.js';
import { bpToPercent } from '../rules/money.js';

export async function readWorkbook(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  return wb.SheetNames.map((name) => ({ name, aoa: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) }));
}

export async function saveFile(filename, data, mime = 'application/octet-stream') {
  if (typeof window !== 'undefined' && window.claude?.use) {
    const downloads = await window.claude.use('downloads');
    if (downloads) { await downloads.save({ filename, data }); return; }
    throw new Error('이 화면에서는 파일 저장을 쓸 수 없습니다.');
  }
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const sheet = (aoa, widths = []) => {
  const ws = XLSX.utils.aoa_to_sheet(aoa.map((r) => r.map((v) => (typeof v === 'bigint' ? Number(v) : v))));
  if (widths.length) ws['!cols'] = widths.map((wch) => ({ wch }));
  return ws;
};
const N = (v) => (v === null || v === undefined ? null : Number(v));

// R-14.2 결과 엑셀
export function buildResultWorkbook(b, run) {
  const wb = XLSX.utils.book_new();
  const c = b.cond;
  const rows = run.alloc?.rows ?? [];
  const head = ['순번', '기관명', ...b.items.map((i) => `${i.name}${b.recognized.includes(i.id) ? '' : ' (미인정)'}`), '인정 실적', '실적 점유율', '균등회비', '실적회비', '조정금액', '최종 회비'];
  const body = rows.map((r, i) => [i + 1, r.name, ...b.items.map((it) => r.counts[it.id] ?? 0), N(r.recognized), r.share ?? '-', N(r.equalFinal), N(r.perfFinal), N(r.adjust), N(r.final)]);
  const sum = (k) => rows.reduce((s, r) => s + Number(r[k]), 0);
  body.push(['', '합계', ...b.items.map((it) => rows.reduce((s, r) => s + (r.counts[it.id] ?? 0), 0)), N(run.alloc?.perf.totalRecognized), '', sum('equalFinal'), sum('perfFinal'), sum('adjust'), sum('final')]);
  body.push(['', '청구 대상 총액', ...b.items.map(() => ''), '', '', '', '', '', N(run.T)]);
  XLSX.utils.book_append_sheet(wb, sheet([[`${b.name} — ${c.year}년 ${c.quarter}분기 회비 산출 결과`], [], head, ...body], [6, 18, ...b.items.map(() => 11), 11, 12, 14, 14, 11, 14]), '회비산출결과');

  XLSX.utils.book_append_sheet(wb, sheet([
    ['분기', '청구 대상 총액', '계산식', '비고'],
    ...run.sch.quarters.map((q) => [`${q.q}분기`, N(q.amount), q.formula, q.q === c.quarter ? '이번 산출 분기' : q.fixed ? '기청구 (변경 없음)' : '']),
    ['합계', N(run.sch.sum), '', run.sch.balanced ? '최종 연간 회비 D와 일치' : `D와 ${N(run.sch.diff)}원 차이`],
    [], ['A 당초 연간 회비', N(run.sch.A)], ['B 전기이월잉여금', N(run.sch.B), c.bConfirmed ? '확정' : '미확정'], ['C 1분기 기청구', N(run.sch.C), run.sch.cAuto ? 'A ÷ 4 자동' : '직접 입력'], ['D 최종 연간 회비', N(run.sch.D)], ['E 2~4분기 청구 대상', N(run.sch.E)],
  ], [22, 16, 50, 24]), '분기배분');

  XLSX.utils.book_append_sheet(wb, sheet([
    ['규칙', '검증 항목', '기대', '실제', '차이', '결과', '원인', '대상'],
    ...run.checks.map((k) => [k.rule, k.label, N(k.expected), N(k.actual), N(k.diff), STATUS[k.status], k.cause, k.targets]),
    [], ['안내·오류'], ...run.issues.map((i) => [i.rule ?? '', i.message, '', '', '', i.level]),
  ], [12, 52, 14, 14, 10, 10, 50, 24]), '검증');

  const trace = [['기관명', '단계', '규칙', '항목', '값', '계산식']];
  for (const r of rows) {
    for (const l of r.trace.equal) trace.push([r.name, '균등회비', l.rule, l.label, typeof l.value === 'bigint' ? N(l.value) : l.value, l.formula]);
    for (const l of r.trace.perf) trace.push([r.name, '실적회비', l.rule, l.label, typeof l.value === 'bigint' ? N(l.value) : l.value, l.formula]);
    for (const l of r.trace.adjust) trace.push([r.name, '조정', l.rule, l.label, N(l.value), l.formula]);
    trace.push([r.name, '최종', 'R-14.1', '최종 청구금액', N(r.final), `균등 ${N(r.equalFinal)} + 실적 ${N(r.perfFinal)}`]);
  }
  XLSX.utils.book_append_sheet(wb, sheet(trace, [16, 10, 10, 30, 18, 70]), '산출근거');

  XLSX.utils.book_append_sheet(wb, sheet([
    ['항목', '값', '확인'],
    ['업무명', b.name], ['산출 연도·분기', `${c.year}년 ${c.quarter}분기`],
    ['분기 배분 방식', QUARTER_METHODS[c.quarterMethod]], ['균등회비 비율', bpToPercent(c.equalBp)], ['실적회비 비율', bpToPercent(c.perfBp)],
    ['균등회비 방식', EQUAL_METHODS[c.equalMethod]], ['실적 인정 항목', b.recognized.map((id) => b.items.find((i) => i.id === id)?.name).filter(Boolean).join(' + ')],
    ['우체국 특수 처리', c.postOffice ? `적용 (${run.alloc?.po.name ?? '대상 미지정'})` : '적용 안 함'],
    ['실적 기준기간', `${c.perfPeriod.start || '-'} ~ ${c.perfPeriod.end || '-'}`], ['실적 파일', b.perfMeta?.fileName ?? '(미적용)'],
    [], ['담당자 확인 항목 (D)', '현재 값', '확인 여부'],
    ...DECISIONS.filter((d) => !d.when || d.when(b)).map((d) => [`${d.id} ${d.title}`, describeDecision(b, d), dec(b, d.id).confirmed ? '확인함' : '확인 필요']),
  ], [40, 60, 12]), '적용옵션');

  const active = b.orgs.filter((o) => o.active);
  XLSX.utils.book_append_sheet(wb, sheet([
    ['기관명', ...b.items.map((i) => i.name), '합계'],
    ...active.map((o) => { const cs = b.items.map((i) => b.perf[o.id]?.[i.id] ?? 0); return [o.name, ...cs, cs.reduce((s, v) => s + v, 0)]; }),
  ], [18, ...b.items.map(() => 12), 12]), '실적');
  return wb;
}

export async function downloadResult(b, run) {
  const wb = buildResultWorkbook(b, run);
  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  await saveFile(`회비산출결과_${b.name.replace(/[\\/:*?"<>|]/g, '_')}_${b.cond.year}년${b.cond.quarter}분기.xlsx`, data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// 실적 업로드 양식
export async function downloadTemplate(b) {
  const wb = XLSX.utils.book_new();
  const active = b.orgs.filter((o) => o.active);
  const cols = b.items.length ? b.items.map((i) => i.name) : ['건수 항목 1', '건수 항목 2']; // 항목이 없으면 머리글만 바꿔 쓰는 자리
  const rows = [['기관명', ...cols, '합계'], ...(active.length ? active : [{ name: 'A기관' }, { name: 'B기관' }, { name: '우체국' }]).map((o) => [o.name, ...cols.map(() => 0), 0])];
  XLSX.utils.book_append_sheet(wb, sheet(rows, [18, ...cols.map(() => 12), 12]), '실적');
  await saveFile(`실적_양식_${b.name.replace(/[\\/:*?"<>|]/g, '_')}.xlsx`, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// 병행검증: 다른 프로그램(v4 등)의 결과 엑셀에서 기관명·균등회비·실적회비·최종 회비를 읽는다.
export function readResultSheet(sheets) {
  for (const s of sheets) {
    const aoa = s.aoa;
    const hi = aoa.findIndex((r) => Array.isArray(r) && r.some((v) => String(v ?? '').replace(/\s/g, '') === '기관명') && r.some((v) => /최종회비|최종청구/.test(String(v ?? '').replace(/\s/g, ''))));
    if (hi < 0) continue;
    const head = aoa[hi].map((v) => String(v ?? '').replace(/\s/g, ''));
    const col = (re) => head.findIndex((h) => re.test(h));
    const ci = { name: col(/^기관명$/), equal: col(/^균등회비$/), perf: col(/^실적회비$/), final: col(/최종회비|최종청구/), recognized: col(/^인정실적$/) };
    const rows = [];
    for (const r of aoa.slice(hi + 1)) {
      const name = String(r?.[ci.name] ?? '').trim();
      if (!name || /^(합계|청구 대상 총액|총계|계)$/.test(name)) continue;
      const num = (i) => (i < 0 || r[i] === null || r[i] === undefined || r[i] === '' ? null : Number(String(r[i]).replace(/,/g, '')));
      rows.push({ name, equal: num(ci.equal), perf: num(ci.perf), final: num(ci.final), recognized: num(ci.recognized) });
    }
    if (rows.length) return { sheet: s.name, rows };
  }
  return null;
}
