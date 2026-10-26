package com.kftc.feecalc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.kftc.feecalc.common.config.AiProperties;
import com.kftc.feecalc.domain.fee.ai.LlmClient;

/** AI 키·제공자 판별과 실패 원인 문구 (실제 호출 없음) */
class AiSettingsTests {

    @Test
    void 키_모양으로_제공자와_기본_모델을_정하고_따옴표는_뗀다() {
        AiProperties gemini = new AiProperties(" \"AIzaTESTKEY123456\" ", null, "", null);
        assertThat(gemini.enabled()).isTrue();
        assertThat(gemini.key()).isEqualTo("AIzaTESTKEY123456");
        assertThat(gemini.provider()).isEqualTo("Gemini");
        assertThat(gemini.baseUrlOrDefault()).isEqualTo(AiProperties.GEMINI_URL);
        assertThat(gemini.modelOrDefault()).isEqualTo("gemini-2.5-flash");

        AiProperties openai = new AiProperties("sk-test", "", null, null);
        assertThat(openai.provider()).isEqualTo("OpenAI");
        assertThat(openai.modelOrDefault()).isEqualTo("gpt-4o-mini");

        AiProperties custom = new AiProperties("sk-test", "gpt-5-mini", "https://api.openai.com/v1/", 0);
        assertThat(custom.baseUrlOrDefault()).isEqualTo("https://api.openai.com/v1");
        assertThat(custom.timeoutOrDefault()).isEqualTo(30);

        assertThat(new AiProperties("  ", null, null, null).enabled()).isFalse();
    }

    @Test
    void 실패_원인에_HTTP_상태와_제공자_문구를_담되_키는_가린다() {
        LlmClient llm = new LlmClient(new AiProperties("sk-secretvalue999", null, null, 5), new ObjectMapper());
        String msg = llm.describe(401, """
                {"error":{"message":"Incorrect API key provided: sk-secretvalue999. You can find your API key at ...","code":"invalid_api_key"}}""");
        assertThat(msg).startsWith("AI 호출 실패 HTTP 401").contains("API 키가 올바르지 않거나").contains("Incorrect API key provided");
        assertThat(msg).doesNotContain("secretvalue999");

        String gemini = new LlmClient(new AiProperties("AIzaSecret12345", null, null, 5), new ObjectMapper())
                .describe(400, "[{\"error\":{\"code\":400,\"message\":\"API key not valid. Please pass a valid API key.\"}}]");
        assertThat(gemini).contains("HTTP 400").contains("gemini-2.5-flash").contains("API key not valid");
        assertThat(llm.describe(429, "")).contains("사용 한도");
    }

    @Test
    void 실제_HTTP_호출에서_성공하면_JSON을_읽고_거절되면_원인을_담아_던진다() throws Exception {
        AtomicReference<Integer> status = new AtomicReference<>(200);
        AtomicReference<String> auth = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", ex -> {
            auth.set(ex.getRequestHeaders().getFirst("Authorization"));
            byte[] out = (status.get() == 200
                    ? "{\"choices\":[{\"message\":{\"content\":\"{\\\"ok\\\":true}\"}}]}"
                    : "{\"error\":{\"message\":\"Incorrect API key provided: sk-abc12345\"}}").getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(status.get(), out.length);
            ex.getResponseBody().write(out);
            ex.close();
        });
        server.start();
        try {
            String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";
            LlmClient llm = new LlmClient(new AiProperties("'sk-abc12345'", "test-model", url, 5), new ObjectMapper());
            assertThat(llm.chatJson("s", "u").path("ok").asBoolean()).isTrue();
            assertThat(auth.get()).isEqualTo("Bearer sk-abc12345");

            status.set(401);
            assertThatThrownBy(() -> llm.chatJson("s", "u"))
                    .isInstanceOf(LlmClient.LlmException.class)
                    .hasMessageContaining("HTTP 401")
                    .hasMessageContaining("Incorrect API key provided")
                    .hasMessageNotContaining("abc12345");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void Claude_키면_Messages_API로_부르고_text_블록에서_JSON을_읽는다() throws Exception {
        AiProperties claude = new AiProperties("sk-ant-test", "claude-sonnet-5-5", "https://api.anthropic.com/v1/", null);
        assertThat(claude.anthropic()).isTrue();
        assertThat(claude.provider()).isEqualTo("Claude");
        assertThat(claude.baseUrlOrDefault()).isEqualTo("https://api.anthropic.com");
        assertThat(claude.timeoutOrDefault()).isEqualTo(90);
        assertThat(new AiProperties("sk-ant-test", null, null, null).modelOrDefault()).isEqualTo("claude-opus-5-5");

        AtomicReference<String> req = new AtomicReference<>();
        AtomicReference<String> key = new AtomicReference<>();
        AtomicReference<String> version = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/messages", ex -> {
            req.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            key.set(ex.getRequestHeaders().getFirst("x-api-key"));
            version.set(ex.getRequestHeaders().getFirst("anthropic-version"));
            byte[] out = """
                    {"content":[{"type":"thinking","thinking":""},{"type":"text","text":"결과입니다:\\n{\\\"formula\\\":\\\"#finalCount * 10\\\"}"}],"stop_reason":"end_turn"}"""
                    .getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(200, out.length);
            ex.getResponseBody().write(out);
            ex.close();
        });
        server.start();
        try {
            String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";
            LlmClient llm = new LlmClient(new AiProperties("sk-ant-test", "claude-sonnet-5-5", url, 5), new ObjectMapper());
            assertThat(llm.chatJson("sys", "rules").path("formula").asText()).isEqualTo("#finalCount * 10");
            assertThat(key.get()).isEqualTo("sk-ant-test");
            assertThat(version.get()).isNotBlank();
            assertThat(req.get()).contains("\"max_tokens\"").contains("\"system\"").doesNotContain("response_format").doesNotContain("temperature");
        } finally {
            server.stop(0);
        }
    }
}
