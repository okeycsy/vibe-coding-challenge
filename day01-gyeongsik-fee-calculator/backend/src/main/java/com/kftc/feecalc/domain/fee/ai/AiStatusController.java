package com.kftc.feecalc.domain.fee.ai;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.kftc.feecalc.common.dto.ApiResponse;

import lombok.RequiredArgsConstructor;

/**
 * 화면에 AI 연결 상태를 보여 주기 위한 API. 키 값은 절대 내보내지 않는다.
 * check=true 면 실제로 짧은 요청을 보내 키·주소·모델이 맞는지 시험한다 (공개 API 라 30초 안의 재시험은 직전 결과를 돌려준다).
 */
@RestController
@RequiredArgsConstructor
public class AiStatusController {

    private static final long CHECK_CACHE_MS = 30_000;

    private final LlmClient llm;
    private CheckResult lastCheck;
    private long lastCheckAt;

    /**
     * @param enabled  서버가 AI 키를 읽었는지 (false 면 규칙 기반)
     * @param check    연결 시험 결과 (check=true 일 때만, 아니면 null)
     */
    public record AiStatus(boolean enabled, String model, String mode, String provider, CheckResult check) {
    }

    public record CheckResult(boolean ok, String message) {
    }

    @GetMapping("/api/v1/ai/status")
    public ApiResponse<AiStatus> status(@RequestParam(defaultValue = "false") boolean check) {
        boolean on = llm.enabled();
        CheckResult result = check && on ? check() : null;
        return ApiResponse.ok(new AiStatus(on, on ? llm.model() : null, on ? "AI" : "RULE", on ? llm.provider() : null, result));
    }

    private synchronized CheckResult check() {
        long now = System.currentTimeMillis();
        if (lastCheck != null && now - lastCheckAt < CHECK_CACHE_MS) {
            return lastCheck;
        }
        try {
            llm.ping();
            lastCheck = new CheckResult(true, llm.provider() + " " + llm.model() + " 호출에 성공했습니다.");
        } catch (LlmClient.LlmException e) {
            lastCheck = new CheckResult(false, e.getMessage());
        }
        lastCheckAt = now;
        return lastCheck;
    }
}
