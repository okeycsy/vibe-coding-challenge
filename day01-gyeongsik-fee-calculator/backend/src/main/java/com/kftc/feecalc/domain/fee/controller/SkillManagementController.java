package com.kftc.feecalc.domain.fee.controller;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.kftc.feecalc.common.dto.ApiResponse;
import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.domain.fee.ai.FormulaGeneratorService;
import com.kftc.feecalc.domain.fee.ai.PostprocessGeneratorService;
import com.kftc.feecalc.domain.fee.dto.FormulaGenerateRequest;
import com.kftc.feecalc.domain.fee.dto.FormulaGenerateResponse;
import com.kftc.feecalc.domain.fee.dto.PostprocessGenerateRequest;
import com.kftc.feecalc.domain.fee.dto.PostprocessGenerateResponse;
import com.kftc.feecalc.domain.fee.dto.SkillDetailResponse;
import com.kftc.feecalc.domain.fee.dto.SkillSaveRequest;
import com.kftc.feecalc.domain.fee.dto.SkillSummaryResponse;
import com.kftc.feecalc.domain.fee.service.SkillAccessControlService;
import com.kftc.feecalc.domain.fee.service.SkillEngineService;
import com.kftc.feecalc.domain.fee.service.SkillFileService;
import com.kftc.feecalc.domain.fee.service.SkillFileService.TaskEntry;

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
    private final FormulaGeneratorService formulaGenerator;
    private final PostprocessGeneratorService postprocessGenerator;

    /** 전체 업무와 접근 가능 여부, 파일 상태 (내용 없음) */
    @GetMapping
    public ApiResponse<List<SkillSummaryResponse>> list(
            @RequestHeader(value = EMPLOYEE_HEADER, required = false) String employeeId) {
        List<String> accessible = accessControl.accessibleTaskCodes(employeeId);
        return ApiResponse.ok(fileService.tasks().stream()
                .map(t -> SkillSummaryResponse.of(t, accessible.contains(t.taskCode()), fileService.meta(t.taskCode())))
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

    /**
     * "## 1. 비즈니스 규칙 요약" 텍스트로 "## 3. 정산 수식"을 만든다 (AI, 키가 없으면 내장 변환기). 저장 권한과 같은 권한이 필요하고
     * (없으면 403), 파일은 저장하지 않는다: [AI 계산식 빌더]에서 확인·시뮬레이션 후 PUT 으로 저장한다(저장 때 검증을 한 번 더 한다).
     */
    @PostMapping("/{taskCode}/generate-formula")
    public ApiResponse<FormulaGenerateResponse> generateFormula(
            @RequestHeader(value = EMPLOYEE_HEADER, required = false) String employeeId,
            @PathVariable String taskCode,
            @Valid @RequestBody FormulaGenerateRequest request) {
        String code = accessControl.checkPermission(employeeId, taskCode);
        FormulaGenerateResponse res = formulaGenerator.generate(code, request.businessRulesText());
        return ApiResponse.ok("AI".equals(res.source())
                ? "AI가 1번 규칙으로 3번 수식을 작성했습니다. 시뮬레이션 후 확정 반영해 주세요."
                : "1번 규칙으로 3번 수식을 작성했습니다. 시뮬레이션 후 확정 반영해 주세요.", res);
    }

    /**
     * "## 4. 최종 정산 특이사항" 자연어로 후처리 스크립트를 만든다 (AI, 키가 없으면 내장 변환기). 저장 권한과 같은 권한이 필요하고
     * (없으면 403), 파일은 저장하지 않는다: [AI 계산식 빌더]에서 시뮬레이션 후 PUT 으로 저장한다(저장 때 시험 실행을 한 번 더 한다).
     */
    @PostMapping("/{taskCode}/generate-postprocess")
    public ApiResponse<PostprocessGenerateResponse> generatePostprocess(
            @RequestHeader(value = EMPLOYEE_HEADER, required = false) String employeeId,
            @PathVariable String taskCode,
            @Valid @RequestBody PostprocessGenerateRequest request) {
        String code = accessControl.checkPermission(employeeId, taskCode);
        PostprocessGenerateResponse res = postprocessGenerator.generate(code, request.specialRulesText());
        return ApiResponse.ok("AI".equals(res.source())
                ? "AI가 4번 특이사항으로 후처리 스크립트를 작성했습니다. 시뮬레이션 후 확정 반영해 주세요."
                : "4번 특이사항으로 후처리 스크립트를 작성했습니다. 시뮬레이션 후 확정 반영해 주세요.", res);
    }

    /** 섹션이 덜 채워진 파일(막 추가한 업무 등)도 열어서 고칠 수 있게 원문은 그대로 준다 */
    private SkillDetailResponse detail(String code) {
        TaskEntry task = fileService.task(code);
        String content = fileService.read(code);
        try {
            return SkillDetailResponse.of(task.name(), task.fileName(), content,
                    SkillEngineService.parse(code, task.businessId(), content), fileService.meta(code));
        } catch (BusinessException e) {
            return SkillDetailResponse.incomplete(code, task.businessId(), task.name(), task.fileName(), content,
                    e.getMessage(), fileService.meta(code));
        }
    }
}
