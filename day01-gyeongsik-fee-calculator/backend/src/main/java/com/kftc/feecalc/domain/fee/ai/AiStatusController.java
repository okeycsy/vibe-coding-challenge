package com.kftc.feecalc.domain.fee.ai;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import com.kftc.feecalc.common.dto.ApiResponse;

import lombok.RequiredArgsConstructor;

/** 화면에 AI 연결 상태를 보여 주기 위한 API. 키 값은 절대 내보내지 않는다 */
@RestController
@RequiredArgsConstructor
public class AiStatusController {

    private final LlmClient llm;

    public record AiStatus(boolean enabled, String model, String mode) {
    }

    @GetMapping("/api/v1/ai/status")
    public ApiResponse<AiStatus> status() {
        return ApiResponse.ok(new AiStatus(llm.enabled(), llm.enabled() ? llm.model() : null, llm.enabled() ? "AI" : "RULE"));
    }
}
