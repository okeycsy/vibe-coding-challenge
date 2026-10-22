package com.kftc.feecalc.domain.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Size;

public record ProfileUpdateRequest(
        @Size(max = 100) String dept,
        @Email(message = "이메일 형식이 올바르지 않습니다.") String email,
        @Size(max = 30) String extension) {
}
