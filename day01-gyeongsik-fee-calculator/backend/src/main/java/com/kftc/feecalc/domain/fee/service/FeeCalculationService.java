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
import com.kftc.feecalc.domain.fee.service.SkillVariables.Row;
import com.kftc.feecalc.domain.user.service.UserService;

import lombok.RequiredArgsConstructor;

/**
 * 회비 산출.
 * 1) 기관별 실적 입력(업로드 엑셀 열을 연결한 ```variables 의 input 값, 또는 시연용) → 2) 이슈 문장을 skill.md "## 2. AI 예외 차감 지침"으로 판별해 차감
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
    private final BusinessCatalogService businessCatalog;
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
        Business business = businessCatalog.require(skillEngine.businessIdOf(req.businessId()));
        SkillEngineService.ParsedSkill skill = skillEngine.getSkill(business.getCode());
        SkillEngineService.requireFormula(skill);
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
                .appliedVariables(skill.variables().hasBlock() ? skill.variables().text() : null)
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

        // 기관별 실적 입력 + 차감 → 변수 정의로 rawCount·finalCount 확정 (deductedCount 는 rawCount 를 넘지 않게)
        Map<String, Map<String, Long>> inputs = inputs(req, business, period, institutions, skill);
        Map<String, Institution> byCode = new LinkedHashMap<>();
        List<Row> rows = new ArrayList<>();
        List<List<ParsedIssue>> relatedByRow = new ArrayList<>();
        for (Institution inst : institutions) {
            Map<String, Long> in = inputs.get(inst.getCode());
            if (in == null) {
                continue;
            }
            byCode.put(inst.getCode(), inst);
            List<ParsedIssue> related = deducted.stream()
                    .filter(p -> p.institutionId().equals(inst.getCode()))
                    .toList();
            rows.add(new Row(in, related.stream().mapToLong(ParsedIssue::count).sum()));
            relatedByRow.add(related);
        }
        // Step 1) 변수 계산 + "## 3. 정산 수식" 1차 계산
        SkillEngineService.RawFees raw = SkillEngineService.computeRaw(skill, rows, scale);
        int order = 0;
        for (Institution inst : byCode.values()) {
            int i = order;
            calc.addItem(FeeCalculationItem.builder()
                    .institutionCode(inst.getCode()).institutionName(inst.getName()).bankCode(inst.getBankCode())
                    .baseCount(raw.bound().rawCount()[i]).deduction(raw.bound().deducted()[i])
                    .deductionReasons(String.join("\n", relatedByRow.get(i).stream().map(ParsedIssue::text).toList()))
                    .inputsJson(toJson(rows.get(i).inputs()))
                    .sortOrder(order++)
                    .build());
        }

        // Step 2) 원 단위 배분 → "## 4. 최종 정산 특이사항" 후처리
        applySkill(calc, skill, raw, byCode);
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

    /**
     * 기관별 실적 입력(변수 이름 → 값). 업로드 실적은 counts[].inputs(실적 항목별 건수)를, 그것이 없으면 baseCount 를 하나뿐인 입력 변수에
     * 넣는다(입력이 여럿인 기준이면 400: 엑셀 열을 연결해야 한다). 같은 기관이 여러 번 오면 더한다. 시연용 실적은 입력이 하나인 기준에서만 만든다
     */
    private Map<String, Map<String, Long>> inputs(CalculationRequest req, Business business, Period period,
                                                  List<Institution> institutions, SkillEngineService.ParsedSkill skill) {
        List<SkillVariables.Definition> defs = skill.variables().inputs();
        Map<String, Map<String, Long>> result = new LinkedHashMap<>();
        if (req.counts() != null && !req.counts().isEmpty()) {
            for (InstitutionCount c : req.counts()) {
                if (institutions.stream().noneMatch(i -> i.getCode().equals(c.institutionId()))) {
                    throw new BusinessException(ErrorCode.INVALID_INPUT,
                            "알 수 없거나 사용 중지된 기관입니다: " + c.institutionId() + " (실적 파일을 다시 올려 주세요)");
                }
                Map<String, Long> row = result.computeIfAbsent(c.institutionId(), k -> new LinkedHashMap<>());
                boolean byInput = c.inputs() != null && defs.stream().anyMatch(d -> c.inputs().containsKey(d.name()));
                if (byInput) {
                    for (SkillVariables.Definition d : defs) {
                        Long v = c.inputs().get(d.name());
                        row.merge(d.name(), v == null ? 0L : Math.max(0L, v), Long::sum);
                    }
                } else {
                    SkillEngineService.requireSingleInput(skill);
                    row.merge(defs.get(0).name(), c.baseCount(), Long::sum);
                }
            }
            return result;
        }
        if (business.getBaseVolume() <= 0) {
            // 업무 관리에서 추가한 업무는 시연용 실적이 없다
            throw new BusinessException(ErrorCode.INVALID_INPUT, business.getName() + " 업무는 실적 파일을 올려야 산출할 수 있습니다.");
        }
        SkillEngineService.requireSingleInput(skill);
        for (Institution inst : institutions) {
            if (inst.getVolumeWeight() <= 0) {
                continue; // 업로드 테스트용 기관은 시연용 실적에서 뺀다
            }
            result.put(inst.getCode(), Map.of(defs.get(0).name(), demoVolumeGenerator.baseCount(business, period, inst)));
        }
        return result;
    }

    /**
     * Step 1: 기관별로 skill.md 수식(총액 또는 균등·실적 분리 수식)을 원 미만까지 계산하고,
     * Step 2: "## 4. 최종 정산 특이사항" 후처리 스크립트로 정수화·보정·검증한다 (스크립트가 없으면 기본 배분 allocate(fee)).
     * 표시 단위가 "원/건"이면 실효 단가(최종 회비 ÷ 인정 건수), 그 밖에는 회비 합계 대비 비율을 rateLabel 로 남긴다.
     */
    private void applySkill(FeeCalculation calc, SkillEngineService.ParsedSkill skill, SkillEngineService.RawFees raw,
                            Map<String, Institution> byCode) {
        List<FeeCalculationItem> items = calc.getItems();
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
