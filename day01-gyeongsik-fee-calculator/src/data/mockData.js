// 모든 수치는 화면 시연용 예시 데이터입니다. 실제 실적·회비와 무관합니다.

// 로그인한 계정의 role이 화면을 결정한다: operator=사용자, sysadmin=관리자, institution=참가기관.
// side: 'kftc'(금융결제원) | 'institution'(참가기관). 결제원 화면 권한은 side로, 관리자 기능은 role로 구분한다.
export const USERS = {
  operator: {
    role: 'operator',
    side: 'kftc',
    org: '금융결제원',
    title: '일반담당자',
    name: '홍길동',
    empNo: 'KFTC-202601',
    dept: '금융사업부 오픈뱅킹팀',
    roleLabel: '일반 사용자 (운영 담당자)',
    extension: '02-531-1234',
    label: '사용자',
    home: 'calc',
  },
  sysadmin: {
    role: 'sysadmin',
    side: 'kftc',
    org: '금융결제원',
    title: '시스템관리자',
    name: '이수진',
    empNo: 'KFTC-201804',
    dept: '정보시스템부 운영관리팀',
    roleLabel: '시스템 관리자',
    extension: '02-531-1100',
    label: '관리자',
    home: 'admin',
  },
  institution: {
    role: 'institution',
    side: 'institution',
    org: '신한은행',
    institutionId: 'shinhan',
    title: '회비담당자',
    name: '김철수',
    empNo: 'SH-10234',
    dept: '자금결제부',
    roleLabel: '참가기관 담당자',
    extension: '02-2151-0000',
    label: '참가기관',
    home: 'calc',
  },
};

// 시연용 로그인 계정 (기본 비밀번호 1234). 비밀번호는 마이페이지에서 바꿀 수 있다.
export const ACCOUNTS = [
  { id: 'hong', password: '1234', role: 'operator' },
  { id: 'admin', password: '1234', role: 'sysadmin' },
  { id: 'shinhan', password: '1234', role: 'institution' },
];

// 일반담당자(홍길동)의 초기 승인 업무
export const INITIAL_APPROVED_TASKS = ['openbanking', 'fininfo'];

// 관리자 화면의 잠금 계정 예시 (실제 계정이 5회 틀리면 여기에 추가된다)
export const INITIAL_LOGIN_LOCKS = {
  woori01: { count: 5, name: '박지훈', org: '우리은행', lockedAt: '2026-10-19 16:42' },
  ibk02: { count: 5, name: '오세훈', org: 'IBK기업은행', lockedAt: '2026-10-20 09:15' },
};

export const LOGIN_HISTORY = [
  { at: '2026-10-19 18:02', ip: '192.168.10.45', device: 'Chrome / Windows', status: '로그아웃' },
  { at: '2026-10-19 08:51', ip: '192.168.10.45', device: 'Chrome / Windows', status: '정상 로그인' },
  { at: '2026-10-18 09:03', ip: '192.168.10.45', device: 'Chrome / Windows', status: '정상 로그인' },
  { at: '2026-10-17 08:47', ip: '192.168.10.52', device: 'Edge / Windows', status: '비밀번호 오류' },
];

// alias: AI 이슈 문장에서 기관을 인식할 때 쓰는 별칭 (A~H은행은 시연용 가명 매핑)
export const INSTITUTIONS = [
  { id: 'shinhan', name: '신한은행', code: 'B088', aliases: ['신한', 'A은행'] },
  { id: 'kb', name: 'KB국민은행', code: 'B004', aliases: ['국민', 'KB', 'B은행'] },
  { id: 'woori', name: '우리은행', code: 'B020', aliases: ['우리', 'C은행'] },
  { id: 'hana', name: '하나은행', code: 'B081', aliases: ['하나', 'D은행'] },
  { id: 'nh', name: 'NH농협은행', code: 'B011', aliases: ['농협', 'NH', 'E은행'] },
  { id: 'ibk', name: 'IBK기업은행', code: 'B003', aliases: ['기업', 'IBK', 'F은행'] },
  { id: 'kakao', name: '카카오뱅크', code: 'B090', aliases: ['카카오', 'G은행'] },
  { id: 'toss', name: '토스뱅크', code: 'B092', aliases: ['토스', 'H은행'] },
];

// method: 'unit' = 건당 단가 방식, 'ratio' = 총액을 인정 건수 비율로 분담
export const BUSINESSES = [
  {
    id: 'openbanking',
    name: '오픈뱅킹',
    method: 'unit',
    unitPrice: 20,
    baseVolume: 4_200_000,
    revenueAccount: '41101 회비수입-오픈뱅킹',
    summary: [
      '이용기관 API 호출 중 출금이체·입금이체 성공 건을 실적으로 인정',
      '건당 단가 20원 적용 (조회성 API는 산정 제외)',
      '장애·중복 전송 건은 증빙 확인 후 실적에서 차감',
    ],
  },
  {
    id: 'fininfo',
    name: '금융거래정보(금거정)',
    method: 'ratio',
    totalFee: 120_000_000,
    baseVolume: 650_000,
    revenueAccount: '41102 회비수입-금융거래정보',
    summary: [
      '분기 운영비 총액 1억 2,000만원을 참가기관이 분담',
      '분담률 = 기관별 최종 인정 건수 ÷ 전체 인정 건수',
      '시험·테스트 전문은 실적에서 제외',
    ],
  },
  {
    id: 'cms',
    name: 'CMS',
    method: 'unit',
    unitPrice: 8,
    baseVolume: 9_800_000,
    revenueAccount: '41103 회비수입-CMS',
    summary: [
      '자동이체 출금 의뢰 처리 건을 실적으로 인정',
      '건당 단가 8원 적용',
      '반송·불능 건도 처리 건수에 포함',
    ],
  },
  {
    id: 'cd',
    name: 'CD공동망',
    method: 'ratio',
    totalFee: 300_000_000,
    baseVolume: 2_300_000,
    revenueAccount: '41104 회비수입-CD공동망',
    summary: [
      '분기 공동망 운영비 총액 3억원을 참가기관이 분담',
      '분담률 = 기관별 타행 CD/ATM 거래 인정 건수 비율',
      '망 장애로 인한 재처리 건은 차감 대상',
    ],
  },
  {
    id: 'interbank',
    name: '타행환',
    method: 'unit',
    unitPrice: 12,
    baseVolume: 7_500_000,
    revenueAccount: '41105 회비수입-타행환',
    summary: [
      '타행 송금 의뢰 성공 건을 실적으로 인정',
      '건당 단가 12원 적용',
      '정정·취소 전문은 산정 제외',
    ],
  },
];

export const YEARS = [2025, 2026];
export const QUARTERS = [1, 2, 3, 4];

export const ISSUE_EXAMPLES = [
  '5월 3일 A은행 시스템 장애로 인해 중복 전송된 1,500건은 실적에서 제외하고 산출해 줘.',
  '카카오뱅크 테스트 전문 2,300건은 실적에서 빼 줘.',
  '농협 6월 12일 재처리분 800건 차감해 줘.',
];

// 업무·기간·기관마다 항상 같은 값이 나오도록 하는 결정적 의사난수
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const WEIGHTS = { shinhan: 1.15, kb: 1.25, woori: 1.0, hana: 0.95, nh: 1.1, ibk: 0.8, kakao: 0.7, toss: 0.45 };

export function getBaseCounts(businessId, year, quarter) {
  const biz = BUSINESSES.find((b) => b.id === businessId);
  return INSTITUTIONS.map((inst) => {
    const r = seeded(`${businessId}-${year}-${quarter}-${inst.id}`);
    const count = Math.round((biz.baseVolume * WEIGHTS[inst.id] * (0.85 + r * 0.3)) / 10) * 10;
    return { institutionId: inst.id, baseCount: count };
  });
}

export const TEST_RESULTS = [
  { id: 1, institutionId: 'shinhan', business: '오픈뱅킹', item: '출금이체 API 연동', date: '2026-10-08 14:20', result: '성공', note: '-' },
  { id: 2, institutionId: 'kb', business: 'CMS', item: '출금의뢰 파일 포맷 검증', date: '2026-10-08 16:05', result: '성공', note: '-' },
  { id: 3, institutionId: 'woori', business: '타행환', item: '정정 전문 처리', date: '2026-10-09 10:12', result: '실패', note: '응답코드 매핑 오류, 재테스트 예정' },
  { id: 4, institutionId: 'kakao', business: '오픈뱅킹', item: '입금이체 API 연동', date: '2026-10-10 09:40', result: '성공', note: '-' },
  { id: 5, institutionId: 'nh', business: 'CD공동망', item: '타행 출금 거래 대사파일', date: '2026-10-11 11:30', result: '진행중', note: '대사파일 수신 대기' },
  { id: 6, institutionId: 'toss', business: '금융거래정보(금거정)', item: '조회 전문 송수신', date: '2026-10-12 15:55', result: '실패', note: '타임아웃 3회 발생' },
  { id: 7, institutionId: 'hana', business: '타행환', item: '송금 전문 처리', date: '2026-10-13 13:00', result: '성공', note: '-' },
];

export const MEMBER_REQUESTS = [
  { id: 1, name: '이민지', org: '하나은행', dept: '자금결제부', email: 'minji.lee@example.com', role: '참가기관 담당자', requestedAt: '2026-10-13', status: '승인대기' },
  { id: 2, name: '박준호', org: '토스뱅크', dept: '재무팀', email: 'junho.park@example.com', role: '참가기관 담당자', requestedAt: '2026-10-13', status: '승인대기' },
  { id: 3, name: '최서연', org: '금융결제원', dept: '회비관리팀', email: 'seoyeon.choi@example.com', role: '결제원 담당자', requestedAt: '2026-10-12', status: '승인대기' },
  { id: 4, name: '정우성', org: 'IBK기업은행', dept: '전자금융부', email: 'woosung.jung@example.com', role: '참가기관 담당자', requestedAt: '2026-10-10', status: '승인' },
  { id: 5, name: '한지수', org: '카카오뱅크', dept: '정산팀', email: 'jisu.han@example.com', role: '참가기관 담당자', requestedAt: '2026-10-09', status: '반려' },
];
