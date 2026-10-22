// 엑셀 파일 읽기·쓰기 (SheetJS). 계산은 하지 않고, 엔진 결과(runBusiness)를 시트로 옮기기만 한다.
import * as XLSX from 'xlsx';
import { QUARTER_METHODS } from './engine/quarters.js';
import { EQUAL_METHODS, REMAINDER_MODES } from './engine/fee.js';
import { ROUNDING, bpToPercent } from './engine/money.js';
import { DECISIONS, pendingDecisions } from './engine/model.js';
import { STATUS_LABEL } from './engine/pipeline.js';

// 업로드한 파일 → 시트별 2차원 배열
export function readWorkbook(data) {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  return wb.SheetNames.map((name) => ({
    name,
    aoa: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true }),
  }));
}

const WON = '#,##0';
function sheet(rows, widths, moneyCols = [], fromRow = 1) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = widths.map((wch) => ({ wch }));
  for (let r = fromRow; r < rows.length; r++) {
    for (const c of moneyCols) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === 'number') cell.z = WON;
    }
  }
  return ws;
}

// 산출 결과 엑셀 (12-6): 결과표, 분기 배분, 검증, 기관별 산출 근거, 산출 옵션, 실적 데이터
export function buildResultWorkbook(b, run, { date = new Date() } = {}) {
  const s = b.settings;
  const { fee, schedule } = run;
  const wb = XLSX.utils.book_new();
  const head = [
    ['업무', b.name],
    ['산출 연도·분기', `${s.year}년 ${s.quarter}분기`],
    ['분기 청구 대상 총액', run.total],
    ['실적 기준기간', b.perfMeta ? `${b.perfMeta.start || '-'} ~ ${b.perfMeta.end || '-'}` : '미적용'],
    ['검증 결과', STATUS_LABEL[run.status]],
    ['산출일', date.toISOString().slice(0, 10)],
    [],
  ];
  const items = b.items;
  const header = ['순번', '기관명', ...items.map((i) => `${i.name}${b.recognizedItemIds.includes(i.id) ? '' : ' (미인정)'}`), '인정 실적', '실적 점유율(%)', '균등회비', '실적회비', '조정금액', '최종 회비'];
  const body = (fee?.rows ?? []).map((r, k) => [
    k + 1, r.name, ...items.map((i) => r.counts[i.id] ?? 0), r.recognized,
    r.sharePercent === '-' ? '' : Number(r.sharePercent.replace('%', '')), r.equalFinal, r.perfFinal, r.adjustment, r.final,
  ]);
  const t = fee?.totals ?? { equal: 0, perf: 0, adjustment: 0, final: 0 };
  const foot = ['합계', `${fee?.orgCount ?? 0}개 기관`, ...items.map((i) => (fee?.rows ?? []).reduce((a, r) => a + (r.counts[i.id] ?? 0), 0)), fee?.perf.totalRecognized ?? 0, 100, t.equal, t.perf, t.adjustment, t.final];
  const moneyCols = [2 + items.length, 5 + items.length, 6 + items.length, 7 + items.length, 8 + items.length, ...items.map((_, k) => 2 + k)];
  const result = sheet([...head, header, ...body, foot], [6, 18, ...items.map(() => 12), 12, 14, 14, 14, 10, 16], moneyCols, head.length + 1);
  result.B3 && (result.B3.z = WON);
  XLSX.utils.book_append_sheet(wb, result, '회비산출결과');

  XLSX.utils.book_append_sheet(wb, sheet([
    ['항목', '금액', '설명'],
    ['A 당초 연간 회비', schedule.A, ''],
    ['B 전기이월잉여금', schedule.B, s.surplusConfirmed ? '확정' : '미확정 (0원으로 계산, 2~4분기는 잠정)'],
    ['C 1분기 기청구 회비', schedule.C, schedule.q1IsAuto ? '당초 연간 회비 ÷ 4 자동' : '직접 입력'],
    ['D 최종 연간 회비 (A − B)', schedule.D, ''],
    ['E 2~4분기 청구 대상 (D − C)', schedule.E, ''],
    ['배분 방식', '', QUARTER_METHODS[s.quarterMethod]],
    [],
    ['분기', '청구 대상 총액', '계산식'],
    ...schedule.quarters.map((q) => [`${q.quarter}분기${q.quarter === s.quarter ? ' (이번 산출)' : ''}`, q.amount, q.formula]),
    ['합계', schedule.sum, schedule.sum === schedule.D ? '최종 연간 회비와 일치' : `차액 ${schedule.D - schedule.sum}원`],
  ], [26, 16, 70], [1]), '분기배분');

  XLSX.utils.book_append_sheet(wb, sheet([
    ['검증 항목', '결과', '기준 금액', '실제 금액', '차액', '원인', '보정 대상'],
    ...run.checks.map((c) => [c.label, STATUS_LABEL[c.status], c.unit ? '' : c.expected, c.unit ? '' : c.actual, c.unit ? '' : c.diff, c.cause, c.targets]),
    [],
    ['알림', '수준'],
    ...run.issues.map((i) => [i.message, { error: '오류', warn: '확인 필요', info: '참고' }[i.level]]),
  ], [52, 10, 16, 16, 10, 50, 20], [2, 3, 4]), '검증');

  const trace = [['기관명', '구분', '항목', '값', '계산식']];
  for (const r of fee?.rows ?? []) {
    for (const l of r.trace.equal) trace.push([r.name, '균등회비', l.label, l.value, l.formula ?? '']);
    for (const l of r.trace.perf) trace.push([r.name, '실적회비', l.label, l.value, l.formula ?? '']);
    for (const a of r.trace.adjust) trace.push([r.name, '조정', a.kind, a.amount, a.reason]);
    trace.push([r.name, '최종', '최종 청구금액', r.final, `균등회비 ${r.equalFinal.toLocaleString('ko-KR')} + 실적회비 ${r.perfFinal.toLocaleString('ko-KR')}`]);
  }
  XLSX.utils.book_append_sheet(wb, sheet(trace, [16, 10, 34, 20, 80]), '산출근거');

  const pending = new Set(pendingDecisions(b).map((d) => d.key));
  XLSX.utils.book_append_sheet(wb, sheet([
    ['옵션', '값'],
    ['분기별 회비 배분 방식', QUARTER_METHODS[s.quarterMethod]],
    ['균등회비 비율', `${bpToPercent(s.equalRateBp)}%`],
    ['실적회비 비율', `${bpToPercent(s.perfRateBp)}%`],
    ['균등회비 산출 방식', EQUAL_METHODS[s.equal.method]],
    ['실적 인정 항목', b.items.filter((i) => b.recognizedItemIds.includes(i.id)).map((i) => i.name).join(' + ')],
    ['실적회비 원 단위 잔액', REMAINDER_MODES[s.perfRemainder.mode]],
    ['우체국 특수 처리', s.postOffice.enabled ? `사용 (${s.postOffice.direction === 'down' ? '내림' : '올림'})` : '사용 안 함'],
    ['분기 금액 원 단위 처리', ROUNDING[s.quarterRounding]],
    [],
    ['기본값 항목', '현재 값', '담당자 확인'],
    ...DECISIONS.filter((d) => !d.when || d.when(b)).map((d) => [d.label, d.value(b), pending.has(d.key) ? '확인 필요' : '확인함']),
  ], [36, 50, 12]), '산출옵션');

  const active = b.orgs.filter((o) => o.active);
  XLSX.utils.book_append_sheet(wb, sheet([
    ['파일', b.perfMeta?.fileName ?? '-'],
    ['실적 기준기간', b.perfMeta ? `${b.perfMeta.start || '-'} ~ ${b.perfMeta.end || '-'}` : '-'],
    ['적용일', b.perfMeta?.appliedAt ?? '-'],
    [],
    ['기관명', '분담 대상', ...b.items.map((i) => i.name)],
    ...b.orgs.map((o) => [o.name, o.active ? 'O' : '제외', ...b.items.map((i) => b.perf[o.id]?.[i.id] ?? 0)]),
    ['분담 대상 기관 수', active.length],
  ], [18, 10, ...b.items.map(() => 12)], b.items.map((_, k) => 2 + k), 5), '실적데이터');
  return wb;
}

// 실적 업로드 양식 (현재 업무의 참가기관과 실적 항목으로)
export function buildTemplateWorkbook(b) {
  const rows = [['기관명', ...b.items.map((i) => i.name), '합계'], ...b.orgs.filter((o) => o.active).map((o) => {
    const v = b.items.map((i) => b.perf[o.id]?.[i.id] ?? 0);
    return [o.name, ...v, v.reduce((a, x) => a + x, 0)];
  })];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(rows, [18, ...b.items.map(() => 12), 12], b.items.map((_, k) => k + 1).concat([b.items.length + 1])), '실적');
  return wb;
}

export const workbookBytes = (wb) => XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

// 파일로 저장. claude.ai 웹 페이지 안에서는 다운로드 확인 창을 거치고, 그 밖에서는 브라우저가 바로 내려받는다.
export async function saveFile(filename, data, mime = 'application/octet-stream') {
  if (typeof window !== 'undefined' && window.claude?.use) {
    const downloads = await window.claude.use('downloads');
    if (downloads) {
      await downloads.save({ filename, data });
      return;
    }
    throw new Error('이 화면에서는 파일 저장을 쓸 수 없습니다.');
  }
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
