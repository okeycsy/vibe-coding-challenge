package com.kftc.feecalc.domain.fee.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kftc.feecalc.domain.fee.entity.AiIssue;
import com.kftc.feecalc.domain.fee.entity.FeeCalculation;
import com.kftc.feecalc.domain.fee.entity.FeeCalculationItem;
import com.kftc.feecalc.domain.fee.service.Period;
import com.kftc.feecalc.domain.fee.service.PostprocessEngine;

public record CalculationResponse(
        Long id,
        String businessId,
        String businessName,
        String method,
        LocalDate from,
        LocalDate to,
        String periodLabel,
        double periodScale,
        Long unitPrice,
        Long totalFee,
        String skillCode,
        String calcType,
        String formula,
        /** 적용한 3번 ```variables 변수 정의 원문 (예전 문서는 "") */
        String variables,
        /** 적용한 "## 4. 최종 정산 특이사항" 원문 */
        String specialRules,
        String source,
        String uploadFileName,
        String calculatedBy,
        LocalDateTime calculatedAt,
        long totalBaseCount,
        long totalDeduction,
        long totalFinalCount,
        long totalFeeAmount,
        /** Step 1(수식) 회비 합계 (특이사항 보정 전) */
        long totalBeforeSpecialFee,
        long totalEqualFee,
        long totalPerfFee,
        /** 이슈 차감 판별 AI 단계 동작: AI / RULE(키 없음, 규칙 기반) / RULE_FALLBACK(AI 실패로 규칙 기반) */
        String aiMode,
        String aiModel,
        String aiNote,
        /** 실행한 4번 후처리 스크립트 원문 */
        String postprocess,
        /** 스크립트 출처: SCRIPT(skill.md 블록) / AUTO_RULE(자연어만 있어 내장 변환기로 변환) / DEFAULT(4번 없음, 기본 배분) */
        String postprocessSource,
        /** 스크립트 assert 검증 결과 */
        List<Check> checks,
        /** 실행 중 참고 사항 (예: 대상 기관 없음) */
        List<String> notes,
        List<Item> items,
        List<Issue> issues) {

    /** inputs = 실적 입력 변수별 값 (변수 이름 → 건수), baseCount 는 그 입력으로 계산한 rawCount */
    public record Item(Long id, String institutionId, String name, String code, long baseCount, long deduction,
                       long finalCount, String rateLabel, long equalFee, long perfFee, long fee,
                       boolean specialRuleApplied, long beforeSpecialFee, long specialAdjustment, String specialReason,
                       List<String> reasons, Map<String, Long> inputs) {

        static Item from(FeeCalculationItem i) {
            List<String> reasons = i.getDeductionReasons() == null || i.getDeductionReasons().isBlank()
                    ? List.of() : Arrays.asList(i.getDeductionReasons().split("\n"));
            return new Item(i.getId(), i.getInstitutionCode(), i.getInstitutionName(), i.getBankCode(),
                    i.getBaseCount(), i.getDeduction(), i.getFinalCount(), i.getRateLabel(), i.getEqualFee(), i.getPerfFee(), i.getFee(),
                    i.isSpecialRuleApplied(), i.getBeforeSpecialFee(), i.getSpecialAdjustment(), i.getSpecialReason(), reasons,
                    inputsOf(i.getInputsJson()));
        }
    }

    /** 저장된 입력 JSON → 변수별 값 (없거나 깨졌으면 빈 맵) */
    public static Map<String, Long> inputsOf(String json) {
        try {
            if (json == null || json.isBlank()) {
                return Map.of();
            }
            Map<String, Object> raw = OM.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<LinkedHashMap<String, Object>>() {
            });
            Map<String, Long> result = new LinkedHashMap<>();
            raw.forEach((k, v) -> result.put(k, v instanceof Number n ? n.longValue() : 0L));
            return result;
        } catch (Exception e) {
            return Map.of();
        }
    }

    public record Check(String expression, String label, boolean passed, String actual) {

        static Check from(PostprocessEngine.Check c) {
            return new Check(c.expression(), c.label(), c.passed(), c.actual());
        }
    }

    public record Issue(Long id, String text, String institutionId, String institutionName, String matchedAlias,
                        Long count, String date, String reason, boolean applied, String judgement) {

        static Issue from(AiIssue a) {
            return new Issue(a.getId(), a.getText(), a.getInstitutionCode(), a.getInstitutionName(),
                    a.getMatchedAlias(), a.getCount(), a.getIssueDate(), a.getReason(), a.isApplied(), a.getJudgement());
        }
    }

    public static CalculationResponse from(FeeCalculation c) {
        List<Item> items = c.getItems().stream().map(Item::from).toList();
        return new CalculationResponse(c.getId(), c.getBusiness().getCode(), c.getBusiness().getName(),
                c.getBusiness().getMethod().getCode(), c.getPeriodFrom(), c.getPeriodTo(),
                new Period(c.getPeriodFrom(), c.getPeriodTo()).label(), c.getPeriodScale(),
                c.getAppliedUnitPrice(), c.getAppliedTotalFee(), c.getSkillCode(), c.getAppliedCalcType(),
                c.getAppliedFormula(), c.getAppliedVariables() == null ? "" : c.getAppliedVariables(),
                c.getAppliedSpecialRules() == null ? "" : c.getAppliedSpecialRules(), c.getSource(), c.getUploadFileName(),
                c.getCalculatedBy(), c.getCalculatedAt(),
                items.stream().mapToLong(Item::baseCount).sum(),
                items.stream().mapToLong(Item::deduction).sum(),
                items.stream().mapToLong(Item::finalCount).sum(),
                items.stream().mapToLong(Item::fee).sum(),
                items.stream().mapToLong(Item::beforeSpecialFee).sum(),
                items.stream().mapToLong(Item::equalFee).sum(),
                items.stream().mapToLong(Item::perfFee).sum(),
                c.getAiMode(), c.getAiModel(), c.getAiNote(),
                c.getAppliedPostprocess() == null ? "" : c.getAppliedPostprocess(), c.getPostprocessSource(),
                result(c.getPostprocessResultJson()).checks(), result(c.getPostprocessResultJson()).notes(),
                items, c.getIssues().stream().map(Issue::from).toList());
    }

    private static final ObjectMapper OM = new ObjectMapper();

    /** 저장된 실행 결과 JSON → 검증·참고 (없거나 깨졌으면 빈 목록) */
    public static PostprocessResult result(String json) {
        try {
            if (json == null || json.isBlank()) {
                return new PostprocessResult(List.of(), List.of());
            }
            PostprocessResult saved = OM.readValue(json, PostprocessResult.class);
            return new PostprocessResult(saved.checks() == null ? List.of() : saved.checks(),
                    saved.notes() == null ? List.of() : saved.notes());
        } catch (Exception e) {
            return new PostprocessResult(List.of(), List.of());
        }
    }

    /** FeeCalculation.postprocessResultJson 형식 */
    public record PostprocessResult(List<Check> checks, List<String> notes) {

        public static PostprocessResult from(PostprocessEngine.Result r) {
            return new PostprocessResult(r.checks().stream().map(Check::from).toList(), r.notes());
        }
    }
}
