package com.kftc.feecalc.common.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * application.yml 의 ai.* 설정 (OpenAI Chat Completions 호환 API).
 * 저장소가 공개라 키는 파일에 적지 않고 환경변수(AI_API_KEY 등)로만 넣는다. 키가 비어 있으면 규칙 기반으로 동작한다.
 * Gemini 는 OpenAI 호환 주소(https://generativelanguage.googleapis.com/v1beta/openai)를 base-url 로 주면 같은 코드로 호출된다.
 * base-url·model 을 비워 두면 키 모양으로 정한다: Gemini 키(AIza...)면 Gemini, 아니면 OpenAI.
 */
@ConfigurationProperties(prefix = "ai")
public record AiProperties(String apiKey, String model, String baseUrl, Integer timeoutSeconds) {

    public static final String OPENAI_URL = "https://api.openai.com/v1";
    public static final String GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

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
        String url = baseUrl == null || baseUrl.isBlank() ? (geminiKey() ? GEMINI_URL : OPENAI_URL) : baseUrl.strip();
        return url.replaceAll("/+$", "");
    }

    public boolean gemini() {
        return baseUrlOrDefault().contains("generativelanguage.googleapis.com");
    }

    /** 화면에 보일 제공자 이름 */
    public String provider() {
        String url = baseUrlOrDefault();
        return gemini() ? "Gemini" : url.contains("api.openai.com") ? "OpenAI" : "OpenAI 호환";
    }

    public String modelOrDefault() {
        return model == null || model.isBlank() ? (gemini() ? "gemini-2.5-flash" : "gpt-4o-mini") : model.strip();
    }

    public int timeoutOrDefault() {
        return timeoutSeconds == null || timeoutSeconds <= 0 ? 30 : timeoutSeconds;
    }
}
