// 공통 규칙 초안 9장: 담당자 확인이 필요한 항목 D-1 ~ D-15.
// 규칙 번호를 그대로 키로 쓴다. 업무마다 { 'D-2': { value, confirmed } } 형태로 값을 가진다.
import { ROUNDING_MODES } from './money.js';

const roundingOptions = Object.entries(ROUNDING_MODES).map(([value, label]) => ({ value, label }));

export const DECISIONS = [
  {
    id: 'D-1', title: '1분기 기청구 회비', screen: 'cond',
    options: [{ value: 'auto', label: '당초 연간 회비 ÷ 4 자동' }, { value: 'manual', label: '실제 청구액 직접 입력' }],
    def: 'auto',
  },
  {
    id: 'D-2', title: '분기 금액이 나누어떨어지지 않을 때', screen: 'cond',
    options: roundingOptions, def: 'floor',
  },
  {
    id: 'D-3', title: '분기 배분 차액을 반영할 분기', screen: 'cond',
    options: [{ value: null, label: '차액이 생기면 그때 선택' }, { value: 2, label: '2분기' }, { value: 3, label: '3분기' }, { value: 4, label: '4분기' }],
    def: null,
  },
  {
    id: 'D-4', title: '균등회비 총액(방식 A)의 원 미만 처리', screen: 'cond', when: (b) => b.cond.equalMethod === 'A',
    options: roundingOptions, def: 'round',
  },
  {
    id: 'D-5', title: '기관별 균등회비 기본금액(방식 A)의 원 미만 처리', screen: 'adjust', when: (b) => b.cond.equalMethod === 'A',
    options: roundingOptions, def: 'floor',
  },
  {
    id: 'D-6', title: '균등회비 ±1원 대상 기관(방식 A)', screen: 'adjust', when: (b) => b.cond.equalMethod === 'A',
    options: [{ value: 'order', label: '참가기관 목록 순서대로' }, { value: 'manual', label: '담당자 지정' }],
    def: 'order', extra: { orgIds: [] },
  },
  {
    id: 'D-7', title: '방식 B 기관별 금액의 단위와 처리', screen: 'cond', when: (b) => b.cond.equalMethod === 'B',
    options: [{ value: 'auto', label: '자동 산출 (단위·처리 선택)' }, { value: 'manual', label: '금액 직접 지정' }],
    def: 'auto', extra: { unit: 1, rounding: 'floor', amount: 0 },
  },
  {
    id: 'D-8', title: '실적회비 원 단위 잔액 배정', screen: 'adjust',
    options: [
      { value: 'largestFraction', label: '버린 소수점이 큰 기관부터 1원씩' },
      { value: 'largestPerf', label: '인정 실적이 많은 기관부터 1원씩' },
      { value: 'order', label: '참가기관 목록 순서대로 1원씩' },
      { value: 'manual', label: '담당자 지정 기관에 1원씩' },
    ],
    def: 'largestFraction', extra: { orgIds: [] },
  },
  {
    id: 'D-9', title: '우체국 10원 단위 처리', screen: 'adjust', when: (b) => b.cond.postOffice,
    options: [{ value: 'up', label: '올림' }, { value: 'down', label: '내림' }], def: 'up',
  },
  {
    id: 'D-10', title: '우체국 차액을 반대로 반영할 기관', screen: 'adjust', when: (b) => b.cond.postOffice,
    options: [{ value: 'largestPerf', label: '우체국을 뺀 기관 중 실적회비가 가장 큰 기관' }, { value: 'manual', label: '담당자 지정' }],
    def: 'largestPerf', extra: { orgId: null },
  },
  {
    id: 'D-11', title: '실적 파일에 없는 분담 대상 기관', screen: 'data',
    options: [{ value: 'zero', label: '실적 0건으로 보고 균등회비만 부과' }, { value: 'error', label: '오류로 표시하고 적용 막기' }],
    def: 'zero',
  },
  {
    id: 'D-12', title: '같은 기관명이 여러 행일 때', screen: 'data',
    options: [{ value: 'sum', label: '같은 기관으로 합산' }, { value: 'error', label: '오류로 표시' }], def: 'sum',
  },
  {
    id: 'D-13', title: '산출 주기', screen: 'cond',
    options: [{ value: 'calendarQuarter', label: '달력 분기(1~3월, 4~6월 …)마다 산출' }], def: 'calendarQuarter',
  },
  {
    id: 'D-14', title: '균등회비 분모(분담 대상 기관 수)', screen: 'orgs',
    options: [{ value: 'activeOrgs', label: '분담 대상으로 표시된 참가기관 전부 (실적 유무 무관)' }], def: 'activeOrgs',
  },
  {
    id: 'D-15', title: '기관명 동일성 판단', screen: 'data',
    options: [{ value: 'ignoreSpaces', label: '띄어쓰기만 다른 이름은 같은 기관' }, { value: 'exact', label: '글자가 완전히 같아야 같은 기관' }],
    def: 'ignoreSpaces',
  },
];

export const decisionById = Object.fromEntries(DECISIONS.map((d) => [d.id, d]));

export function defaultDecisions() {
  return Object.fromEntries(DECISIONS.map((d) => [d.id, { value: d.def, confirmed: false, ...(d.extra ? structuredClone(d.extra) : {}) }]));
}

// 업무의 결정값 읽기 (없으면 기본값)
export const dec = (b, id) => b.decisions?.[id] ?? { value: decisionById[id].def, confirmed: false, ...(decisionById[id].extra ?? {}) };

export const optionLabel = (id, value) => decisionById[id].options.find((o) => o.value === value)?.label ?? String(value);

// 이 업무에서 아직 확인되지 않은 항목
export const pendingDecisions = (b) => DECISIONS.filter((d) => (!d.when || d.when(b)) && !dec(b, d.id).confirmed);

// 사람이 읽는 현재 값
export function describeDecision(b, d) {
  const v = dec(b, d.id);
  const base = optionLabel(d.id, v.value);
  switch (d.id) {
    case 'D-1': return v.value === 'manual' && b.cond.C != null ? `${base} (${Number(b.cond.C).toLocaleString('ko-KR')}원)` : base;
    case 'D-6': return v.value === 'manual' ? `${base}: ${names(b, v.orgIds)}` : base;
    case 'D-7': return v.value === 'manual' ? `${base}: ${Number(v.amount).toLocaleString('ko-KR')}원` : `${v.unit.toLocaleString('ko-KR')}원 단위 ${ROUNDING_MODES[v.rounding]}`;
    case 'D-8': return v.value === 'manual' ? `${base}: ${names(b, v.orgIds)}` : base;
    case 'D-10': return v.value === 'manual' ? `${base}: ${names(b, [v.orgId])}` : base;
    default: return base;
  }
}
const names = (b, ids) => (ids ?? []).map((id) => b.orgs.find((o) => o.id === id)?.name ?? '(없음)').join(', ') || '(미지정)';
