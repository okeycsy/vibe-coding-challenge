package com.kftc.feecalc.domain.fee.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;

import com.kftc.feecalc.domain.fee.entity.FeeCalculation;
import com.kftc.feecalc.domain.fee.service.Period;

/** 산출 이력 목록 행 */
public record CalculationSummary(Long id, String businessId, String businessName, LocalDate from, LocalDate to,
                                 String periodLabel, String source, String calculatedBy, LocalDateTime calculatedAt) {

    public static CalculationSummary from(FeeCalculation c) {
        return new CalculationSummary(c.getId(), c.getBusiness().getCode(), c.getBusiness().getName(),
                c.getPeriodFrom(), c.getPeriodTo(), new Period(c.getPeriodFrom(), c.getPeriodTo()).label(),
                c.getSource(), c.getCalculatedBy(), c.getCalculatedAt());
    }
}
