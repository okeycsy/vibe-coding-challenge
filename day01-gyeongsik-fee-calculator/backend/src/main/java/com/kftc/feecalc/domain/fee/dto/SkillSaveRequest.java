package com.kftc.feecalc.domain.fee.dto;

import jakarta.validation.constraints.NotBlank;

/** skill.md 저장 요청 (마크다운 전문) */
public record SkillSaveRequest(@NotBlank(message = "skill.md 내용을 입력해 주세요.") String content) {
}
