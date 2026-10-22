// 업무(산출 설정 묶음) 데이터 구조, 담당자 확인이 필요한 기본값 목록, 예시 업무.
// 업무마다 참가기관·실적 항목·산출 옵션·실적 데이터를 따로 가진다(12-1 업무별 설정 독립성).
import { ROUNDING } from './money.js';
import { REMAINDER_MODES } from './fee.js';

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
    orgs: [], // [{ id, name, active }]  active=false면 분담 대상에서 제외
    items: DEFAULT_ITEMS.map((i) => ({ ...i })),
    recognizedItemIds: DEFAULT_ITEMS.map((i) => i.id),
    settings: {
      year: 2026,
      quarter: 1,
      annualFee: 0, // A
      surplus: 0, // B
      surplusConfirmed: false,
      q1Billed: null, // C. null이면 A ÷ 4 자동
      quarterMethod: 'A',
      quarterRounding: 'floor',
      quarterDiffQuarter: null,
      equalRateBp: 2500,
      perfRateBp: 7500,
      equal: {
        method: 'A',
        poolRounding: 'round',
        unitRounding: 'floor',
        targetMode: 'auto',
        targetOrgIds: [],
        bMode: 'auto',
        bRounding: 'floor',
        bUnit: 1,
        bAmount: 0,
      },
      perfRemainder: { mode: 'largestRemainder', orgIds: [] },
      postOffice: { enabled: true, orgId: null, direction: 'up', counterpartMode: 'auto', counterpartOrgId: null },
      duplicatePolicy: 'sum',
      perfPeriod: { start: '', end: '' },
    },
    columnMapping: {}, // 엑셀 머리글 → 역할 (같은 양식 재사용)
    perf: {}, // 기관 id → 항목 id → 건수
    perfMeta: null, // 적용한 실적 데이터 정보
    confirmed: {}, // 담당자가 확인한 기본값 key → true
  };
}

// 우체국 대상 기관: 지정이 없으면 이름에 '우체국'이 들어간 첫 기관
export const postOfficeOrgId = (b) =>
  b.settings.postOffice.orgId && b.orgs.some((o) => o.id === b.settings.postOffice.orgId)
    ? b.settings.postOffice.orgId
    : b.orgs.find((o) => o.name.includes('우체국'))?.id ?? null;

const orgName = (b, id) => b.orgs.find((o) => o.id === id)?.name ?? '(없음)';

// 요구사항에 정해지지 않아 프로그램이 기본값으로 계산하는 항목. 담당자가 값을 바꾸거나 '확인'을 누르면 확정된다.
export const DECISIONS = [
  {
    key: 'q1Source', screen: 'conditions', label: '1분기 기청구 회비',
    value: (b) => (b.settings.q1Billed === null ? '당초 연간 회비 ÷ 4 자동 계산' : '실제 청구액 직접 입력'),
  },
  {
    key: 'quarterRounding', screen: 'conditions', label: '분기 금액이 원 단위로 나누어떨어지지 않을 때',
    value: (b) => ROUNDING[b.settings.quarterRounding],
  },
  {
    key: 'quarterDiff', screen: 'conditions', label: '분기 배분 차액을 반영할 분기',
    value: (b) => (b.settings.quarterDiffQuarter ? `${b.settings.quarterDiffQuarter}분기` : '차액이 생기면 그때 선택'),
  },
  {
    key: 'equalPoolRounding', screen: 'conditions', label: '균등회비 총액(방식 A)의 원 미만 처리', when: (b) => b.settings.equal.method === 'A',
    value: (b) => ROUNDING[b.settings.equal.poolRounding],
  },
  {
    key: 'equalUnitRounding', screen: 'adjust', label: '기관별 균등회비 기본금액(방식 A)의 원 미만 처리', when: (b) => b.settings.equal.method === 'A',
    value: (b) => ROUNDING[b.settings.equal.unitRounding],
  },
  {
    key: 'equalTargets', screen: 'adjust', label: '균등회비 원 단위 차액을 받을 기관(방식 A)', when: (b) => b.settings.equal.method === 'A',
    value: (b) => (b.settings.equal.targetMode === 'auto' ? '참가기관 목록 순서대로 자동' : '담당자 지정'),
  },
  {
    key: 'equalBRounding', screen: 'conditions', label: '기관별 동일 균등회비(방식 B)의 금액 단위와 처리', when: (b) => b.settings.equal.method === 'B',
    value: (b) => (b.settings.equal.bMode === 'manual' ? '담당자 직접 지정' : `${b.settings.equal.bUnit.toLocaleString('ko-KR')}원 단위 ${ROUNDING[b.settings.equal.bRounding]}`),
  },
  {
    key: 'perfRemainder', screen: 'adjust', label: '실적회비 원 단위 잔액 배정',
    value: (b) => REMAINDER_MODES[b.settings.perfRemainder.mode],
  },
  {
    key: 'poDirection', screen: 'adjust', label: '우체국 회비 10원 단위 처리', when: (b) => b.settings.postOffice.enabled,
    value: (b) => (b.settings.postOffice.direction === 'down' ? '내림' : '올림'),
  },
  {
    key: 'poCounterpart', screen: 'adjust', label: '우체국 보정 차액을 반영할 기관', when: (b) => b.settings.postOffice.enabled,
    value: (b) => (b.settings.postOffice.counterpartMode === 'auto' ? '실적회비가 가장 큰 기관 자동' : orgName(b, b.settings.postOffice.counterpartOrgId)),
  },
  {
    key: 'missingOrgs', screen: 'data', label: '실적 파일에 없는 분담 대상 기관',
    value: () => '실적 0건으로 보고 균등회비만 부과',
  },
  {
    key: 'duplicatePolicy', screen: 'data', label: '실적 파일에 같은 기관명이 여러 행일 때',
    value: (b) => (b.settings.duplicatePolicy === 'sum' ? '같은 기관으로 보고 합산' : '오류로 표시'),
  },
];

export const pendingDecisions = (b) => DECISIONS.filter((d) => (!d.when || d.when(b)) && !b.confirmed[d.key]);

// ── 예시 업무 (모두 가상의 기관·건수) ───────────────────────────────
const ORG_NAMES = ['A기관', 'B기관', 'C기관', 'D기관', 'E기관', 'F기관', 'G기관', 'H기관', 'I기관', 'J기관', 'K기관', '우체국'];
const COUNTS = [
  [1000, 500, 300],
  [2000, 700, 400],
  [1500, 800, 500],
  [1230, 410, 277],
  [880, 260, 191],
  [3120, 1180, 705],
  [455, 120, 98],
  [2210, 905, 433],
  [167, 53, 21],
  [612, 247, 130],
  [93, 31, 17],
  [700, 300, 200],
];

export function sampleBusinesses() {
  const a = newBusiness('예금압류 관련정보 중계업무 (예시)');
  a.orgs = ORG_NAMES.map((name, i) => ({ id: `org_${i + 1}`, name, active: true }));
  a.perf = Object.fromEntries(a.orgs.map((o, i) => [o.id, { seizure: COUNTS[i][0], collection: COUNTS[i][1], release: COUNTS[i][2] }]));
  a.perfMeta = { fileName: '예시_실적_2026년1분기.xlsx', appliedAt: '2026-04-10', start: '2026-01-01', end: '2026-03-31', rows: a.orgs.length, sample: true };
  Object.assign(a.settings, {
    year: 2026,
    quarter: 2,
    annualFee: 100_000_000,
    surplus: 12_000_000,
    surplusConfirmed: true,
    q1Billed: 25_000_000,
    perfPeriod: { start: '2026-01-01', end: '2026-03-31' },
  });
  a.confirmed = { duplicatePolicy: true, q1Source: true }; // 중복 기관명 합산은 John 확인(2026-10-17)

  const b = newBusiness('오픈API 중계업무 (예시)');
  b.orgs = ORG_NAMES.slice(0, 7).map((name, i) => ({ id: `org_${i + 1}`, name, active: true }));
  b.items = [{ id: 'api', name: 'API 호출건수' }, { id: 'proc', name: '업무 처리건수' }];
  b.recognizedItemIds = ['api'];
  b.perf = Object.fromEntries(b.orgs.map((o, i) => [o.id, { api: COUNTS[i][0] * 37 + 11, proc: COUNTS[i][1] * 3 }]));
  b.perfMeta = { fileName: '예시_API실적.xlsx', appliedAt: '2026-04-10', start: '2026-01-01', end: '2026-03-31', rows: b.orgs.length, sample: true };
  Object.assign(b.settings, {
    year: 2026,
    quarter: 2,
    annualFee: 40_000_000,
    surplus: 3_500_002,
    surplusConfirmed: true,
    q1Billed: 10_000_000,
    quarterMethod: 'B',
    quarterDiffQuarter: 4,
    equalRateBp: 3000,
    perfRateBp: 7000,
    postOffice: { enabled: false, orgId: null, direction: 'up', counterpartMode: 'auto', counterpartOrgId: null },
    perfPeriod: { start: '2026-01-01', end: '2026-03-31' },
  });
  b.settings.equal = { ...b.settings.equal, method: 'B', bUnit: 10, bRounding: 'floor' };
  b.confirmed = { q1Source: true, duplicatePolicy: true };
  return [a, b];
}
