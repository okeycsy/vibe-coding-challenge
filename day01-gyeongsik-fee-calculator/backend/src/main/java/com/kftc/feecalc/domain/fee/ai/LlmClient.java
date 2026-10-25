package com.kftc.feecalc.domain.fee.ai;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kftc.feecalc.common.config.AiProperties;

import lombok.extern.slf4j.Slf4j;

/**
 * OpenAI Chat Completions 호환 API 호출 (POST {base-url}/chat/completions). OpenAI 와 Gemini(OpenAI 호환 주소) 모두 같은 형식이다.
 * 응답은 JSON 객체로만 받는다(response_format json_object). 키가 없으면 {@link #enabled()}가 false 이고 호출하지 않는다.
 */
@Slf4j
@Component
public class LlmClient {

    private final AiProperties props;
    private final ObjectMapper om;
    private final RestClient rest;

    public LlmClient(AiProperties props, ObjectMapper om) {
        this.props = props;
        this.om = om;
        Duration timeout = Duration.ofSeconds(props.timeoutOrDefault());
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(
                HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(timeout).build());
        factory.setReadTimeout(timeout);
        this.rest = RestClient.builder().baseUrl(props.baseUrlOrDefault()).requestFactory(factory).build();
    }

    public boolean enabled() {
        return props.enabled();
    }

    public String model() {
        return props.modelOrDefault();
    }

    /** 시스템·사용자 프롬프트를 보내고 모델이 돌려준 JSON 객체를 읽는다. 실패하면 LlmException */
    public JsonNode chatJson(String system, String user) {
        if (!enabled()) {
            throw new LlmException("AI API 키(AI_API_KEY)가 설정되지 않았습니다.");
        }
        Map<String, Object> body = Map.of(
                "model", props.modelOrDefault(),
                "temperature", 0,
                "response_format", Map.of("type", "json_object"),
                "messages", List.of(
                        Map.of("role", "system", "content", system),
                        Map.of("role", "user", "content", user)));
        String content;
        try {
            // 바이트로 보내 Content-Length 를 붙인다 (chunked 전송을 받지 않는 호환 서버 대비)
            byte[] json = om.writeValueAsBytes(body);
            JsonNode res = rest.post().uri("/chat/completions")
                    .header("Authorization", "Bearer " + props.apiKey().strip())
                    .contentType(MediaType.APPLICATION_JSON)
                    .contentLength(json.length)
                    .body(json)
                    .retrieve()
                    .body(JsonNode.class);
            content = res == null ? null : res.path("choices").path(0).path("message").path("content").asText(null);
        } catch (RuntimeException | java.io.IOException e) {
            // 키가 오류 메시지에 섞여 나가지 않도록 예외 종류만 남긴다
            log.warn("AI 호출 실패: {}", e.getClass().getSimpleName());
            throw new LlmException("AI 호출에 실패했습니다 (" + e.getClass().getSimpleName() + ").", e);
        }
        if (content == null || content.isBlank()) {
            throw new LlmException("AI 응답이 비어 있습니다.");
        }
        return parseJson(content);
    }

    /** ```json 울타리가 붙어 와도 읽는다 */
    JsonNode parseJson(String content) {
        String text = content.strip();
        if (text.startsWith("```")) {
            text = text.replaceFirst("^```[a-zA-Z]*\\s*", "").replaceFirst("\\s*```$", "");
        }
        try {
            return om.readTree(text);
        } catch (Exception e) {
            throw new LlmException("AI 응답을 JSON 으로 읽을 수 없습니다.", e);
        }
    }

    public static class LlmException extends RuntimeException {
        public LlmException(String message) {
            super(message);
        }

        public LlmException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
