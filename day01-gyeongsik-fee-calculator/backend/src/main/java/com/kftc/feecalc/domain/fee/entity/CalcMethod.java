package com.kftc.feecalc.domain.fee.entity;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@Getter
@RequiredArgsConstructor
public enum CalcMethod {

    /** 건당 단가: 최종 인정 건수 × 단가 */
    UNIT("unit", "건당 단가"),
    /** 총액 분담: 기간 총액 × (기관 인정 건수 ÷ 전체 인정 건수) */
    RATIO("ratio", "총액 분담");

    private final String code;
    private final String label;
}
