package com.kftc.feecalc.domain.fee.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kftc.feecalc.domain.fee.entity.AiIssue;
import com.kftc.feecalc.domain.fee.entity.FeeCalculation;
import com.kftc.feecalc.domain.fee.entity.FeeCalculationItem;
import com.kftc.feecalc.domain.fee.service.Period;
import com.kftc.feecalc.domain.fee.service.SpecialAction;

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
        /** 4번 특이사항 해석 방식: AI / RULE(키 없음, 규칙 기반) / RULE_FALLBACK(AI 실패로 규칙 기반) */
        String specialRuleMode,
        String specialRuleModel,
        String specialRuleNote,
        /** 해석된 보정 동작 (금액은 이 동작대로 코드가 계산) */
        List<Action> specialActions,
        /** 보정 동작으로 바꾸지 못해 적용하지 않은 문장 */
        List<String> specialUnsupported,
        List<Item> items,
        List<Issue> issues) {

    public record Item(Long id, String institutionId, String name, String code, long baseCount, long deduction,
                       long finalCount, String rateLabel, long equalFee, long perfFee, long fee,
                       boolean specialRuleApplied, long beforeSpecialFee, long specialAdjustment, String specialReason,
                       List<String> reasons) {

        static Item from(FeeCalculationItem i) {
            List<String> reasons = i.getDeductionReasons() == null || i.getDeductionReasons().isBlank()
                    ? List.of() : Arrays.asList(i.getDeductionReasons().split("\n"));
            return new Item(i.getId(), i.getInstitutionCode(), i.getInstitutionName(), i.getBankCode(),
                    i.getBaseCount(), i.getDeduction(), i.getFinalCount(), i.getRateLabel(), i.getEqualFee(), i.getPerfFee(), i.getFee(),
                    i.isSpecialRuleApplied(), i.getBeforeSpecialFee(), i.getSpecialAdjustment(), i.getSpecialReason(), reasons);
        }
    }

    public record Action(String type, Long amount, Long unit, String rounding, String target, List<String> institutions,
                         String redistribute, String rule, String description) {

        static Action from(SpecialAction a) {
            return new Action(a.type().name(), a.amount(), a.unit(), a.rounding() == null ? null : a.rounding().name(),
                    a.target().name(), a.institutions(), a.redistribute().name(), a.rule(), a.describe());
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
                c.getAppliedFormula(), c.getAppliedSpecialRules() == null ? "" : c.getAppliedSpecialRules(), c.getSource(), c.getUploadFileName(),
                c.getCalculatedBy(), c.getCalculatedAt(),
                items.stream().mapToLong(Item::baseCount).sum(),
                items.stream().mapToLong(Item::deduction).sum(),
                items.stream().mapToLong(Item::finalCount).sum(),
                items.stream().mapToLong(Item::fee).sum(),
                items.stream().mapToLong(Item::beforeSpecialFee).sum(),
                items.stream().mapToLong(Item::equalFee).sum(),
                items.stream().mapToLong(Item::perfFee).sum(),
                c.getAiMode(), c.getAiModel(), c.getAiNote(),
                c.getSpecialRuleMode(), c.getSpecialRuleModel(), c.getSpecialRuleNote(),
                actions(c.getSpecialActionsJson()), unsupported(c.getSpecialActionsJson()),
                items, c.getIssues().stream().map(Issue::from).toList());
    }

    private static final ObjectMapper OM = new ObjectMapper();

    /** 저장된 해석 JSON → 동작 목록 (없거나 깨졌으면 빈 목록) */
    public static List<Action> actions(String json) {
        try {
            if (json == null || json.isBlank()) {
                return List.of();
            }
            SpecialActions saved = OM.readValue(json, SpecialActions.class);
            return saved.actions() == null ? List.of() : saved.actions().stream().map(Action::from).toList();
        } catch (Exception e) {
            return List.of();
        }
    }

    public static List<String> unsupported(String json) {
        try {
            if (json == null || json.isBlank()) {
                return List.of();
            }
            SpecialActions saved = OM.readValue(json, SpecialActions.class);
            return saved.unsupported() == null ? List.of() : saved.unsupported();
        } catch (Exception e) {
            return List.of();
        }
    }

    /** FeeCalculation.specialActionsJson 형식 */
    public record SpecialActions(List<SpecialAction> actions, List<String> unsupported) {
    }
}
