package com.kftc.feecalc.domain.fee.dto;

import jakarta.validation.constraints.NotBlank;

/** skill.md 수정 요청. updatedBy 는 수정자 로그인 ID(시스템관리자만 허용) */
public record SkillUpdateRequest(
        @NotBlank(message = "skill.md 내용을 입력해 주세요.") String markdown,
        @NotBlank(message = "수정자 ID가 필요합니다.") String updatedBy) {
}
