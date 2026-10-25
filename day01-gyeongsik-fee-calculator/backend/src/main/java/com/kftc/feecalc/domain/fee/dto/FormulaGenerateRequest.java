package com.kftc.feecalc.domain.fee.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 1번 규칙 기반 3번 수식 자동 생성 요청. businessRulesText 는 "## 1. 비즈니스 규칙 요약"에 작성한 (저장 전) 텍스트 */
public record FormulaGenerateRequest(
        @NotBlank(message = "'## 1. 비즈니스 규칙 요약' 텍스트를 입력해 주세요.")
        @Size(max = 10_000, message = "비즈니스 규칙 요약은 10,000자 이하로 입력해 주세요.")
        String businessRulesText) {
}
