package com.kftc.feecalc.domain.fee.controller;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.kftc.feecalc.common.dto.ApiResponse;
import com.kftc.feecalc.domain.fee.dto.InstitutionAdminResponse;
import com.kftc.feecalc.domain.fee.dto.InstitutionMatchResponse;
import com.kftc.feecalc.domain.fee.dto.InstitutionSaveRequest;
import com.kftc.feecalc.domain.fee.entity.Institution;
import com.kftc.feecalc.domain.fee.service.InstitutionManagementService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

/**
 * 기관 관리. 모든 API 가 시스템관리자 전용이며 사번은 X-Employee-Id 헤더로 받는다.
 * (참가기관 목록 조회만 필요한 화면은 GET /api/fee/institutions 를 쓴다)
 */
@RestController
@RequestMapping("/api/v1/institutions")
@RequiredArgsConstructor
public class InstitutionManagementController {

    private final InstitutionManagementService service;

    /** 전체 기관(사용 중지 포함)과 사용 현황 */
    @GetMapping
    public ApiResponse<List<InstitutionAdminResponse>> list(
            @RequestHeader(value = SkillManagementController.EMPLOYEE_HEADER, required = false) String employeeId) {
        return ApiResponse.ok(service.list(employeeId));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<InstitutionAdminResponse> create(
            @RequestHeader(value = SkillManagementController.EMPLOYEE_HEADER, required = false) String employeeId,
            @Valid @RequestBody InstitutionSaveRequest request) {
        InstitutionAdminResponse created = service.create(employeeId, request);
        return ApiResponse.ok(created.name() + " 기관을 추가했습니다.", created);
    }

    @PutMapping("/{id}")
    public ApiResponse<InstitutionAdminResponse> update(
            @RequestHeader(value = SkillManagementController.EMPLOYEE_HEADER, required = false) String employeeId,
            @PathVariable String id, @Valid @RequestBody InstitutionSaveRequest request) {
        InstitutionAdminResponse updated = service.update(employeeId, id, request);
        return ApiResponse.ok(updated.name() + " 기관 정보를 저장했습니다.", updated);
    }

    /** 사용 중지: 엑셀 매칭·AI 이슈 인식·산출에서 빠진다. 지난 산출 이력은 그대로 */
    @PostMapping("/{id}/deactivate")
    public ApiResponse<InstitutionAdminResponse> deactivate(
            @RequestHeader(value = SkillManagementController.EMPLOYEE_HEADER, required = false) String employeeId,
            @PathVariable String id) {
        InstitutionAdminResponse r = service.changeActive(employeeId, id, false);
        return ApiResponse.ok(r.name() + " 기관을 사용 중지했습니다.", r);
    }

    @PostMapping("/{id}/activate")
    public ApiResponse<InstitutionAdminResponse> activate(
            @RequestHeader(value = SkillManagementController.EMPLOYEE_HEADER, required = false) String employeeId,
            @PathVariable String id) {
        InstitutionAdminResponse r = service.changeActive(employeeId, id, true);
        return ApiResponse.ok(r.name() + " 기관을 다시 사용합니다.", r);
    }

    /** 산출 이력·대사·테스트 결과·연결 회원이 없는 기관만 삭제 (있으면 409) */
    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(
            @RequestHeader(value = SkillManagementController.EMPLOYEE_HEADER, required = false) String employeeId,
            @PathVariable String id) {
        Institution removed = service.delete(employeeId, id);
        return ApiResponse.ok(removed.getName() + " 기관을 삭제했습니다.", null);
    }

    /** 매칭 시험: 이 값이 엑셀 기관 칸·AI 이슈 문장에서 어느 기관으로 잡히는지 */
    @GetMapping("/match")
    public ApiResponse<InstitutionMatchResponse> match(
            @RequestHeader(value = SkillManagementController.EMPLOYEE_HEADER, required = false) String employeeId,
            @RequestParam(defaultValue = "") String value) {
        return ApiResponse.ok(service.match(employeeId, value));
    }
}
