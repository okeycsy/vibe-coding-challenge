package com.kftc.feecalc.domain.fee.service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.kftc.feecalc.common.event.FeeCalculatedEvent;
import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;
import com.kftc.feecalc.domain.fee.dto.BusinessRateUpdateRequest;
import com.kftc.feecalc.domain.fee.dto.BusinessResponse;
import com.kftc.feecalc.domain.fee.dto.CalculationRequest;
import com.kftc.feecalc.domain.fee.dto.CalculationResponse;
import com.kftc.feecalc.domain.fee.dto.CalculationSummary;
import com.kftc.feecalc.domain.fee.dto.InstitutionCount;
import com.kftc.feecalc.domain.fee.dto.InstitutionResponse;
import com.kftc.feecalc.domain.fee.dto.ParsedIssue;
import com.kftc.feecalc.domain.fee.entity.AiIssue;
import com.kftc.feecalc.domain.fee.entity.Business;
import com.kftc.feecalc.domain.fee.entity.CalcMethod;
import com.kftc.feecalc.domain.fee.entity.FeeCalculation;
import com.kftc.feecalc.domain.fee.entity.FeeCalculationItem;
import com.kftc.feecalc.domain.fee.entity.Institution;
import com.kftc.feecalc.domain.fee.repository.BusinessRepository;
import com.kftc.feecalc.domain.fee.repository.FeeCalculationRepository;
import com.kftc.feecalc.domain.fee.repository.InstitutionRepository;
import com.kftc.feecalc.domain.user.service.UserService;

import lombok.RequiredArgsConstructor;

/**
 * 회비 산출.
 * 1) 기관별 기준 실적(업로드 또는 시연용) → 2) AI 이슈 차감 → 3) 방식별 회비 계산
 * - 건당 단가(UNIT): 최종 인정 건수 × 단가
 * - 총액 분담(RATIO): 기간 환산 총액을 인정 건수 비율로 나누고, 원 미만은 최대잔여법으로 배정해 합계 = 총액을 보장
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FeeCalculationService {

    private final BusinessRepository businessRepository;
    private final InstitutionRepository institutionRepository;
    private final FeeCalculationRepository calculationRepository;
    private final AiIssueParser issueParser;
    private final DemoVolumeGenerator demoVolumeGenerator;
    private final UserService userService;
    private final ApplicationEventPublisher eventPublisher;

    // ---------- 기준 정보 ----------

    public List<BusinessResponse> getBusinesses() {
        return businessRepository.findAllByOrderBySortOrder().stream().map(BusinessResponse::from).toList();
    }

    public BusinessResponse getBusinessInfo(String code) {
        return BusinessResponse.from(getBusiness(code));
    }

    @Transactional
    public BusinessResponse updateRate(String code, BusinessRateUpdateRequest req) {
        Business business = getBusiness(code);
        business.updateRate(req.unitPrice(), req.totalFee());
        return BusinessResponse.from(business);
    }

    public List<InstitutionResponse> getInstitutions() {
        return institutionRepository.findAllByOrderBySortOrder().stream().map(InstitutionResponse::from).toList();
    }

    public ParsedIssue parseIssue(String text) {
        return issueParser.parse(text, institutionRepository.findAllByOrderBySortOrder());
    }

    // ---------- 산출 ----------

    @Transactional
    public CalculationResponse calculate(CalculationRequest req) {
        Business business = getBusiness(req.businessId());
        if (req.requestedBy() != null && !req.requestedBy().isBlank()) {
            userService.checkCalculatePermission(req.requestedBy(), business.getCode());
        }
        Period period = Period.of(req.from(), req.to());
        double scale = period.scale();
        List<Institution> institutions = institutionRepository.findAllByOrderBySortOrder();
        boolean uploaded = req.counts() != null && !req.counts().isEmpty();

        FeeCalculation calc = FeeCalculation.builder()
                .business(business)
                .periodFrom(period.from())
                .periodTo(period.to())
                .periodScale(scale)
                .appliedUnitPrice(business.getMethod() == CalcMethod.UNIT ? business.getUnitPrice() : null)
                .appliedTotalFee(business.getMethod() == CalcMethod.RATIO ? Math.round(business.getTotalFee() * scale) : null)
                .source(uploaded ? "UPLOAD" : "DEMO")
                .uploadFileName(req.uploadFileName())
                .calculatedBy(req.requestedBy())
                .calculatedAt(LocalDateTime.now())
                .build();

        // 1) AI 이슈 해석
        List<ParsedIssue> parsed = (req.issues() == null ? List.<String>of() : req.issues()).stream()
                .filter(t -> t != null && !t.isBlank())
                .map(t -> issueParser.parse(t.trim(), institutions))
                .toList();
        for (ParsedIssue p : parsed) {
            calc.addIssue(AiIssue.builder()
                    .text(p.text()).institutionCode(p.institutionId()).institutionName(p.institutionName())
                    .matchedAlias(p.matchedAlias()).count(p.count()).issueDate(p.date()).reason(p.reason())
                    .applied(p.applicable())
                    .build());
        }

        // 2) 기관별 기준 실적 → 차감
        Map<String, Long> baseCounts = baseCounts(req, business, period, institutions);
        int order = 0;
        for (Institution inst : institutions) {
            Long base = baseCounts.get(inst.getCode());
            if (base == null) {
                continue;
            }
            List<ParsedIssue> related = parsed.stream()
                    .filter(ParsedIssue::applicable)
                    .filter(p -> p.institutionId().equals(inst.getCode()))
                    .toList();
            long deduction = Math.min(base, related.stream().mapToLong(ParsedIssue::count).sum());
            calc.addItem(FeeCalculationItem.builder()
                    .institutionCode(inst.getCode()).institutionName(inst.getName()).bankCode(inst.getBankCode())
                    .baseCount(base).deduction(deduction)
                    .deductionReasons(String.join("\n", related.stream().map(ParsedIssue::text).toList()))
                    .sortOrder(order++)
                    .build());
        }

        // 3) 회비 계산
        if (business.getMethod() == CalcMethod.UNIT) {
            long price = business.getUnitPrice();
            calc.getItems().forEach(i -> i.applyFee(i.getFinalCount() * price, price + "원/건"));
        } else {
            allocateByRatio(calc.getItems(), calc.getAppliedTotalFee());
        }

        FeeCalculation saved = calculationRepository.save(calc);
        eventPublisher.publishEvent(new FeeCalculatedEvent(saved.getId()));
        return CalculationResponse.from(saved);
    }

    public List<CalculationSummary> getCalculations() {
        return calculationRepository.findAllByOrderByCalculatedAtDesc().stream().map(CalculationSummary::from).toList();
    }

    public CalculationResponse getCalculationInfo(Long id) {
        return CalculationResponse.from(getCalculation(id));
    }

    public FeeCalculation getCalculation(Long id) {
        return calculationRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.CALCULATION_NOT_FOUND));
    }

    private Map<String, Long> baseCounts(CalculationRequest req, Business business, Period period,
                                         List<Institution> institutions) {
        Map<String, Long> result = new LinkedHashMap<>();
        if (req.counts() != null && !req.counts().isEmpty()) {
            for (InstitutionCount c : req.counts()) {
                if (institutions.stream().noneMatch(i -> i.getCode().equals(c.institutionId()))) {
                    throw new BusinessException(ErrorCode.INVALID_INPUT, "알 수 없는 기관입니다: " + c.institutionId());
                }
                result.merge(c.institutionId(), c.baseCount(), Long::sum);
            }
            return result;
        }
        for (Institution inst : institutions) {
            result.put(inst.getCode(), demoVolumeGenerator.baseCount(business, period, inst));
        }
        return result;
    }

    /** 총액을 인정 건수 비율로 나눈다. 원 미만은 버린 뒤 남은 원을 나머지가 큰 기관부터 1원씩 배정한다. */
    static void allocateByRatio(List<FeeCalculationItem> items, long totalFee) {
        long totalFinal = items.stream().mapToLong(FeeCalculationItem::getFinalCount).sum();
        if (totalFinal == 0) {
            items.forEach(i -> i.applyFee(0, "0.00%"));
            return;
        }
        long[] fees = new long[items.size()];
        List<long[]> remainders = new ArrayList<>(); // [index, remainder]
        long assigned = 0;
        for (int idx = 0; idx < items.size(); idx++) {
            long fc = items.get(idx).getFinalCount();
            // totalFee(억 단위) × fc(백만 단위)는 long 범위 안이다
            fees[idx] = Math.multiplyExact(totalFee, fc) / totalFinal;
            remainders.add(new long[] {idx, Math.multiplyExact(totalFee, fc) % totalFinal});
            assigned += fees[idx];
        }
        long left = totalFee - assigned;
        remainders.sort(Comparator.<long[]>comparingLong(r -> r[1]).reversed().thenComparingLong(r -> r[0]));
        for (int k = 0; k < left; k++) {
            fees[(int) remainders.get(k)[0]]++;
        }
        for (int idx = 0; idx < items.size(); idx++) {
            FeeCalculationItem item = items.get(idx);
            double share = (double) item.getFinalCount() / totalFinal * 100;
            item.applyFee(fees[idx], String.format("%.2f%%", share));
        }
    }

    private Business getBusiness(String code) {
        return businessRepository.findById(code)
                .orElseThrow(() -> new BusinessException(ErrorCode.BUSINESS_NOT_FOUND));
    }
}
