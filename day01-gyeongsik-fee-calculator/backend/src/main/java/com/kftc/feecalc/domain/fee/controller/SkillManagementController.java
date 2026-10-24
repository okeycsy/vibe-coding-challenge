package com.kftc.feecalc.domain.fee.controller;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.kftc.feecalc.common.dto.ApiResponse;
import com.kftc.feecalc.domain.fee.dto.SkillDetailResponse;
import com.kftc.feecalc.domain.fee.dto.SkillSaveRequest;
import com.kftc.feecalc.domain.fee.dto.SkillSummaryResponse;
import com.kftc.feecalc.domain.fee.entity.Business;
import com.kftc.feecalc.domain.fee.repository.BusinessRepository;
import com.kftc.feecalc.domain.fee.service.SkillAccessControlService;
import com.kftc.feecalc.domain.fee.service.SkillEngineService;
import com.kftc.feecalc.domain.fee.service.SkillFileService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

/**
 * 업무별 회비분담기준(skill.md) 관리. 모든 요청은 X-Employee-Id 헤더(로그인 사번)로 권한을 확인한다.
 * 시스템관리자는 전체 업무, 일반담당자는 승인된 업무만 조회·수정할 수 있다.
 */
@RestController
@RequestMapping("/api/v1/skills")
@RequiredArgsConstructor
public class SkillManagementController {

    static final String EMPLOYEE_HEADER = "X-Employee-Id";

    private final SkillFileService fileService;
    private final SkillAccessControlService accessControl;
    private final SkillEngineService skillEngine;
    private final BusinessRepository businessRepository;

    /** 전체 업무와 접근 가능 여부, 파일 상태 (내용 없음) */
    @GetMapping
    public ApiResponse<List<SkillSummaryResponse>> list(
            @RequestHeader(value = EMPLOYEE_HEADER, required = false) String employeeId) {
        List<String> accessible = accessControl.accessibleTaskCodes(employeeId);
        Map<String, String> names = taskNames();
        return ApiResponse.ok(fileService.taskCodes().stream()
                .map(code -> SkillSummaryResponse.of(names.get(code), SkillFileService.businessIdOf(code),
                        accessible.contains(code), fileService.meta(code)))
                .toList());
    }

    @GetMapping("/{taskCode}")
    public ApiResponse<SkillDetailResponse> get(
            @RequestHeader(value = EMPLOYEE_HEADER, required = false) String employeeId,
            @PathVariable String taskCode) {
        return ApiResponse.ok(detail(accessControl.checkPermission(employeeId, taskCode)));
    }

    /** 섹션·수식 구문 검사를 통과하면 파일을 덮어쓰고, 다음 산출부터 바로 반영된다 */
    @PutMapping("/{taskCode}")
    public ApiResponse<SkillDetailResponse> save(
            @RequestHeader(value = EMPLOYEE_HEADER, required = false) String employeeId,
            @PathVariable String taskCode,
            @Valid @RequestBody SkillSaveRequest request) {
        String code = accessControl.checkPermission(employeeId, taskCode);
        fileService.save(code, request.content(), employeeId.trim());
        SkillDetailResponse saved = detail(code);
        return ApiResponse.ok(saved.taskName() + " 회비분담기준(skill.md)이 성공적으로 저장 및 반영되었습니다.", saved);
    }

    /** 초기 기준으로 되돌리기 (시스템관리자만) */
    @PostMapping("/{taskCode}/reset")
    public ApiResponse<SkillDetailResponse> reset(
            @RequestHeader(value = EMPLOYEE_HEADER, required = false) String employeeId,
            @PathVariable String taskCode) {
        String code = accessControl.checkPermission(employeeId, taskCode);
        accessControl.checkAdmin(employeeId);
        fileService.reset(code, employeeId.trim());
        return ApiResponse.ok("초기 기준 skill.md 로 되돌렸습니다.", detail(code));
    }

    private SkillDetailResponse detail(String code) {
        String content = fileService.read(code);
        return SkillDetailResponse.of(taskNames().get(code), content,
                SkillEngineService.parse(code, SkillFileService.businessIdOf(code), content), fileService.meta(code));
    }

    /** 업무 코드 → 업무명 */
    private Map<String, String> taskNames() {
        Map<String, String> byBusinessId = businessRepository.findAll().stream()
                .collect(Collectors.toMap(Business::getCode, Business::getName));
        return fileService.taskCodes().stream().collect(Collectors.toMap(Function.identity(),
                code -> byBusinessId.getOrDefault(SkillFileService.businessIdOf(code), code)));
    }
}
