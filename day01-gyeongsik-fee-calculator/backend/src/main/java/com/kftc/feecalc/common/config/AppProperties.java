package com.kftc.feecalc.common.config;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** application.yml 의 app.* 설정 */
@ConfigurationProperties(prefix = "app")
public record AppProperties(Cors cors, Auth auth, Mattermost mattermost) {

    public record Cors(List<String> allowedOrigins) {
    }

    public record Auth(int maxFailCount) {
    }

    public record Mattermost(String webhookUrl, String channel) {
    }
}
