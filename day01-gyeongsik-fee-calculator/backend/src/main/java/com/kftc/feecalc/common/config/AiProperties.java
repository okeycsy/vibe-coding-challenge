package com.kftc.feecalc.common.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * application.yml 의 ai.* 설정 (OpenAI Chat Completions 호환 API).
 * 저장소가 공개라 키는 파일에 적지 않고 환경변수(AI_API_KEY 등)로만 넣는다. 키가 비어 있으면 규칙 기반으로 동작한다.
 * Gemini 는 OpenAI 호환 주소(https://generativelanguage.googleapis.com/v1beta/openai)를 base-url 로 주면 같은 코드로 호출된다.
 * Claude(Anthropic) 는 OpenAI 호환 주소가 response_format json_object 를 받지 않아 Messages API(/v1/messages)를 직접 부른다.
 * base-url·model 을 비워 두면 키 모양으로 정한다: Claude 키(sk-ant-...)면 Anthropic, Gemini 키(AIza...)면 Gemini, 아니면 OpenAI.
 */
@ConfigurationProperties(prefix = "ai")
public record AiProperties(String apiKey, String model, String baseUrl, Integer timeoutSeconds) {

    public static final String OPENAI_URL = "https://api.openai.com/v1";
    public static final String GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
    public static final String ANTHROPIC_URL = "https://api.anthropic.com";

    /** 앞뒤 공백·따옴표를 뗀 키 (Render 에 "sk-..." 처럼 따옴표째 붙여 넣은 경우 대비) */
    public String key() {
        if (apiKey == null) {
            return "";
        }
        String k = apiKey.strip();
        if (k.length() >= 2 && (k.startsWith("\"") && k.endsWith("\"") || k.startsWith("'") && k.endsWith("'"))) {
            k = k.substring(1, k.length() - 1).strip();
        }
        if (k.regionMatches(true, 0, "Bearer ", 0, 7)) {
            k = k.substring(7).strip();
        }
        return k;
    }

    public boolean enabled() {
        return !key().isEmpty();
    }

    /** 키가 Gemini(Google AI Studio) 키 모양인지 */
    private boolean geminiKey() {
        return key().startsWith("AIza");
    }

    public String baseUrlOrDefault() {
        String url = baseUrl == null || baseUrl.isBlank()
                ? (key().startsWith("sk-ant-") ? ANTHROPIC_URL : geminiKey() ? GEMINI_URL : OPENAI_URL)
                : baseUrl.strip();
        url = url.replaceAll("/+$", "");
        // Anthropic 은 /v1/messages 를 붙여 부르므로 끝의 /v1 은 뗀다 (OpenAI 호환 주소 https://api.anthropic.com/v1 을 넣은 경우)
        return url.contains("anthropic.com") || key().startsWith("sk-ant-") ? url.replaceAll("/v1$", "") : url;
    }

    /** Claude(Anthropic Messages API)로 부르는지 */
    public boolean anthropic() {
        return key().startsWith("sk-ant-") || baseUrlOrDefault().contains("anthropic.com");
    }

    public boolean gemini() {
        return baseUrlOrDefault().contains("generativelanguage.googleapis.com");
    }

    /** 화면에 보일 제공자 이름 */
    public String provider() {
        String url = baseUrlOrDefault();
        return anthropic() ? "Claude" : gemini() ? "Gemini" : url.contains("api.openai.com") ? "OpenAI" : "OpenAI 호환";
    }

    public String modelOrDefault() {
        return model == null || model.isBlank()
                ? (anthropic() ? "claude-opus-5-5" : gemini() ? "gemini-2.5-flash" : "gpt-4o-mini")
                : model.strip();
    }

    public int timeoutOrDefault() {
        // Claude 는 생각(thinking)을 거쳐 답해 기본 제한 시간을 넉넉히 둔다
        return timeoutSeconds == null || timeoutSeconds <= 0 ? (anthropic() ? 90 : 30) : timeoutSeconds;
    }
}
