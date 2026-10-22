package com.kftc.feecalc.domain.fee.dto;

import java.time.LocalDate;
import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 회비 산출 요청.
 * counts 가 비어 있으면 업무·기간·기관을 시드로 한 시연용 실적(프론트 Mock 과 같은 값)으로 산출한다.
 */
public record CalculationRequest(
        @NotBlank(message = "업무를 선택해 주세요.") String businessId,
        @NotNull(message = "산출 시작일을 입력해 주세요.") LocalDate from,
        @NotNull(message = "산출 종료일을 입력해 주세요.") LocalDate to,
        List<String> issues,
        @Valid List<InstitutionCount> counts,
        String uploadFileName,
        /** 산출자 로그인 ID. 있으면 업무 산출 권한(RBAC)을 확인한다 */
        String requestedBy) {
}
