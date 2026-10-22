package com.kftc.feecalc.domain.reconcile.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record NotificationRequest(@NotBlank(message = "보낼 내용을 입력해 주세요.") @Size(max = 2000) String text) {
}
