package com.kftc.feecalc.domain.auth.controller;

import java.util.List;

import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.kftc.feecalc.common.config.DataInitializer;
import com.kftc.feecalc.common.dto.ApiResponse;
import com.kftc.feecalc.domain.auth.dto.LockedAccountResponse;
import com.kftc.feecalc.domain.auth.dto.LoginHistoryResponse;
import com.kftc.feecalc.domain.auth.dto.LoginRequest;
import com.kftc.feecalc.domain.auth.service.AuthService;
import com.kftc.feecalc.domain.user.dto.MemberResponse;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

/** 로그인, 5회 비밀번호 오류 잠금, 잠금 초기화 */
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/login")
    public ApiResponse<MemberResponse> login(@Valid @RequestBody LoginRequest request, HttpServletRequest http) {
        MemberResponse member = authService.login(request, http.getRemoteAddr(), http.getHeader(HttpHeaders.USER_AGENT));
        return ApiResponse.ok(member.name() + "님, 환영합니다.", member);
    }

    @PostMapping("/logout/{loginId}")
    public ApiResponse<Void> logout(@PathVariable String loginId, HttpServletRequest http) {
        authService.logout(loginId, http.getRemoteAddr(), http.getHeader(HttpHeaders.USER_AGENT));
        return ApiResponse.ok("로그아웃했습니다.");
    }

    /** 관리자: 잠긴 계정 목록 */
    @GetMapping("/locks")
    public ApiResponse<List<LockedAccountResponse>> getLockedAccounts() {
        return ApiResponse.ok(authService.getLockedAccounts());
    }

    /** 잠금 초기화 (관리자 잠금 해제 / 로그인 화면 시연용 초기화) */
    @DeleteMapping("/locks/{loginId}")
    public ApiResponse<Void> unlock(@PathVariable String loginId) {
        authService.unlock(loginId);
        return ApiResponse.ok("잠금을 해제했습니다.");
    }

    /** 관리자: 비밀번호를 기본값(1234)으로 초기화 */
    @PostMapping("/password-reset/{loginId}")
    public ApiResponse<Void> resetPassword(@PathVariable String loginId) {
        authService.resetPassword(loginId, DataInitializer.DEFAULT_PASSWORD);
        return ApiResponse.ok("비밀번호를 초기화했습니다.");
    }

    @GetMapping("/history/{loginId}")
    public ApiResponse<List<LoginHistoryResponse>> getHistory(@PathVariable String loginId) {
        return ApiResponse.ok(authService.getHistory(loginId));
    }
}
