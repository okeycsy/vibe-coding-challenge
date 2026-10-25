package com.kftc.feecalc.domain.fee.dto;

import jakarta.validation.constraints.NotBlank;

/** 1번 규칙 기반 3번 수식 자동 생성 요청. content 는 편집기에 있는 (저장 전) skill.md 전문 */
public record FormulaSyncRequest(
        @NotBlank(message = "업무 코드를 입력해 주세요.") String taskCode,
        @NotBlank(message = "skill.md 내용을 입력해 주세요.") String content) {
}
