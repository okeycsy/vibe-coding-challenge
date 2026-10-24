package com.kftc.feecalc.domain.fee.controller;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.kftc.feecalc.common.dto.ApiResponse;
import com.kftc.feecalc.domain.fee.dto.CalculationRequest;
import com.kftc.feecalc.domain.fee.dto.CalculationResponse;
import com.kftc.feecalc.domain.fee.service.FeeCalculationService;
import com.kftc.feecalc.domain.fee.service.SkillAccessControlService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

/** skill.md 수식 기반 회비 산출 (v1). 산출자 사번은 X-Employee-Id 헤더 또는 요청의 requestedBy */
@RestController
@RequestMapping("/api/v1/fees")
@RequiredArgsConstructor
public class FeeV1Controller {

    private final FeeCalculationService calculationService;
    private final SkillAccessControlService accessControl;

    @PostMapping("/calculate")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<CalculationResponse> calculate(
            @RequestHeader(value = SkillManagementController.EMPLOYEE_HEADER, required = false) String employeeId,
            @Valid @RequestBody CalculationRequest request) {
        String requester = employeeId != null && !employeeId.isBlank() ? employeeId : request.requestedBy();
        accessControl.checkPermission(requester, request.businessId());
        CalculationRequest checked = new CalculationRequest(request.businessId(), request.from(), request.to(),
                request.issues(), request.counts(), request.uploadFileName(), requester.trim());
        return ApiResponse.ok("skill.md 수식으로 회비 초안을 산출했습니다.", calculationService.calculate(checked));
    }
}
