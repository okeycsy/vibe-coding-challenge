package com.kftc.feecalc.domain.reconcile.dto;

import java.time.LocalDateTime;

import com.kftc.feecalc.domain.reconcile.entity.ReconcileRecord;

public record ReconcileRecordResponse(
        Long id,
        Long calculationId,
        String businessId,
        String businessName,
        String periodLabel,
        String institutionId,
        String institutionName,
        long finalCount,
        long fee,
        String status,
        String comment,
        LocalDateTime sentAt,
        LocalDateTime updatedAt) {

    public static ReconcileRecordResponse from(ReconcileRecord r) {
        return new ReconcileRecordResponse(r.getId(), r.getCalculationId(), r.getBusinessCode(), r.getBusinessName(),
                r.getPeriodLabel(), r.getInstitutionCode(), r.getInstitutionName(), r.getFinalCount(), r.getFee(),
                r.getStatus().getLabel(), r.getComment(), r.getSentAt(), r.getUpdatedAt());
    }
}
