package com.kftc.feecalc.domain.reconcile.service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.kftc.feecalc.common.event.FeeCalculatedEvent;
import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;
import com.kftc.feecalc.domain.fee.dto.CalculationResponse;
import com.kftc.feecalc.domain.fee.service.FeeCalculationService;
import com.kftc.feecalc.domain.reconcile.dto.NotificationResult;
import com.kftc.feecalc.domain.reconcile.dto.ReconcileRecordResponse;
import com.kftc.feecalc.domain.reconcile.dto.ReconcileSummary;
import com.kftc.feecalc.domain.reconcile.dto.StatusUpdateRequest;
import com.kftc.feecalc.domain.reconcile.dto.TestResultResponse;
import com.kftc.feecalc.domain.reconcile.entity.ReconcileRecord;
import com.kftc.feecalc.domain.reconcile.entity.ReconcileStatus;
import com.kftc.feecalc.domain.reconcile.entity.TestResult;
import com.kftc.feecalc.domain.reconcile.entity.TestResultStatus;
import com.kftc.feecalc.domain.reconcile.repository.ReconcileRecordRepository;
import com.kftc.feecalc.domain.reconcile.repository.TestResultRepository;

import lombok.RequiredArgsConstructor;

/** 참가기관 대사·연동 테스트 결과 관리, 수행률 집계, Mattermost 알림 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ReconcileService {

    private final ReconcileRecordRepository recordRepository;
    private final TestResultRepository testResultRepository;
    private final FeeCalculationService calculationService;
    private final MattermostNotifier notifier;

    /** 회비 산출이 끝나면 같은 트랜잭션에서 기관별 대사 내역을 '대기'로 만든다 */
    @EventListener
    @Transactional
    public void onFeeCalculated(FeeCalculatedEvent event) {
        CalculationResponse calc = calculationService.getCalculationInfo(event.calculationId());
        LocalDateTime now = LocalDateTime.now();
        for (CalculationResponse.Item item : calc.items()) {
            recordRepository.save(ReconcileRecord.builder()
                    .calculationId(calc.id())
                    .businessCode(calc.businessId())
                    .businessName(calc.businessName())
                    .periodLabel(calc.periodLabel())
                    .institutionCode(item.institutionId())
                    .institutionName(item.name())
                    .finalCount(item.finalCount())
                    .fee(item.fee())
                    .createdAt(now)
                    .build());
        }
    }

    // ---------- 대사 ----------

    /** calculationId 또는 institutionId(참가기관 뷰)로 거른다. 둘 다 없으면 전체 */
    public List<ReconcileRecordResponse> getRecords(Long calculationId, String institutionId) {
        List<ReconcileRecord> list;
        if (calculationId != null) {
            list = recordRepository.findByCalculationIdOrderById(calculationId);
        } else if (institutionId != null && !institutionId.isBlank()) {
            list = recordRepository.findByInstitutionCodeOrderByIdDesc(institutionId);
        } else {
            list = recordRepository.findAllByOrderByCalculationIdDescIdAsc();
        }
        return list.stream()
                .filter(r -> institutionId == null || institutionId.isBlank() || r.getInstitutionCode().equals(institutionId))
                .map(ReconcileRecordResponse::from).toList();
    }

    @Transactional
    public ReconcileRecordResponse updateStatus(Long recordId, StatusUpdateRequest req) {
        ReconcileRecord record = recordRepository.findById(recordId)
                .orElseThrow(() -> new BusinessException(ErrorCode.RECONCILE_NOT_FOUND));
        ReconcileStatus next = ReconcileStatus.parse(req.status());
        record.changeStatus(next, req.comment(), LocalDateTime.now());
        if (next == ReconcileStatus.DONE) {
            notifier.send(String.format("[대사 완료] %s %s · %s", record.getBusinessName(), record.getPeriodLabel(),
                    record.getInstitutionName()));
        }
        return ReconcileRecordResponse.from(record);
    }

    /** 참가기관 송부: 대기 중인 기관을 확인중으로 바꾸고 알림을 보낸다 */
    @Transactional
    public List<ReconcileRecordResponse> sendToInstitutions(Long calculationId) {
        List<ReconcileRecord> records = recordRepository.findByCalculationIdOrderById(calculationId);
        if (records.isEmpty()) {
            throw new BusinessException(ErrorCode.RECONCILE_NOT_FOUND);
        }
        LocalDateTime now = LocalDateTime.now();
        long sent = records.stream().filter(r -> r.markSent(now)).count();
        ReconcileRecord first = records.get(0);
        notifier.send(String.format("[대사 요청] %s %s 회비 대사 파일을 %d개 기관에 송부했습니다.",
                first.getBusinessName(), first.getPeriodLabel(), sent));
        return records.stream().map(ReconcileRecordResponse::from).toList();
    }

    // ---------- 수행률 집계 ----------

    public ReconcileSummary getSummary() {
        List<ReconcileRecord> all = recordRepository.findAllByOrderByCalculationIdDescIdAsc();
        Map<Long, List<ReconcileRecord>> byCalc = new LinkedHashMap<>();
        all.forEach(r -> byCalc.computeIfAbsent(r.getCalculationId(), k -> new ArrayList<>()).add(r));

        List<ReconcileSummary.ByCalculation> rows = byCalc.entrySet().stream().map(e -> {
            List<ReconcileRecord> rs = e.getValue();
            long[] c = countStatus(rs);
            return new ReconcileSummary.ByCalculation(e.getKey(), rs.get(0).getBusinessName(),
                    rs.get(0).getPeriodLabel(), rs.size(), c[0], c[1], c[2], rate(c[2], rs.size()));
        }).toList();

        long[] c = countStatus(all);
        ReconcileSummary.Overall overall = new ReconcileSummary.Overall(all.size(), c[0], c[1], c[2], rate(c[2], all.size()));

        List<TestResult> tests = testResultRepository.findAll();
        long success = tests.stream().filter(t -> t.getResult() == TestResultStatus.SUCCESS).count();
        long fail = tests.stream().filter(t -> t.getResult() == TestResultStatus.FAIL).count();
        long progress = tests.size() - success - fail;
        ReconcileSummary.TestStats testStats =
                new ReconcileSummary.TestStats(tests.size(), success, fail, progress, rate(success, tests.size()));

        return new ReconcileSummary(overall, rows, testStats);
    }

    // ---------- 연동 테스트 ----------

    public List<TestResultResponse> getTests(String institutionId) {
        List<TestResult> list = institutionId == null || institutionId.isBlank()
                ? testResultRepository.findAllByOrderByTestedAtDesc()
                : testResultRepository.findByInstitutionCodeOrderByTestedAtDesc(institutionId);
        return list.stream().map(TestResultResponse::from).toList();
    }

    @Transactional
    public TestResultResponse updateTest(Long id, StatusUpdateRequest req) {
        TestResult test = getTest(id);
        TestResultStatus next = TestResultStatus.parse(req.status());
        test.update(next, req.comment(), LocalDateTime.now());
        if (next == TestResultStatus.FAIL) {
            notifier.send(String.format("[테스트 실패] %s · %s · %s — %s", test.getInstitutionName(),
                    test.getBusinessName(), test.getItem(), test.getNote()));
        }
        return TestResultResponse.from(test);
    }

    @Transactional
    public TestResultResponse requestRetest(Long id) {
        TestResult test = getTest(id);
        test.requestRetest(LocalDateTime.now());
        notifier.send(String.format("[재테스트 요청] %s · %s · %s (%d회차)", test.getInstitutionName(),
                test.getBusinessName(), test.getItem(), test.getRetestCount()));
        return TestResultResponse.from(test);
    }

    public NotificationResult sendTestNotification(String text) {
        return notifier.send("[테스트 발송] " + text);
    }

    private TestResult getTest(Long id) {
        return testResultRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.TEST_RESULT_NOT_FOUND));
    }

    /** [대기, 확인중, 완료] */
    private long[] countStatus(List<ReconcileRecord> rs) {
        long[] c = new long[3];
        rs.forEach(r -> c[r.getStatus().ordinal()]++);
        return c;
    }

    /** 백분율, 소수 첫째 자리 */
    private double rate(long part, long total) {
        return total == 0 ? 0 : Math.round(part * 1000.0 / total) / 10.0;
    }
}
