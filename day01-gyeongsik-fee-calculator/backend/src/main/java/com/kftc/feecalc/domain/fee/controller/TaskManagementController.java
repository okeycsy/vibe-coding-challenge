package com.kftc.feecalc.domain.fee.controller;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.kftc.feecalc.common.dto.ApiResponse;
import com.kftc.feecalc.domain.fee.dto.TaskCreateRequest;
import com.kftc.feecalc.domain.fee.dto.TaskResponse;
import com.kftc.feecalc.domain.fee.service.SkillFileService.TaskEntry;
import com.kftc.feecalc.domain.fee.service.TaskManagementService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

/**
 * 업무 관리. 조회는 로그인한 누구나(업무 목록·파일명만, skill.md 내용은 /api/v1/skills 권한을 따른다),
 * 추가·삭제는 시스템관리자만. 사번은 X-Employee-Id 헤더로 받는다.
 */
@RestController
@RequestMapping("/api/v1/tasks")
@RequiredArgsConstructor
public class TaskManagementController {

    private final TaskManagementService taskService;

    @GetMapping
    public ApiResponse<List<TaskResponse>> list() {
        return ApiResponse.ok(taskService.list());
    }

    /** 업무 추가: md 파일을 기본 템플릿의 제목만 넣어 만든다 */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<TaskResponse> create(
            @RequestHeader(value = SkillManagementController.EMPLOYEE_HEADER, required = false) String employeeId,
            @Valid @RequestBody TaskCreateRequest request) {
        TaskResponse created = taskService.create(employeeId, request.taskCode(), request.name(), request.fileName());
        return ApiResponse.ok(created.name() + " 업무를 추가하고 " + created.fileName() + " 파일을 만들었습니다.", created);
    }

    /** 업무 삭제: 연결된 md 파일과 업무 권한도 함께 지운다 (되돌릴 수 없음) */
    @DeleteMapping("/{taskCode}")
    public ApiResponse<Void> delete(
            @RequestHeader(value = SkillManagementController.EMPLOYEE_HEADER, required = false) String employeeId,
            @PathVariable String taskCode) {
        TaskEntry removed = taskService.delete(employeeId, taskCode);
        return ApiResponse.ok(removed.name() + " 업무와 " + removed.fileName() + " 파일을 삭제했습니다.", null);
    }
}
