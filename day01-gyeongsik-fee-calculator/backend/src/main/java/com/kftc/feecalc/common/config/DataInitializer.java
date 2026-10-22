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
    public static final String DEFAULT_PASSWORD = "1234";

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
                null, null, "hong"));
    }
}
