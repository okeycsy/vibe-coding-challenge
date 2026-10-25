// 모든 수치는 화면 시연용 예시 데이터입니다. 실제 실적·회비와 무관합니다.

// 로그인한 계정의 role이 화면을 결정한다: operator=사용자, sysadmin=관리자, institution=참가기관.
// side: 'kftc'(금융결제원) | 'institution'(참가기관). 결제원 화면 권한은 side로, 관리자 기능은 role로 구분한다.
export const ROLES = {
  operator: { role: 'operator', side: 'kftc', title: '일반담당자', roleLabel: '일반 사용자 (운영 담당자)', label: '사용자', home: 'calc' },
  sysadmin: { role: 'sysadmin', side: 'kftc', title: '시스템관리자', roleLabel: '시스템 관리자', label: '관리자', home: 'admin' },
  institution: { role: 'institution', side: 'institution', title: '회비담당자', roleLabel: '참가기관 담당자', label: '참가기관', home: 'calc' },
};

export const DEFAULT_PASSWORD = 'kftc1234!!';

// 회원 = 로그인 계정. 관리자가 회원 관리에서 추가·수정·삭제한다. 모두 가상의 예시 인물이다.
// status: 정상 | 승인대기(가입 신청, 로그인 불가) | 반려
// tasks: 산출할 수 있는 업무(사용자 권한만 의미가 있다. 관리자는 전체, 참가기관은 산출하지 않음)
export const MEMBERS = [
  { id: 'hong', password: 'kftc1234!!', role: 'operator', name: '홍길동', org: '금융결제원', dept: '금융사업부 오픈뱅킹팀', empNo: 'KFTC-202601', email: 'gildong.hong@example.com', extension: '02-531-1234', status: '정상', joinedAt: '2026-01-05', tasks: ['openbanking', 'fininfo'] },
  { id: 'admin', password: 'kftc1234!!', role: 'sysadmin', name: '이수진', org: '금융결제원', dept: '정보시스템부 운영관리팀', empNo: 'KFTC-201804', email: 'sujin.lee@example.com', extension: '02-531-1100', status: '정상', joinedAt: '2018-04-02', tasks: [] },
  { id: 'shinhan', password: 'kftc1234!!', role: 'institution', institutionId: 'shinhan', name: '김철수', org: '신한은행', dept: '자금결제부', empNo: 'SH-10234', email: 'cheolsu.kim@example.com', extension: '02-2151-0000', status: '정상', joinedAt: '2025-03-10', tasks: [] },
  { id: 'kimms', password: 'kftc1234!!', role: 'operator', name: '김민수', org: '금융결제원', dept: '회비관리팀', empNo: 'KFTC-202203', email: 'minsu.kim@example.com', extension: '02-531-1250', status: '정상', joinedAt: '2022-03-02', tasks: ['cms', 'interbank'] },
  { id: 'woori01', password: 'kftc1234!!', role: 'institution', institutionId: 'woori', name: '박지훈', org: '우리은행', dept: '자금부', empNo: 'WR-20871', email: 'jihun.park@example.com', extension: '02-2002-0000', status: '정상', joinedAt: '2025-06-16', tasks: [] },
  { id: 'ibk02', password: 'kftc1234!!', role: 'institution', institutionId: 'ibk', name: '오세훈', org: 'IBK기업은행', dept: '전자금융부', empNo: 'IBK-3310', email: 'sehun.oh@example.com', extension: '02-729-0000', status: '정상', joinedAt: '2025-09-01', tasks: [] },
  { id: 'hana01', password: 'kftc1234!!', role: 'institution', institutionId: 'hana', name: '이민지', org: '하나은행', dept: '자금결제부', empNo: 'HN-5521', email: 'minji.lee@example.com', extension: '02-1599-0000', status: '승인대기', joinedAt: '2026-10-13', tasks: [] },
  { id: 'toss01', password: 'kftc1234!!', role: 'institution', institutionId: 'toss', name: '박준호', org: '토스뱅크', dept: '재무팀', empNo: 'TS-0192', email: 'junho.park@example.com', extension: '02-1661-0000', status: '승인대기', joinedAt: '2026-10-13', tasks: [] },
  { id: 'choisy', password: 'kftc1234!!', role: 'operator', name: '최서연', org: '금융결제원', dept: '회비관리팀', empNo: 'KFTC-202609', email: 'seoyeon.choi@example.com', extension: '02-531-1260', status: '승인대기', joinedAt: '2026-10-12', tasks: [] },
  { id: 'kakao01', password: 'kftc1234!!', role: 'institution', institutionId: 'kakao', name: '한지수', org: '카카오뱅크', dept: '정산팀', empNo: 'KK-0457', email: 'jisu.han@example.com', extension: '02-1599-3333', status: '반려', joinedAt: '2026-10-09', tasks: [] },
];

// 관리자 화면의 업무 권한 신청 예시
export const INITIAL_TASK_REQUESTS = [
  { id: 1, memberId: 'kimms', taskId: 'openbanking', reason: '오픈뱅킹 회비 산출 업무를 함께 맡게 되어 신청합니다.', requestedAt: '2026-10-19 10:20', status: '승인 대기중' },
  { id: 2, memberId: 'kimms', taskId: 'cd', reason: 'CD공동망 분기 대사 지원', requestedAt: '2026-10-02 15:41', status: '반려', decidedAt: '2026-10-03 09:10' },
];

// 상단바 알림 예시. roles: 이 알림을 받는 역할, target: 누르면 이동할 메뉴·하위 영역
export const INITIAL_NOTIFICATIONS = [
  { id: 'n1', roles: ['sysadmin'], title: '업무 권한 신청', body: '김민수님이 오픈뱅킹 산출 권한을 신청했습니다.', at: '2026-10-19 10:20', read: false, target: { menu: 'admin', section: 'admin-tasks' } },
  { id: 'n2', roles: ['sysadmin'], title: '가입 승인 대기', body: '하나은행·토스뱅크 등 3명이 가입 승인을 기다리고 있습니다.', at: '2026-10-13 17:05', read: false, target: { menu: 'admin', section: 'admin-members' } },
  { id: 'n3', roles: ['sysadmin'], title: '계정 잠금', body: '우리은행 박지훈님 계정이 비밀번호 5회 오류로 잠겼습니다.', at: '2026-10-19 16:42', read: true, target: { menu: 'admin', section: 'admin-members' } },
  { id: 'n4', roles: ['operator', 'sysadmin'], title: '대사 이슈 등록', body: 'A은행이 오픈뱅킹 3분기 대사 결과에 이슈를 등록했습니다.', at: '2026-10-21 14:12', read: false, target: { menu: 'results', section: 'results-recon' } },
  { id: 'n5', roles: ['operator', 'sysadmin'], title: '기관 테스트 오류', body: 'C은행 연동 테스트에서 예외사항이 발생했습니다.', at: '2026-10-20 11:30', read: false, target: { menu: 'results', section: 'results-test' } },
  { id: 'n6', roles: ['operator'], title: '권한 신청 결과', body: 'CD공동망 산출 권한 신청이 반려되었습니다.', at: '2026-10-03 09:10', read: true, target: { menu: 'mypage', section: 'mypage-tasks' } },
  { id: 'n7', roles: ['institution'], title: '회비 대사 요청', body: '오픈뱅킹 3분기 회비 산출 결과가 도착했습니다. 확인 후 회신해 주세요.', at: '2026-10-21 09:00', read: false, target: { menu: 'calc', section: 'calc-result' } },
  { id: 'n8', roles: ['institution'], title: '연동 테스트 결과', body: '10월 기관 연동 테스트 결과가 등록되었습니다.', at: '2026-10-18 15:20', read: true, target: { menu: 'results', section: 'results-test' } },
];

// 비밀번호 5회 오류로 잠긴 계정 예시 (실제 계정이 5회 틀리면 여기에 추가된다)
export const INITIAL_LOGIN_LOCKS = {
  woori01: { count: 5, lockedAt: '2026-10-19 16:42' },
  ibk02: { count: 5, lockedAt: '2026-10-20 09:15' },
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
  // 실적 엑셀 업로드 테스트용 가상 기관 (public/samples/cd-net-test-sample.xlsx). test: 시연용 예시 실적에는 나오지 않음
  { id: 't001', name: '한빛은행', code: 'T001', aliases: [], test: true },
  { id: 't002', name: '미래온은행', code: 'T002', aliases: [], test: true },
  { id: 't003', name: '새누리은행', code: 'T003', aliases: [], test: true },
  { id: 't004', name: '다온은행', code: 'T004', aliases: [], test: true },
  { id: 't005', name: '한울은행', code: 'T005', aliases: [], test: true },
  { id: 't006', name: '푸른솔은행', code: 'T006', aliases: [], test: true },
  { id: 't007', name: '이음은행', code: 'T007', aliases: [], test: true },
  { id: 't008', name: '가온은행', code: 'T008', aliases: [], test: true },
  { id: 't009', name: '세림은행', code: 'T009', aliases: [], test: true },
  { id: 't010', name: '태산은행', code: 'T010', aliases: [], test: true },
  { id: 't011', name: '에버온은행', code: 'T011', aliases: [], test: true },
  { id: 't012', name: '누리안은행', code: 'T012', aliases: [], test: true },
  { id: 't013', name: '동해미래은행', code: 'T013', aliases: [], test: true },
  { id: 't014', name: '서광은행', code: 'T014', aliases: [], test: true },
  { id: 't015', name: '제일누리은행', code: 'T015', aliases: [], test: true },
  { id: 't016', name: '신한울은행', code: 'T016', aliases: [], test: true },
  { id: 't017', name: '온누리디지털은행', code: 'T017', aliases: [], test: true },
  { id: 't018', name: '비전플러스은행', code: 'T018', aliases: [], test: true },
  { id: 't019', name: '하나온은행', code: 'T019', aliases: [], test: true },
  { id: 't020', name: '청명은행', code: 'T020', aliases: [], test: true },
  { id: 't021', name: '드림웨이은행', code: 'T021', aliases: [], test: true },
  { id: 't022', name: '한결은행', code: 'T022', aliases: [], test: true },
  { id: 't023', name: '에이스온은행', code: 'T023', aliases: [], test: true },
  { id: 't024', name: '대륙은행', code: 'T024', aliases: [], test: true },
  { id: 't025', name: '코어뱅크', code: 'T025', aliases: [], test: true },
  { id: 't026', name: '한빛투자증권', code: 'T026', aliases: [], test: true },
  { id: 't027', name: '미래온증권', code: 'T027', aliases: [], test: true },
  { id: 't028', name: '세림투자증권', code: 'T028', aliases: [], test: true },
  { id: 't029', name: '다온증권', code: 'T029', aliases: [], test: true },
  { id: 't030', name: '태산투자증권', code: 'T030', aliases: [], test: true },
  { id: 't031', name: '블루웨이증권', code: 'T031', aliases: [], test: true },
  { id: 't032', name: '프라임온증권', code: 'T032', aliases: [], test: true },
  { id: 't033', name: '이음투자증권', code: 'T033', aliases: [], test: true },
  { id: 't034', name: '한울증권', code: 'T034', aliases: [], test: true },
  { id: 't035', name: '넥스트밸류증권', code: 'T035', aliases: [], test: true },
  { id: 't036', name: '에버트러스트증권', code: 'T036', aliases: [], test: true },
  { id: 't037', name: '코어인베스트증권', code: 'T037', aliases: [], test: true },
  { id: 't038', name: '청명투자증권', code: 'T038', aliases: [], test: true },
  { id: 't039', name: '비전캐피탈증권', code: 'T039', aliases: [], test: true },
  { id: 't040', name: '오름투자증권', code: 'T040', aliases: [], test: true },
  { id: 't041', name: '누리안증권', code: 'T041', aliases: [], test: true },
  { id: 't042', name: '파인브릿지증권', code: 'T042', aliases: [], test: true },
  { id: 't051', name: '한빛생명보험', code: 'T051', aliases: [], test: true },
  { id: 't052', name: '미래온생명보험', code: 'T052', aliases: [], test: true },
  { id: 't053', name: '다온생명보험', code: 'T053', aliases: [], test: true },
  { id: 't054', name: '한울생명보험', code: 'T054', aliases: [], test: true },
  { id: 't055', name: '세림생명보험', code: 'T055', aliases: [], test: true },
  { id: 't056', name: '프라임온생명보험', code: 'T056', aliases: [], test: true },
  { id: 't057', name: '에버라이프생명보험', code: 'T057', aliases: [], test: true },
  { id: 't058', name: '청명생명보험', code: 'T058', aliases: [], test: true },
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

// baseVolume은 한 분기(약 91일) 실적이다. 산출 기간이 분기가 아니면 일수에 비례해 줄이거나 늘린다(scale).
export function getBaseCounts(businessId, from, to, scale = 1) {
  const biz = BUSINESSES.find((b) => b.id === businessId);
  return INSTITUTIONS.filter((inst) => !inst.test).map((inst) => {
    const r = seeded(`${businessId}-${from}-${to}-${inst.id}`);
    const volume = biz.baseVolume * scale * WEIGHTS[inst.id] * (0.85 + r * 0.3);
    const count = Math.max(10, Math.round(volume / 10) * 10);
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
