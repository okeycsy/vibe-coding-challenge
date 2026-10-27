package com.kftc.feecalc.common.config;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import com.kftc.feecalc.domain.auth.entity.LoginHistory;
import com.kftc.feecalc.domain.auth.entity.LoginResult;
import com.kftc.feecalc.domain.auth.repository.LoginHistoryRepository;
import com.kftc.feecalc.domain.fee.dto.CalculationRequest;
import com.kftc.feecalc.domain.fee.entity.Business;
import com.kftc.feecalc.domain.fee.entity.CalcMethod;
import com.kftc.feecalc.domain.fee.entity.Institution;
import com.kftc.feecalc.domain.fee.repository.BusinessRepository;
import com.kftc.feecalc.domain.fee.repository.InstitutionRepository;
import com.kftc.feecalc.domain.fee.service.FeeCalculationService;
import com.kftc.feecalc.domain.reconcile.entity.TestResult;
import com.kftc.feecalc.domain.reconcile.entity.TestResultStatus;
import com.kftc.feecalc.domain.reconcile.repository.TestResultRepository;
import com.kftc.feecalc.domain.user.entity.Member;
import com.kftc.feecalc.domain.user.entity.MemberRole;
import com.kftc.feecalc.domain.user.entity.MemberStatus;
import com.kftc.feecalc.domain.user.entity.TaskRequest;
import com.kftc.feecalc.domain.user.repository.MemberRepository;
import com.kftc.feecalc.domain.user.repository.TaskRequestRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 서버 기동 시 시연용 초기 더미 데이터 자동 적재.
 * 프론트엔드 src/data/mockData.js 와 같은 계정·업무·기관이며, 모두 가상의 예시 데이터다 (실제 회원·실적과 무관).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DataInitializer implements ApplicationRunner {

    /** 시연 계정 공통 기본 비밀번호 */
    public static final String DEFAULT_PASSWORD = "kftc1234!!";

    private final BusinessRepository businessRepository;
    private final InstitutionRepository institutionRepository;
    private final MemberRepository memberRepository;
    private final TaskRequestRepository taskRequestRepository;
    private final LoginHistoryRepository loginHistoryRepository;
    private final TestResultRepository testResultRepository;
    private final FeeCalculationService feeCalculationService;
    private final PasswordEncoder passwordEncoder;
    private final TransactionTemplate tx;

    @Override
    public void run(ApplicationArguments args) {
        if (memberRepository.count() > 0) {
            return;
        }
        tx.executeWithoutResult(s -> {
            loadBusinesses();
            loadInstitutions();
            loadMembers();
            loadTestResults();
        });
        loadSampleCalculation();
        log.info("시연용 더미 데이터 적재 완료: 업무 {}개, 기관 {}개, 회원 {}명",
                businessRepository.count(), institutionRepository.count(), memberRepository.count());
    }

    private void loadBusinesses() {
        businessRepository.saveAll(List.of(
                Business.builder().code("openbanking").name("오픈뱅킹").method(CalcMethod.UNIT)
                        .unitPrice(20L).baseVolume(4_200_000).revenueAccount("41101 회비수입-오픈뱅킹").sortOrder(1)
                        .summary(List.of(
                                "이용기관 API 호출 중 출금이체·입금이체 성공 건을 실적으로 인정",
                                "건당 단가 20원 적용 (조회성 API는 산정 제외)",
                                "장애·중복 전송 건은 증빙 확인 후 실적에서 차감"))
                        .build(),
                Business.builder().code("fininfo").name("금융거래정보(금거정)").method(CalcMethod.RATIO)
                        .totalFee(120_000_000L).baseVolume(650_000).revenueAccount("41102 회비수입-금융거래정보").sortOrder(2)
                        .summary(List.of(
                                "분기 운영비 총액 1억 2,000만원을 참가기관이 분담",
                                "분담률 = 기관별 최종 인정 건수 ÷ 전체 인정 건수",
                                "시험·테스트 전문은 실적에서 제외"))
                        .build(),
                Business.builder().code("cms").name("CMS").method(CalcMethod.UNIT)
                        .unitPrice(8L).baseVolume(9_800_000).revenueAccount("41103 회비수입-CMS").sortOrder(3)
                        .summary(List.of(
                                "자동이체 출금 의뢰 처리 건을 실적으로 인정",
                                "건당 단가 8원 적용",
                                "반송·불능 건도 처리 건수에 포함"))
                        .build(),
                Business.builder().code("cd").name("CD공동망").method(CalcMethod.RATIO)
                        .totalFee(300_000_000L).baseVolume(2_300_000).revenueAccount("41104 회비수입-CD공동망").sortOrder(4)
                        .summary(List.of(
                                "분기 공동망 운영비 총액 3억원을 참가기관이 분담",
                                "분담률 = 기관별 타행 CD/ATM 거래 인정 건수 비율",
                                "망 장애로 인한 재처리 건은 차감 대상"))
                        .build(),
                Business.builder().code("interbank").name("타행환").method(CalcMethod.UNIT)
                        .unitPrice(12L).baseVolume(7_500_000).revenueAccount("41105 회비수입-타행환").sortOrder(5)
                        .summary(List.of(
                                "타행 송금 의뢰 성공 건을 실적으로 인정",
                                "건당 단가 12원 적용",
                                "정정·취소 전문은 산정 제외"))
                        .build()));
    }

    private void loadInstitutions() {
        // aliases 의 A~H은행은 AI 이슈 시연용 가명 매핑
        institutionRepository.saveAll(List.of(
                inst("shinhan", "신한은행", "B088", 1.15, 1, "신한", "A은행"),
                inst("kb", "KB국민은행", "B004", 1.25, 2, "국민", "KB", "B은행"),
                inst("woori", "우리은행", "B020", 1.0, 3, "우리", "C은행"),
                inst("hana", "하나은행", "B081", 0.95, 4, "하나", "D은행"),
                inst("nh", "NH농협은행", "B011", 1.1, 5, "농협", "NH", "E은행"),
                inst("ibk", "IBK기업은행", "B003", 0.8, 6, "기업", "IBK", "F은행"),
                inst("kakao", "카카오뱅크", "B090", 0.7, 7, "카카오", "G은행"),
                inst("toss", "토스뱅크", "B092", 0.45, 8, "토스", "H은행")));
        // 실적 엑셀 업로드 테스트용 가상 기관 (public/samples/cd-net-test-sample.xlsx 의 기관코드·금융기관명).
        // 가중치 0 이라 시연용 예시 실적에는 나오지 않고, 업로드한 파일에 있을 때만 산출 대상이 된다.
        institutionRepository.saveAll(List.of(
                inst("t001", "한빛은행", "T001", 0, 9),
                inst("t002", "미래온은행", "T002", 0, 10),
                inst("t003", "새누리은행", "T003", 0, 11),
                inst("t004", "다온은행", "T004", 0, 12),
                inst("t005", "한울은행", "T005", 0, 13),
                inst("t006", "푸른솔은행", "T006", 0, 14),
                inst("t007", "이음은행", "T007", 0, 15),
                inst("t008", "가온은행", "T008", 0, 16),
                inst("t009", "세림은행", "T009", 0, 17),
                inst("t010", "태산은행", "T010", 0, 18),
                inst("t011", "에버온은행", "T011", 0, 19),
                inst("t012", "누리안은행", "T012", 0, 20),
                inst("t013", "동해미래은행", "T013", 0, 21),
                inst("t014", "서광은행", "T014", 0, 22),
                inst("t015", "제일누리은행", "T015", 0, 23),
                inst("t016", "신한울은행", "T016", 0, 24),
                inst("t017", "온누리디지털은행", "T017", 0, 25),
                inst("t018", "비전플러스은행", "T018", 0, 26),
                inst("t019", "하나온은행", "T019", 0, 27),
                inst("t020", "청명은행", "T020", 0, 28),
                inst("t021", "드림웨이은행", "T021", 0, 29),
                inst("t022", "한결은행", "T022", 0, 30),
                inst("t023", "에이스온은행", "T023", 0, 31),
                inst("t024", "대륙은행", "T024", 0, 32),
                inst("t025", "코어뱅크", "T025", 0, 33),
                inst("t026", "한빛투자증권", "T026", 0, 34),
                inst("t027", "미래온증권", "T027", 0, 35),
                inst("t028", "세림투자증권", "T028", 0, 36),
                inst("t029", "다온증권", "T029", 0, 37),
                inst("t030", "태산투자증권", "T030", 0, 38),
                inst("t031", "블루웨이증권", "T031", 0, 39),
                inst("t032", "프라임온증권", "T032", 0, 40),
                inst("t033", "이음투자증권", "T033", 0, 41),
                inst("t034", "한울증권", "T034", 0, 42),
                inst("t035", "넥스트밸류증권", "T035", 0, 43),
                inst("t036", "에버트러스트증권", "T036", 0, 44),
                inst("t037", "코어인베스트증권", "T037", 0, 45),
                inst("t038", "청명투자증권", "T038", 0, 46),
                inst("t039", "비전캐피탈증권", "T039", 0, 47),
                inst("t040", "오름투자증권", "T040", 0, 48),
                inst("t041", "누리안증권", "T041", 0, 49),
                inst("t042", "파인브릿지증권", "T042", 0, 50),
                inst("t051", "한빛생명보험", "T051", 0, 51),
                inst("t052", "미래온생명보험", "T052", 0, 52),
                inst("t053", "다온생명보험", "T053", 0, 53),
                inst("t054", "한울생명보험", "T054", 0, 54),
                inst("t055", "세림생명보험", "T055", 0, 55),
                inst("t056", "프라임온생명보험", "T056", 0, 56),
                inst("t057", "에버라이프생명보험", "T057", 0, 57),
                inst("t058", "청명생명보험", "T058", 0, 58)));
        // 오픈뱅킹 API 처리건수 테스트 파일(기준월 | 기관명 | API 종류별 건수)의 가상 기관. 위와 같이 업로드할 때만 산출 대상
        institutionRepository.saveAll(List.of(
                inst("o001", "우체국", "O001", 0, 59),
                inst("o002", "새솔은행", "O002", 0, 60),
                inst("o003", "푸른들은행", "O003", 0, 61),
                inst("o004", "서해은행", "O004", 0, 62),
                inst("o005", "동백은행", "O005", 0, 63),
                inst("o006", "누리은행", "O006", 0, 64),
                inst("o007", "하늘은행", "O007", 0, 65),
                inst("o008", "봄빛은행", "O008", 0, 66),
                inst("o009", "한마음저축은행", "O009", 0, 67),
                inst("o010", "나래저축은행", "O010", 0, 68),
                inst("o011", "온유저축은행", "O011", 0, 69),
                inst("o012", "바른저축은행", "O012", 0, 70),
                inst("o013", "길벗저축은행", "O013", 0, 71),
                inst("o014", "새길저축은행", "O014", 0, 72),
                inst("o015", "라온저축은행", "O015", 0, 73),
                inst("o016", "별하저축은행", "O016", 0, 74),
                inst("o017", "참좋은저축은행", "O017", 0, 75),
                inst("o018", "맑은저축은행", "O018", 0, 76),
                inst("o019", "가온페이", "O019", 0, 77),
                inst("o020", "바로페이", "O020", 0, 78),
                inst("o021", "이음페이", "O021", 0, 79),
                inst("o022", "플러스페이", "O022", 0, 80),
                inst("o023", "스마일페이", "O023", 0, 81),
                inst("o024", "새봄페이", "O024", 0, 82),
                inst("o025", "파란페이", "O025", 0, 83),
                inst("o026", "넥스트페이", "O026", 0, 84),
                inst("o027", "링크페이", "O027", 0, 85),
                inst("o028", "오름페이", "O028", 0, 86),
                inst("o029", "네모페이", "O029", 0, 87),
                inst("o030", "모아페이", "O030", 0, 88),
                inst("o031", "큰나무핀테크", "O031", 0, 89),
                inst("o032", "오로라핀테크", "O032", 0, 90),
                inst("o033", "하모니핀테크", "O033", 0, 91),
                inst("o034", "에코핀테크", "O034", 0, 92),
                inst("o035", "리버핀테크", "O035", 0, 93),
                inst("o036", "아이리스핀테크", "O036", 0, 94),
                inst("o037", "모아자산관리", "O037", 0, 95),
                inst("o038", "라움자산관리", "O038", 0, 96),
                inst("o039", "더원자산관리", "O039", 0, 97),
                inst("o040", "포레스트금융", "O040", 0, 98),
                inst("o041", "크레센트금융", "O041", 0, 99),
                inst("o042", "브릿지금융", "O042", 0, 100),
                inst("o043", "스마트송금", "O043", 0, 101),
                inst("o044", "온길송금", "O044", 0, 102),
                inst("o045", "마루송금", "O045", 0, 103),
                inst("o046", "나래송금", "O046", 0, 104)));
    }

    private Institution inst(String code, String name, String bankCode, double weight, int order, String... aliases) {
        return Institution.builder().code(code).name(name).bankCode(bankCode).volumeWeight(weight).sortOrder(order)
                .aliases(List.of(aliases)).build();
    }

    private void loadMembers() {
        String pw = passwordEncoder.encode(DEFAULT_PASSWORD);
        Member hong = member("hong", pw, MemberRole.OPERATOR, null, "홍길동", "금융결제원", "금융사업부 오픈뱅킹팀",
                "KFTC-202601", "gildong.hong@example.com", "02-531-1234", MemberStatus.ACTIVE, "2026-01-05");
        Member admin = member("admin", pw, MemberRole.SYSADMIN, null, "이수진", "금융결제원", "정보시스템부 운영관리팀",
                "KFTC-201804", "sujin.lee@example.com", "02-531-1100", MemberStatus.ACTIVE, "2018-04-02");
        Member shinhan = member("shinhan", pw, MemberRole.INSTITUTION, "shinhan", "김철수", "신한은행", "자금결제부",
                "SH-10234", "cheolsu.kim@example.com", "02-2151-0000", MemberStatus.ACTIVE, "2025-03-10");
        Member kimms = member("kimms", pw, MemberRole.OPERATOR, null, "김민수", "금융결제원", "회비관리팀",
                "KFTC-202203", "minsu.kim@example.com", "02-531-1250", MemberStatus.ACTIVE, "2022-03-02");
        Member woori = member("woori01", pw, MemberRole.INSTITUTION, "woori", "박지훈", "우리은행", "자금부",
                "WR-20871", "jihun.park@example.com", "02-2002-0000", MemberStatus.ACTIVE, "2025-06-16");
        Member ibk = member("ibk02", pw, MemberRole.INSTITUTION, "ibk", "오세훈", "IBK기업은행", "전자금융부",
                "IBK-3310", "sehun.oh@example.com", "02-729-0000", MemberStatus.ACTIVE, "2025-09-01");
        Member hana = member("hana01", pw, MemberRole.INSTITUTION, "hana", "이민지", "하나은행", "자금결제부",
                "HN-5521", "minji.lee@example.com", "02-1599-0000", MemberStatus.PENDING, "2026-10-13");
        Member toss = member("toss01", pw, MemberRole.INSTITUTION, "toss", "박준호", "토스뱅크", "재무팀",
                "TS-0192", "junho.park@example.com", "02-1661-0000", MemberStatus.PENDING, "2026-10-13");
        Member choisy = member("choisy", pw, MemberRole.OPERATOR, null, "최서연", "금융결제원", "회비관리팀",
                "KFTC-202609", "seoyeon.choi@example.com", "02-531-1260", MemberStatus.PENDING, "2026-10-12");
        Member kakao = member("kakao01", pw, MemberRole.INSTITUTION, "kakao", "한지수", "카카오뱅크", "정산팀",
                "KK-0457", "jisu.han@example.com", "02-1599-3333", MemberStatus.REJECTED, "2026-10-09");

        // 담당 업무 권한(RBAC)
        LocalDateTime granted = LocalDateTime.of(2026, 1, 5, 9, 0);
        hong.grantTask("openbanking", granted);
        hong.grantTask("fininfo", granted);
        kimms.grantTask("cms", granted);
        kimms.grantTask("interbank", granted);

        // 비밀번호 5회 오류로 잠긴 계정
        woori.lock(5, LocalDateTime.of(2026, 10, 19, 16, 42));
        ibk.lock(5, LocalDateTime.of(2026, 10, 20, 9, 15));

        memberRepository.saveAll(List.of(hong, admin, shinhan, kimms, woori, ibk, hana, toss, choisy, kakao));

        // 업무 권한 신청 예시
        taskRequestRepository.save(new TaskRequest(kimms, "openbanking",
                "오픈뱅킹 회비 산출 업무를 함께 맡게 되어 신청합니다.", LocalDateTime.of(2026, 10, 19, 10, 20)));
        TaskRequest rejected = new TaskRequest(kimms, "cd", "CD공동망 분기 대사 지원",
                LocalDateTime.of(2026, 10, 2, 15, 41));
        rejected.reject(LocalDateTime.of(2026, 10, 3, 9, 10));
        taskRequestRepository.save(rejected);

        // 접속 이력 예시 (IP는 사설 대역 예시값)
        Map<LocalDateTime, Object[]> history = Map.of(
                LocalDateTime.of(2026, 10, 19, 18, 2), new Object[] {LoginResult.LOGOUT, "192.168.10.45", "Chrome / Windows"},
                LocalDateTime.of(2026, 10, 19, 8, 51), new Object[] {LoginResult.SUCCESS, "192.168.10.45", "Chrome / Windows"},
                LocalDateTime.of(2026, 10, 18, 9, 3), new Object[] {LoginResult.SUCCESS, "192.168.10.45", "Chrome / Windows"},
                LocalDateTime.of(2026, 10, 17, 8, 47), new Object[] {LoginResult.WRONG_PASSWORD, "192.168.10.52", "Edge / Windows"});
        history.forEach((at, v) -> loginHistoryRepository.save(
                new LoginHistory("hong", (LoginResult) v[0], (String) v[1], (String) v[2], at)));
    }

    private Member member(String loginId, String pw, MemberRole role, String institutionCode, String name, String org,
                          String dept, String empNo, String email, String extension, MemberStatus status, String joinedAt) {
        return Member.builder().loginId(loginId).passwordHash(pw).role(role).institutionCode(institutionCode)
                .name(name).org(org).dept(dept).empNo(empNo).email(email).extension(extension)
                .status(status).joinedAt(LocalDate.parse(joinedAt)).build();
    }

    private void loadTestResults() {
        testResultRepository.saveAll(List.of(
                test("shinhan", "신한은행", "openbanking", "오픈뱅킹", "출금이체 API 연동", "2026-10-08T14:20", TestResultStatus.SUCCESS, "-"),
                test("kb", "KB국민은행", "cms", "CMS", "출금의뢰 파일 포맷 검증", "2026-10-08T16:05", TestResultStatus.SUCCESS, "-"),
                test("woori", "우리은행", "interbank", "타행환", "정정 전문 처리", "2026-10-09T10:12", TestResultStatus.FAIL, "응답코드 매핑 오류, 재테스트 예정"),
                test("kakao", "카카오뱅크", "openbanking", "오픈뱅킹", "입금이체 API 연동", "2026-10-10T09:40", TestResultStatus.SUCCESS, "-"),
                test("nh", "NH농협은행", "cd", "CD공동망", "타행 출금 거래 대사파일", "2026-10-11T11:30", TestResultStatus.IN_PROGRESS, "대사파일 수신 대기"),
                test("toss", "토스뱅크", "fininfo", "금융거래정보(금거정)", "조회 전문 송수신", "2026-10-12T15:55", TestResultStatus.FAIL, "타임아웃 3회 발생"),
                test("hana", "하나은행", "interbank", "타행환", "송금 전문 처리", "2026-10-13T13:00", TestResultStatus.SUCCESS, "-")));
    }

    private TestResult test(String instCode, String instName, String bizCode, String bizName, String item, String at,
                            TestResultStatus result, String note) {
        return TestResult.builder().institutionCode(instCode).institutionName(instName).businessCode(bizCode)
                .businessName(bizName).item(item).testedAt(LocalDateTime.parse(at)).result(result).note(note).build();
    }

    /** 대사 화면이 비어 보이지 않도록 2026년 3분기 오픈뱅킹 산출 1건을 미리 만든다 */
    private void loadSampleCalculation() {
        feeCalculationService.calculate(new CalculationRequest("openbanking",
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 9, 30),
                List.of("5월 3일 A은행 시스템 장애로 인해 중복 전송된 1,500건은 실적에서 제외하고 산출해 줘.",
                        "카카오뱅크 테스트 전문 2,300건은 실적에서 빼 줘."),
                null, null, "hong"), false);
    }
}
