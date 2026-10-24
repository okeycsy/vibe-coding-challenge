package com.kftc.feecalc.domain.fee.controller;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.kftc.feecalc.common.dto.ApiResponse;
import com.kftc.feecalc.domain.fee.dto.CalculationRequest;
import com.kftc.feecalc.domain.fee.dto.CalculationResponse;
import com.kftc.feecalc.domain.fee.dto.SkillResponse;
import com.kftc.feecalc.domain.fee.dto.SkillUpdateRequest;
import com.kftc.feecalc.domain.fee.service.FeeCalculationService;
import com.kftc.feecalc.domain.fee.service.SkillEngineService;
import com.kftc.feecalc.domain.user.service.UserService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

/** 업무별 skill.md 기반 회비 산출 (v1) */
@RestController
@RequestMapping("/api/v1/fees")
@RequiredArgsConstructor
public class FeeSkillController {

    private final SkillEngineService skillEngine;
    private final FeeCalculationService calculationService;
    private final UserService userService;

    @GetMapping("/skills")
    public ApiResponse<List<SkillResponse>> getSkills() {
        return ApiResponse.ok(skillEngine.taskCodes().stream().map(this::toResponse).toList());
    }

    /** taskCode: OPEN_BANKING 같은 업무 코드 또는 openbanking 같은 업무 ID */
    @GetMapping("/skill/{taskCode}")
    public ApiResponse<SkillResponse> getSkill(@PathVariable String taskCode) {
        return ApiResponse.ok(toResponse(taskCode));
    }

    /** skill.md 수정. 검증(섹션·수식 시험 계산)을 통과하면 다음 산출부터 바로 반영된다 */
    @PutMapping("/skill/{taskCode}")
    public ApiResponse<SkillResponse> updateSkill(@PathVariable String taskCode,
                                                  @Valid @RequestBody SkillUpdateRequest request) {
        userService.checkSysadmin(request.updatedBy());
        skillEngine.update(taskCode, request.markdown(), request.updatedBy());
        return ApiResponse.ok("회비 기준(skill.md)을 저장했습니다. 다음 산출부터 적용됩니다.", toResponse(taskCode));
    }

    /** 원본 skill.md 로 되돌리기 */
    @DeleteMapping("/skill/{taskCode}")
    public ApiResponse<SkillResponse> resetSkill(@PathVariable String taskCode, @RequestParam String updatedBy) {
        userService.checkSysadmin(updatedBy);
        skillEngine.reset(taskCode, updatedBy);
        return ApiResponse.ok("원본 skill.md 로 되돌렸습니다.", toResponse(taskCode));
    }

    /** skill.md 수식으로 회비 산출 (businessId 에 업무 코드 또는 업무 ID) */
    @PostMapping("/calculate")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<CalculationResponse> calculate(@Valid @RequestBody CalculationRequest request) {
        return ApiResponse.ok("skill.md 수식으로 회비 초안을 산출했습니다.", calculationService.calculate(request));
    }

    private SkillResponse toResponse(String code) {
        return SkillResponse.of(skillEngine.getSkill(code), skillEngine.getStored(code), skillEngine.isModified(code));
    }
}
