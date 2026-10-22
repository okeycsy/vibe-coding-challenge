// 업무(설정 묶음) 데이터 구조. R-2.1 업무마다 설정을 따로 가진다.
import { defaultDecisions } from './decisions.js';

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}`;

export const DEFAULT_ITEMS = [
  { id: 'seizure', name: '압류건수' },
  { id: 'collection', name: '추심건수' },
  { id: 'release', name: '해제건수' },
];

export function newBusiness(name = '새 업무') {
  return {
    id: uid('biz'),
    name,
    orgs: [], // [{ id, name, active, postOffice }]  active=false면 분담 대상 제외, postOffice=true면 R-7 대상
    items: DEFAULT_ITEMS.map((i) => ({ ...i })),
    recognized: DEFAULT_ITEMS.map((i) => i.id),
    cond: {
      year: 2026,
      quarter: 1,
      A: 0, // 당초 연간 회비
      B: 0, // 전기이월잉여금
      bConfirmed: false,
      C: null, // 1분기 기청구 회비 (D-1이 manual일 때만 사용)
      quarterMethod: 'A',
      equalBp: 2500,
      perfBp: 7500,
      equalMethod: 'A',
      postOffice: true, // R-7 우체국 특수 처리 적용 여부
      perfPeriod: { start: '', end: '' },
      autoAddOrgs: true, // R-10.7 엑셀에만 있는 기관명 자동 등록
    },
    decisions: defaultDecisions(), // D-1 ~ D-15
    mapping: {}, // 엑셀 머리글 → 역할 (R-10.2 저장 재사용)
    perf: {}, // orgId → itemId → 건수
    perfMeta: null, // { fileName, start, end, year, quarter, appliedAt, rows }
  };
}

// 예시 업무. 모두 가상의 기관·건수 (R-1.7). 숫자는 v4 예시와 같게 두어 병행검증에 바로 쓴다.
const ORG_NAMES = ['A기관', 'B기관', 'C기관', 'D기관', 'E기관', 'F기관', 'G기관', 'H기관', 'I기관', 'J기관', 'K기관', '우체국'];
const COUNTS = [
  [1000, 500, 300], [2000, 700, 400], [1500, 800, 500], [1230, 410, 277], [880, 260, 191], [3120, 1180, 705],
  [455, 120, 98], [2210, 905, 433], [167, 53, 21], [612, 247, 130], [93, 31, 17], [700, 300, 200],
];

export function sampleBusinesses() {
  const a = newBusiness('예금압류 관련정보 중계업무 (예시)');
  a.orgs = ORG_NAMES.map((name, i) => ({ id: `org_${i + 1}`, name, active: true, postOffice: name === '우체국' }));
  a.perf = Object.fromEntries(a.orgs.map((o, i) => [o.id, { seizure: COUNTS[i][0], collection: COUNTS[i][1], release: COUNTS[i][2] }]));
  a.perfMeta = { fileName: '예시_실적_2026년1분기.xlsx', appliedAt: '2026-04-10', start: '2026-01-01', end: '2026-03-31', rows: a.orgs.length, sample: true };
  Object.assign(a.cond, { year: 2026, quarter: 2, A: 100_000_000, B: 12_000_000, bConfirmed: true, C: 25_000_000, perfPeriod: { start: '2026-01-01', end: '2026-03-31' } });
  a.decisions['D-1'] = { value: 'manual', confirmed: true };
  a.decisions['D-12'].confirmed = true; // 중복 기관명 합산은 대용 담당자 확인(2026-10-17)

  const b = newBusiness('오픈API 중계업무 (예시)');
  b.orgs = ORG_NAMES.slice(0, 7).map((name, i) => ({ id: `org_${i + 1}`, name, active: true, postOffice: false }));
  b.items = [{ id: 'api', name: 'API 호출건수' }, { id: 'proc', name: '업무 처리건수' }];
  b.recognized = ['api'];
  b.perf = Object.fromEntries(b.orgs.map((o, i) => [o.id, { api: COUNTS[i][0] * 37 + 11, proc: COUNTS[i][1] * 3 }]));
  b.perfMeta = { fileName: '예시_API실적.xlsx', appliedAt: '2026-04-10', start: '2026-01-01', end: '2026-03-31', rows: b.orgs.length, sample: true };
  Object.assign(b.cond, { year: 2026, quarter: 2, A: 40_000_000, B: 3_500_002, bConfirmed: true, C: 10_000_000, quarterMethod: 'B', equalBp: 3000, perfBp: 7000, equalMethod: 'B', postOffice: false, perfPeriod: { start: '2026-01-01', end: '2026-03-31' } });
  b.decisions['D-1'] = { value: 'manual', confirmed: true };
  b.decisions['D-3'] = { value: 4, confirmed: false };
  b.decisions['D-7'] = { value: 'auto', unit: 10, rounding: 'floor', amount: 0, confirmed: false };
  b.decisions['D-12'].confirmed = true;
  return [a, b];
}

// 저장 파일이나 옛 버전에서 읽은 업무를 현재 구조로 보정
export function normalizeBusiness(raw) {
  const b = { ...newBusiness(raw.name), ...raw };
  b.cond = { ...newBusiness().cond, ...(raw.cond ?? {}) };
  b.decisions = { ...defaultDecisions(), ...(raw.decisions ?? {}) };
  b.orgs = (raw.orgs ?? []).map((o) => ({ active: true, postOffice: false, ...o }));
  return b;
}
