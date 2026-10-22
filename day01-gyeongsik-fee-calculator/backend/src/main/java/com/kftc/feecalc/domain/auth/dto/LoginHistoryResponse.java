package com.kftc.feecalc.domain.auth.dto;

import java.time.LocalDateTime;

import com.kftc.feecalc.domain.auth.entity.LoginHistory;

public record LoginHistoryResponse(LocalDateTime at, String ip, String device, String status) {

    public static LoginHistoryResponse from(LoginHistory h) {
        return new LoginHistoryResponse(h.getAt(), h.getIp(), h.getDevice(), h.getResult().getLabel());
    }
}
