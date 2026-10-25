package com.kftc.feecalc.domain.fee.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 4번 자연어 특이사항 기반 후처리 스크립트 자동 생성 요청. specialRulesText 는 "## 4. 최종 정산 특이사항"의 (저장 전) 자연어 텍스트 */
public record PostprocessGenerateRequest(
        @NotBlank(message = "'## 4. 최종 정산 특이사항' 텍스트를 입력해 주세요.")
        @Size(max = 10_000, message = "최종 정산 특이사항은 10,000자 이하로 입력해 주세요.")
        String specialRulesText) {
}
