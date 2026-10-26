package com.kftc.feecalc.domain.fee.ai;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kftc.feecalc.common.config.AiProperties;

import lombok.extern.slf4j.Slf4j;

/**
 * OpenAI Chat Completions 호환 API 호출 (POST {base-url}/chat/completions). OpenAI 와 Gemini(OpenAI 호환 주소) 모두 같은 형식이다.
 * 응답은 JSON 객체로만 받는다(response_format json_object). 키가 없으면 {@link #enabled()}가 false 이고 호출하지 않는다.
 * 실패하면 HTTP 상태·제공자 오류 문구(키는 가림)를 담은 {@link LlmException}을 던져 화면에서 원인을 볼 수 있게 한다.
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
        // 배포 로그에서 키를 읽었는지 바로 알 수 있게 남긴다 (키 값은 남기지 않음)
        if (props.enabled()) {
            log.info("AI 사용: {} · {} · {}", props.provider(), props.modelOrDefault(), props.baseUrlOrDefault());
        } else {
            log.info("AI 키(AI_API_KEY)가 없어 규칙 기반으로 동작합니다.");
        }
    }

    public boolean enabled() {
        return props.enabled();
    }

    public String model() {
        return props.modelOrDefault();
    }

    public String provider() {
        return props.provider();
    }

    /** 연결 시험: 아주 짧은 요청을 보내 키·주소·모델이 맞는지 본다. 실패하면 LlmException */
    public void ping() {
        chatJson("Reply only with the JSON object {\"ok\":true}.", "ping");
    }

    /** 시스템·사용자 프롬프트를 보내고 모델이 돌려준 JSON 객체를 읽는다. 실패하면 LlmException */
    public JsonNode chatJson(String system, String user) {
        if (!enabled()) {
            throw new LlmException("AI API 키(AI_API_KEY)가 설정되지 않았습니다.");
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", props.modelOrDefault());
        // gpt-5·o 계열(추론 모델)은 temperature 기본값(1) 외에는 400 으로 거절한다
        if (!reasoningModel(props.modelOrDefault())) {
            body.put("temperature", 0);
        }
        body.put("response_format", Map.of("type", "json_object"));
        body.put("messages", List.of(
                Map.of("role", "system", "content", system),
                Map.of("role", "user", "content", user)));
        String content;
        try {
            // 바이트로 보내 Content-Length 를 붙인다 (chunked 전송을 받지 않는 호환 서버 대비)
            byte[] json = om.writeValueAsBytes(body);
            String raw = rest.post().uri("/chat/completions")
                    .header("Authorization", "Bearer " + props.key())
                    .contentType(MediaType.APPLICATION_JSON)
                    .contentLength(json.length)
                    .body(json)
                    .retrieve()
                    .body(String.class);
            // 문자열로 받아 직접 읽는다 (Content-Type 이 json 이 아닌 호환 서버 대비)
            JsonNode res = raw == null || raw.isBlank() ? null : om.readTree(raw);
            content = res == null ? null : res.path("choices").path(0).path("message").path("content").asText(null);
        } catch (RestClientResponseException e) {
            String msg = describe(e.getStatusCode().value(), e.getResponseBodyAsString());
            log.warn("AI 호출 실패: {}", msg);
            throw new LlmException(msg, e);
        } catch (ResourceAccessException e) {
            String msg = props.provider() + " 서버에 연결하지 못했거나 " + props.timeoutOrDefault() + "초 안에 답이 없습니다 ("
                    + rootName(e) + "). AI_TIMEOUT_SECONDS 를 늘리거나 잠시 후 다시 시도해 주세요.";
            log.warn("AI 호출 실패: {}", msg);
            throw new LlmException(msg, e);
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

    static boolean reasoningModel(String model) {
        String m = model.toLowerCase();
        return m.startsWith("gpt-5") || m.matches("^o\\d.*");
    }

    /** HTTP 오류를 원인이 보이는 한국어 문구로. 제공자 오류 문구는 키처럼 보이는 값을 가리고 200자로 자른다 */
    public String describe(int status, String responseBody) {
        String hint = switch (status) {
            case 400 -> "요청이 거절되었습니다. AI_MODEL(" + props.modelOrDefault() + ")이 이 제공자에서 쓰는 이름인지 확인해 주세요";
            case 401, 403 -> "API 키가 올바르지 않거나 권한이 없습니다. 키와 제공자가 맞는지 확인해 주세요 (현재 "
                    + props.provider() + ", Gemini 키는 AIza 로 시작)";
            case 404 -> "모델(" + props.modelOrDefault() + ") 또는 주소(" + props.baseUrlOrDefault() + ")를 찾지 못했습니다";
            case 429 -> "사용 한도를 넘었거나 결제·크레딧이 없습니다. 제공자 콘솔에서 한도·결제를 확인해 주세요";
            default -> status >= 500 ? "AI 제공자 서버 오류입니다. 잠시 후 다시 시도해 주세요" : "AI 호출이 거절되었습니다";
        };
        String detail = providerMessage(responseBody);
        return "AI 호출 실패 HTTP " + status + ": " + hint + (detail.isEmpty() ? "" : " — " + detail);
    }

    private String providerMessage(String responseBody) {
        if (responseBody == null || responseBody.isBlank()) {
            return "";
        }
        String text = responseBody;
        try {
            JsonNode n = om.readTree(responseBody);
            if (n.isArray()) {
                n = n.path(0);
            }
            JsonNode m = n.path("error").path("message");
            if (m.isTextual()) {
                text = m.asText();
            }
        } catch (Exception ignored) {
            // JSON 이 아니면 본문 그대로
        }
        String key = props.key();
        if (!key.isEmpty()) {
            text = text.replace(key, "***");
        }
        text = text.replaceAll("(sk-|AIza)[A-Za-z0-9_*\\-]{4,}", "$1***").replaceAll("\\s+", " ").strip();
        return text.length() > 200 ? text.substring(0, 200) + "…" : text;
    }

    private static String rootName(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) {
            t = t.getCause();
        }
        return t.getClass().getSimpleName();
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
