package com.kftc.feecalc.domain.fee.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;

/** 기관별 기준 실적 건수 (엑셀 업로드 결과 또는 산출 요청 입력) */
public record InstitutionCount(
        @NotBlank String institutionId,
        String name,
        @PositiveOrZero long baseCount) {
}
