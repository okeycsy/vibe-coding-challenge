package com.kftc.feecalc.domain.user.controller;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.kftc.feecalc.common.dto.ApiResponse;
import com.kftc.feecalc.domain.user.dto.TaskRequestResponse;
import com.kftc.feecalc.domain.user.service.UserService;

import lombok.RequiredArgsConstructor;

/** 관리자 설정 › 업무 권한 관리: 신청 승인·반려 */
@RestController
@RequestMapping("/api/task-requests")
@RequiredArgsConstructor
public class TaskRequestController {

    private final UserService userService;

    /** status: PENDING | APPROVED | REJECTED (비우면 전체) */
    @GetMapping
    public ApiResponse<List<TaskRequestResponse>> getTaskRequests(@RequestParam(required = false) String status) {
        return ApiResponse.ok(userService.getTaskRequests(status));
    }

    @PostMapping("/{id}/approve")
    public ApiResponse<TaskRequestResponse> approve(@PathVariable Long id) {
        return ApiResponse.ok("업무 권한 신청을 승인했습니다.", userService.approveTaskRequest(id));
    }

    @PostMapping("/{id}/reject")
    public ApiResponse<TaskRequestResponse> reject(@PathVariable Long id) {
        return ApiResponse.ok("업무 권한 신청을 반려했습니다.", userService.rejectTaskRequest(id));
    }
}
