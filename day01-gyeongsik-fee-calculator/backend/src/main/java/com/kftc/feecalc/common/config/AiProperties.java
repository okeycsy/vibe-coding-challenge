package com.kftc.feecalc.common.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * application.yml 의 ai.* 설정 (OpenAI Chat Completions 호환 API).
 * 저장소가 공개라 키는 파일에 적지 않고 AI_API_KEY 환경변수로만 넣는다. 키가 비어 있으면 규칙 기반으로 동작한다.
 * Gemini 는 OpenAI 호환 주소(https://generativelanguage.googleapis.com/v1beta/openai)를 base-url 로 주면 같은 코드로 호출된다.
 */
@ConfigurationProperties(prefix = "ai")
public record AiProperties(String apiKey, String model, String baseUrl, Integer timeoutSeconds) {

    public boolean enabled() {
        return apiKey != null && !apiKey.isBlank();
    }

    public String modelOrDefault() {
        return model == null || model.isBlank() ? "gpt-4o-mini" : model.strip();
    }

    public String baseUrlOrDefault() {
        String url = baseUrl == null || baseUrl.isBlank() ? "https://api.openai.com/v1" : baseUrl.strip();
        return url.replaceAll("/+$", "");
    }

    public int timeoutOrDefault() {
        return timeoutSeconds == null || timeoutSeconds <= 0 ? 20 : timeoutSeconds;
    }
}
