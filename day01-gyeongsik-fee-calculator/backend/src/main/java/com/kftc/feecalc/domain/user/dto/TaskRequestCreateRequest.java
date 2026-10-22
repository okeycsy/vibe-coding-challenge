package com.kftc.feecalc.domain.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record TaskRequestCreateRequest(
        @NotBlank(message = "신청할 업무를 선택해 주세요.") String businessCode,
        @Size(max = 500) String reason) {
}
