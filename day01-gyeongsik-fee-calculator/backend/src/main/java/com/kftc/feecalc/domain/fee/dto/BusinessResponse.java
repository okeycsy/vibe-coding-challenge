package com.kftc.feecalc.domain.fee.dto;

import java.util.List;

import com.kftc.feecalc.domain.fee.entity.Business;

public record BusinessResponse(
        String id,
        String name,
        String method,
        String methodLabel,
        Long unitPrice,
        Long totalFee,
        long baseVolume,
        String revenueAccount,
        List<String> summary) {

    public static BusinessResponse from(Business b) {
        return new BusinessResponse(b.getCode(), b.getName(), b.getMethod().getCode(), b.getMethod().getLabel(),
                b.getUnitPrice(), b.getTotalFee(), b.getBaseVolume(), b.getRevenueAccount(), List.copyOf(b.getSummary()));
    }
}
