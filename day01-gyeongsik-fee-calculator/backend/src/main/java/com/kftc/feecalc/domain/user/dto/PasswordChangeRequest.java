package com.kftc.feecalc.domain.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record PasswordChangeRequest(
        @NotBlank(message = "현재 비밀번호를 입력해 주세요.") String currentPassword,
        @NotBlank @Size(min = 4, max = 64, message = "새 비밀번호는 4~64자로 입력해 주세요.") String newPassword) {
}
