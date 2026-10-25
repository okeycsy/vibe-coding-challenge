package com.kftc.feecalc.domain.fee.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;

import com.kftc.feecalc.domain.fee.entity.AiIssue;
import com.kftc.feecalc.domain.fee.entity.FeeCalculation;
import com.kftc.feecalc.domain.fee.entity.FeeCalculationItem;
import com.kftc.feecalc.domain.fee.service.Period;

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
        String source,
        String uploadFileName,
        String calculatedBy,
        LocalDateTime calculatedAt,
        long totalBaseCount,
        long totalDeduction,
        long totalFinalCount,
        long totalFeeAmount,
        /** 1차 수식 회비 합계 (최종 보정 전) */
        long totalPrimaryFee,
        /** AI 단계 동작: AI / RULE(키 없음, 규칙 기반) / RULE_FALLBACK(AI 실패로 규칙 기반) */
        String aiMode,
        String aiModel,
        String aiNote,
        List<Item> items,
        List<Issue> issues) {

    public record Item(Long id, String institutionId, String name, String code, long baseCount, long deduction,
                       long finalCount, String rateLabel, long primaryFee, long fee, String aiAdjustReason,
                       List<String> reasons) {

        static Item from(FeeCalculationItem i) {
            List<String> reasons = i.getDeductionReasons() == null || i.getDeductionReasons().isBlank()
                    ? List.of() : Arrays.asList(i.getDeductionReasons().split("\n"));
            return new Item(i.getId(), i.getInstitutionCode(), i.getInstitutionName(), i.getBankCode(),
                    i.getBaseCount(), i.getDeduction(), i.getFinalCount(), i.getRateLabel(), i.getPrimaryFee(), i.getFee(),
                    i.getAiAdjustReason(), reasons);
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
                c.getAppliedFormula(), c.getSource(), c.getUploadFileName(),
                c.getCalculatedBy(), c.getCalculatedAt(),
                items.stream().mapToLong(Item::baseCount).sum(),
                items.stream().mapToLong(Item::deduction).sum(),
                items.stream().mapToLong(Item::finalCount).sum(),
                items.stream().mapToLong(Item::fee).sum(),
                items.stream().mapToLong(Item::primaryFee).sum(),
                c.getAiMode(), c.getAiModel(), c.getAiNote(),
                items, c.getIssues().stream().map(Issue::from).toList());
    }
}
