package com.kftc.feecalc.domain.fee.service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.kftc.feecalc.common.event.FeeCalculatedEvent;
import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kftc.feecalc.domain.fee.ai.AiFeePostProcessor;
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
 * 1) 기관별 기준 실적(업로드 또는 시연용) → 2) 이슈 문장을 skill.md "## 2. AI 예외 차감 지침"으로 판별해 차감
 * ({@link AiFeePostProcessor}, 키가 없으면 규칙 기반) → 2단계 정산 파이프라인:
 * Step 1: "## 3. 정산 수식"(SpEL)으로 1차 정밀 계산 + 원 단위 배분(균등분담분·실적분담분 분해)
 * → Step 2: "## 4. 최종 정산 특이사항"의 후처리 스크립트({@link PostprocessScript}, skill.md 의 postprocess 블록)를
 * {@link PostprocessEngine}이 실행해 반올림·합계 보정·끝전 처리·검증을 한다. 산출 중에는 AI 를 부르지 않는다 (스크립트는 빌더에서
 * AI 또는 {@link SpecialRuleConverter}로 만들어 확정). 블록이 없고 자연어만 있으면 내장 변환기로 바꿔 실행(AUTO_RULE)
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
    private final AiFeePostProcessor aiPostProcessor;
    private final ObjectMapper objectMapper;

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
        return issueParser.parse(text, institutionRepository.findByActiveTrueOrderBySortOrder());
    }

    // ---------- 산출 ----------

    @Transactional
    public CalculationResponse calculate(CalculationRequest req) {
        return calculate(req, true);
    }

    /** allowAi = false 면 AI 키가 있어도 규칙 기반으로만 판별·보정한다 (기동 시 시연 데이터 적재용: 기동이 AI 응답을 기다리지 않게) */
    @Transactional
    public CalculationResponse calculate(CalculationRequest req, boolean allowAi) {
        // businessId 에는 업무 ID(openbanking)나 skill.md 업무 코드(OPEN_BANKING) 모두 쓸 수 있다
        Business business = getBusiness(skillEngine.businessIdOf(req.businessId()));
        SkillEngineService.ParsedSkill skill = skillEngine.getSkill(business.getCode());
        if (req.requestedBy() != null && !req.requestedBy().isBlank()) {
            userService.checkCalculatePermission(req.requestedBy(), business.getCode());
        }
        Period period = Period.of(req.from(), req.to());
        double scale = period.scale();
        // 비활성 기관은 산출·이슈 인식에서 뺀다 (업로드 실적에 있으면 '알 수 없는 기관'으로 거부)
        List<Institution> institutions = institutionRepository.findByActiveTrueOrderBySortOrder();
        boolean uploaded = req.counts() != null && !req.counts().isEmpty();

        FeeCalculation calc = FeeCalculation.builder()
                .business(business)
                .periodFrom(period.from())
                .periodTo(period.to())
                .periodScale(scale)
                .skillCode(skill.taskCode())
                .appliedCalcType(skill.calcType())
                .appliedFormula(skill.formula())
                .appliedSpecialRules(skill.specialRulesRaw())
                .source(uploaded ? "UPLOAD" : "DEMO")
                .uploadFileName(req.uploadFileName())
                .calculatedBy(req.requestedBy())
                .calculatedAt(LocalDateTime.now())
                .build();

        // Step A) 이슈 문장 해석(기관·건수) → "## 2. AI 예외 차감 지침"으로 차감 대상 판별
        List<ParsedIssue> parsed = (req.issues() == null ? List.<String>of() : req.issues()).stream()
                .filter(t -> t != null && !t.isBlank())
                .map(t -> issueParser.parse(t.trim(), institutions))
                .toList();
        AiFeePostProcessor.IssueReview review = aiPostProcessor.reviewIssues(skill.aiGuide(), parsed, allowAi);
        List<ParsedIssue> deducted = new ArrayList<>();
        for (int i = 0; i < parsed.size(); i++) {
            ParsedIssue p = parsed.get(i);
            AiFeePostProcessor.IssueDecision d = review.decisions().get(i);
            if (d.deduct()) {
                deducted.add(p);
            }
            calc.addIssue(AiIssue.builder()
                    .text(p.text()).institutionCode(p.institutionId()).institutionName(p.institutionName())
                    .matchedAlias(p.matchedAlias()).count(p.count()).issueDate(p.date()).reason(p.reason())
                    .applied(d.deduct()).judgement(d.judgement())
                    .build());
        }

        // 기관별 기준 실적 → 차감
        Map<String, Long> baseCounts = baseCounts(req, business, period, institutions);
        Map<String, Institution> byCode = new LinkedHashMap<>();
        int order = 0;
        for (Institution inst : institutions) {
            Long base = baseCounts.get(inst.getCode());
            if (base == null) {
                continue;
            }
            byCode.put(inst.getCode(), inst);
            List<ParsedIssue> related = deducted.stream()
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

        // Step 1) "## 3. 정산 수식" 1차 계산 → Step 2) "## 4. 최종 정산 특이사항" 후처리
        applySkill(calc, skill, scale, byCode);
        calc.applyTotalFee(calc.getTotalFeeAmount());
        calc.applyAiResult(review.outcome().mode().name(),
                allowAi && aiPostProcessor.aiEnabled() ? aiPostProcessor.model() : null,
                trim(review.outcome().note()));

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
                    throw new BusinessException(ErrorCode.INVALID_INPUT,
                            "알 수 없거나 사용 중지된 기관입니다: " + c.institutionId() + " (실적 파일을 다시 올려 주세요)");
                }
                result.merge(c.institutionId(), c.baseCount(), Long::sum);
            }
            return result;
        }
        for (Institution inst : institutions) {
            if (inst.getVolumeWeight() <= 0) {
                continue; // 업로드 테스트용 기관은 시연용 실적에서 뺀다
            }
            result.put(inst.getCode(), demoVolumeGenerator.baseCount(business, period, inst));
        }
        return result;
    }

    /**
     * Step 1: 기관별로 skill.md 수식(총액 또는 균등·실적 분리 수식)을 원 미만까지 계산하고,
     * Step 2: "## 4. 최종 정산 특이사항" 후처리 스크립트로 정수화·보정·검증한다 (스크립트가 없으면 기본 배분 allocate(fee)).
     * 표시 단위가 "원/건"이면 실효 단가(최종 회비 ÷ 인정 건수), 그 밖에는 회비 합계 대비 비율을 rateLabel 로 남긴다.
     */
    private void applySkill(FeeCalculation calc, SkillEngineService.ParsedSkill skill, double scale,
                            Map<String, Institution> byCode) {
        List<FeeCalculationItem> items = calc.getItems();
        SkillEngineService.RawFees raw = SkillEngineService.computeRaw(skill,
                items.stream().map(i -> new SkillEngineService.Counts(i.getBaseCount(), i.getDeduction(), i.getFinalCount()))
                        .toList(),
                scale);
        List<PostprocessEngine.Line> lines = new ArrayList<>();
        for (int idx = 0; idx < items.size(); idx++) {
            FeeCalculationItem item = items.get(idx);
            Institution inst = byCode.get(item.getInstitutionCode());
            lines.add(new PostprocessEngine.Line(item.getInstitutionCode(), item.getBankCode(), item.getInstitutionName(),
                    inst == null ? List.of() : inst.getAliases(), item.getFinalCount(),
                    raw.equalMicro().get(idx), raw.perfMicro().get(idx)));
        }
        Script script = scriptOf(skill, lines);
        PostprocessEngine.Result result = PostprocessEngine.run(script.text(), lines);
        calc.applyPostprocess(script.text(), script.source(), toJson(CalculationResponse.PostprocessResult.from(result)));
        long feeSum = result.items().stream().mapToLong(PostprocessEngine.ItemResult::fee).sum();
        boolean perCount = skill.rateUnit().contains("건");
        for (int idx = 0; idx < items.size(); idx++) {
            FeeCalculationItem item = items.get(idx);
            PostprocessEngine.ItemResult r = result.items().get(idx);
            long fee = r.fee();
            String label;
            if (perCount) {
                double unit = item.getFinalCount() == 0 ? 0 : (double) fee / item.getFinalCount();
                label = (unit == Math.rint(unit) ? String.format("%,.0f", unit) : String.format("%,.2f", unit)) + "원/건";
            } else {
                label = String.format("%.2f%%", feeSum == 0 ? 0 : (double) fee / feeSum * 100);
            }
            item.applyFee(r.beforeSpecialFee(), r.equalFee(), fee, r.reason(), label);
        }
    }

    public record Script(String text, String source) {
    }

    /**
     * 실행할 스크립트: skill.md 에 postprocess 블록이 있으면 그것(SCRIPT), 블록 없이 자연어 특이사항만 있으면 내장 변환기로
     * 바꾼 것(AUTO_RULE, 변환 결과가 문법 오류면 DEFAULT), 4번이 비어 있으면 기본 배분(DEFAULT). 프론트 fee.js scriptOf 와 같은 규칙
     */
    public static Script scriptOf(SkillEngineService.ParsedSkill skill, List<PostprocessEngine.Line> lines) {
        if (skill.hasPostprocess()) {
            return new Script(skill.postprocess(), "SCRIPT");
        }
        if (skill.hasSpecialRules()) {
            List<SpecialRuleConverter.Institution> insts = lines.stream()
                    .map(l -> new SpecialRuleConverter.Institution(l.name(), l.aliases())).toList();
            String converted = SpecialRuleConverter.convert(skill.specialRulesRaw(), insts).script();
            try {
                PostprocessScript.parse(converted);
                return new Script(converted, "AUTO_RULE");
            } catch (BusinessException e) {
                return new Script(SkillEngineService.DEFAULT_POSTPROCESS, "DEFAULT");
            }
        }
        return new Script(SkillEngineService.DEFAULT_POSTPROCESS, "DEFAULT");
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String trim(String note) {
        if (note == null || note.isBlank()) {
            return null;
        }
        return note.length() > 1000 ? note.substring(0, 1000) : note;
    }

    private Business getBusiness(String code) {
        return businessRepository.findById(code)
                .orElseThrow(() -> new BusinessException(ErrorCode.BUSINESS_NOT_FOUND));
    }
}
