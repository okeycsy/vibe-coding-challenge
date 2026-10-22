package com.kftc.feecalc.domain.fee.dto;

import jakarta.validation.constraints.NotBlank;

public record IssueParseRequest(@NotBlank(message = "이슈 문장을 입력해 주세요.") String text) {
}
