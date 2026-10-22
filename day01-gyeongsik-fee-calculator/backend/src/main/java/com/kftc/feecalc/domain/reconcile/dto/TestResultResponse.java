package com.kftc.feecalc.domain.reconcile.dto;

import java.time.LocalDateTime;

import com.kftc.feecalc.domain.reconcile.entity.TestResult;

public record TestResultResponse(Long id, String institutionId, String institutionName, String businessId,
                                 String business, String item, LocalDateTime date, String result, String note,
                                 int retestCount) {

    public static TestResultResponse from(TestResult t) {
        return new TestResultResponse(t.getId(), t.getInstitutionCode(), t.getInstitutionName(), t.getBusinessCode(),
                t.getBusinessName(), t.getItem(), t.getTestedAt(), t.getResult().getLabel(), t.getNote(),
                t.getRetestCount());
    }
}
