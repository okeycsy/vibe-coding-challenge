package com.kftc.feecalc.domain.user.controller;

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
import com.kftc.feecalc.domain.user.dto.MemberResponse;
import com.kftc.feecalc.domain.user.dto.PasswordChangeRequest;
import com.kftc.feecalc.domain.user.dto.ProfileUpdateRequest;
import com.kftc.feecalc.domain.user.dto.TaskRequestCreateRequest;
import com.kftc.feecalc.domain.user.dto.TaskRequestResponse;
import com.kftc.feecalc.domain.user.service.UserService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

/** 사용자 정보(마이페이지), 회원 관리(관리자), 담당 업무 권한(RBAC) */
@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    // ---------- 회원 관리 (관리자) ----------

    @GetMapping
    public ApiResponse<List<MemberResponse>> getMembers(@RequestParam(required = false) String status,
                                                        @RequestParam(required = false) String keyword) {
        return ApiResponse.ok(userService.getMembers(status, keyword));
    }

    @PostMapping("/{loginId}/approve")
    public ApiResponse<MemberResponse> approveSignUp(@PathVariable String loginId) {
        return ApiResponse.ok("가입을 승인했습니다.", userService.approveSignUp(loginId));
    }

    @PostMapping("/{loginId}/reject")
    public ApiResponse<MemberResponse> rejectSignUp(@PathVariable String loginId) {
        return ApiResponse.ok("가입을 반려했습니다.", userService.rejectSignUp(loginId));
    }

    // ---------- 내 정보 관리 ----------

    @GetMapping("/{loginId}")
    public ApiResponse<MemberResponse> getMember(@PathVariable String loginId) {
        return ApiResponse.ok(userService.getMemberInfo(loginId));
    }

    @PutMapping("/{loginId}")
    public ApiResponse<MemberResponse> updateProfile(@PathVariable String loginId,
                                                     @Valid @RequestBody ProfileUpdateRequest request) {
        return ApiResponse.ok("기본 정보를 수정했습니다.", userService.updateProfile(loginId, request));
    }

    @PutMapping("/{loginId}/password")
    public ApiResponse<Void> changePassword(@PathVariable String loginId,
                                            @Valid @RequestBody PasswordChangeRequest request) {
        userService.changePassword(loginId, request);
        return ApiResponse.ok("비밀번호를 변경했습니다.");
    }

    // ---------- 담당 업무 권한 ----------

    @GetMapping("/{loginId}/tasks")
    public ApiResponse<List<String>> getTasks(@PathVariable String loginId) {
        return ApiResponse.ok(userService.getTasks(loginId));
    }

    @PostMapping("/{loginId}/tasks/{businessCode}")
    public ApiResponse<MemberResponse> grantTask(@PathVariable String loginId, @PathVariable String businessCode) {
        return ApiResponse.ok("업무 권한을 부여했습니다.", userService.grantTask(loginId, businessCode));
    }

    @DeleteMapping("/{loginId}/tasks/{businessCode}")
    public ApiResponse<MemberResponse> revokeTask(@PathVariable String loginId, @PathVariable String businessCode) {
        return ApiResponse.ok("업무 권한을 해제했습니다.", userService.revokeTask(loginId, businessCode));
    }

    @GetMapping("/{loginId}/task-requests")
    public ApiResponse<List<TaskRequestResponse>> getMyTaskRequests(@PathVariable String loginId) {
        return ApiResponse.ok(userService.getMyTaskRequests(loginId));
    }

    @PostMapping("/{loginId}/task-requests")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<TaskRequestResponse> requestTask(@PathVariable String loginId,
                                                        @Valid @RequestBody TaskRequestCreateRequest request) {
        return ApiResponse.ok("업무 권한을 신청했습니다.", userService.requestTask(loginId, request));
    }
}
