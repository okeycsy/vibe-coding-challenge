package com.kftc.feecalc.domain.reconcile.service;

import java.util.Map;

import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import com.kftc.feecalc.common.config.AppProperties;
import com.kftc.feecalc.domain.reconcile.dto.NotificationResult;

import lombok.extern.slf4j.Slf4j;

/**
 * Mattermost Incoming Webhook 알림.
 * app.mattermost.webhook-url 이 비어 있으면 실제로 보내지 않고 로그만 남긴다 (시연 기본값).
 * 알림 실패가 업무 처리를 막지 않도록 예외를 던지지 않는다.
 */
@Slf4j
@Component
public class MattermostNotifier {

    private final AppProperties.Mattermost config;
    private final RestClient restClient;

    public MattermostNotifier(AppProperties properties, RestClient.Builder builder) {
        this.config = properties.mattermost();
        this.restClient = builder.build();
    }

    public NotificationResult send(String text) {
        String url = config.webhookUrl();
        if (url == null || url.isBlank()) {
            log.info("[Mattermost 미설정 - 로그만 기록] #{} {}", config.channel(), text);
            return new NotificationResult(false, config.channel(), "웹훅 URL이 설정되지 않아 로그로만 남겼습니다.");
        }
        try {
            restClient.post()
                    .uri(url)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("channel", config.channel(), "username", "회비자동산출", "text", text))
                    .retrieve()
                    .toBodilessEntity();
            return new NotificationResult(true, config.channel(), "발송했습니다.");
        } catch (RestClientException e) {
            log.warn("Mattermost 발송 실패: {}", e.getMessage());
            return new NotificationResult(false, config.channel(), "발송 실패: " + e.getMessage());
        }
    }
}
