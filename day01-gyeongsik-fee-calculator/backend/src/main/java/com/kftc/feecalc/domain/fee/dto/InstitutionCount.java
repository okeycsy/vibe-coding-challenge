package com.kftc.feecalc.domain.fee.dto;

import java.util.Map;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * 기관별 실적 (엑셀 업로드 결과 또는 산출 요청 입력).
 * inputs 는 skill.md ```variables 의 실적 입력 변수별 건수(변수 이름 → 값, 업로드 열을 연결해 더한 값).
 * 없으면(예전 방식) baseCount 를 하나뿐인 입력 변수(rawCount)에 넣는다. baseCount 는 입력으로 계산한 rawCount (화면 표시용)
 */
public record InstitutionCount(
        @NotBlank String institutionId,
        String name,
        @PositiveOrZero long baseCount,
        Map<String, Long> inputs) {
}
