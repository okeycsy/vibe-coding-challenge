package com.kftc.feecalc.domain.fee.service;

import java.time.LocalDateTime;
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
 * 1) 기관별 기준 실적(업로드 또는 시연용) → 2) AI 이슈 차감 → 3) 업무별 skill.md 의 SpEL 수식으로 회비 계산
 * 산정 방식(구간 단가, 총액 분담, 기본료 등)은 Java 코드가 아니라 skill.md 에만 있다. {@link SkillEngineService} 참고
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
    private final SkillEngineService skillEngine;

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
        // businessId 에는 업무 ID(openbanking)나 skill.md 업무 코드(OPEN_BANKING) 모두 쓸 수 있다
        Business business = getBusiness(skillEngine.businessIdOf(req.businessId()));
        SkillEngineService.ParsedSkill skill = skillEngine.getSkill(business.getCode());
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
                .skillCode(skill.taskCode())
                .appliedCalcType(skill.calcType())
                .appliedFormula(skill.formula())
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

        // 3) 회비 계산: skill.md 수식 실행
        applySkill(calc.getItems(), skill, scale);
        calc.applyTotalFee(calc.getTotalFeeAmount());

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

    /**
     * 기관별로 skill.md 수식을 실행해 회비를 매긴다. 표시 단위가 "원/건"이면 실효 단가(회비 ÷ 인정 건수),
     * 그 밖에는 회비 합계 대비 비율을 rateLabel 로 남긴다.
     */
    private void applySkill(List<FeeCalculationItem> items, SkillEngineService.ParsedSkill skill, double scale) {
        List<Long> fees = skillEngine.calculateAll(skill.taskCode(),
                items.stream().map(i -> new SkillEngineService.Counts(i.getBaseCount(), i.getDeduction(), i.getFinalCount()))
                        .toList(),
                scale);
        long feeSum = fees.stream().mapToLong(Long::longValue).sum();
        boolean perCount = skill.rateUnit().contains("건");
        for (int idx = 0; idx < items.size(); idx++) {
            FeeCalculationItem item = items.get(idx);
            long fee = fees.get(idx);
            String label;
            if (perCount) {
                double unit = item.getFinalCount() == 0 ? 0 : (double) fee / item.getFinalCount();
                label = (unit == Math.rint(unit) ? String.format("%,.0f", unit) : String.format("%,.2f", unit)) + "원/건";
            } else {
                label = String.format("%.2f%%", feeSum == 0 ? 0 : (double) fee / feeSum * 100);
            }
            item.applyFee(fee, label);
        }
    }

    private Business getBusiness(String code) {
        return businessRepository.findById(code)
                .orElseThrow(() -> new BusinessException(ErrorCode.BUSINESS_NOT_FOUND));
    }
}
