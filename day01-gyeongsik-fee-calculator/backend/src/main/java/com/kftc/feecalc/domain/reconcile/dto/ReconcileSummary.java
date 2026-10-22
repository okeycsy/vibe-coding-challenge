package com.kftc.feecalc.domain.reconcile.dto;

import java.util.List;

/** 수행률 집계: 대사 완료율(완료 ÷ 전체)과 테스트 성공률(성공 ÷ 전체) */
public record ReconcileSummary(
        Overall reconcile,
        List<ByCalculation> byCalculation,
        TestStats tests) {

    public record Overall(long total, long waiting, long checking, long done, double completionRate) {
    }

    public record ByCalculation(Long calculationId, String businessName, String periodLabel, long total,
                                long waiting, long checking, long done, double completionRate) {
    }

    public record TestStats(long total, long success, long fail, long inProgress, double successRate) {
    }
}
