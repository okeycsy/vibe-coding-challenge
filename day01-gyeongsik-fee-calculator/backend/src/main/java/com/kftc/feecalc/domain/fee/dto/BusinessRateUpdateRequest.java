package com.kftc.feecalc.domain.fee.dto;

import jakarta.validation.constraints.PositiveOrZero;

/** 회비 기준 변경: 건당 단가 방식은 unitPrice, 총액 분담 방식은 totalFee 만 반영한다 */
public record BusinessRateUpdateRequest(@PositiveOrZero Long unitPrice, @PositiveOrZero Long totalFee) {
}
