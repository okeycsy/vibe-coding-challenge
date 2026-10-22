package com.kftc.feecalc.common.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import com.kftc.feecalc.common.dto.ApiResponse;

/** 호스팅 헬스 체크 + 프론트가 잠든 무료 서버를 미리 깨울 때 쓰는 가벼운 API */
@RestController
public class HealthController {

    @GetMapping("/api/health")
    public ApiResponse<Void> health() {
        return ApiResponse.ok("UP");
    }
}
