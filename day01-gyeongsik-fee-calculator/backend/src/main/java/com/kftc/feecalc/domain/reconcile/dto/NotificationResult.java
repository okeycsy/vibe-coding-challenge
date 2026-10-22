package com.kftc.feecalc.domain.reconcile.dto;

/** sent=false 이면 웹훅 미설정(로그만 남김) 또는 발송 실패 */
public record NotificationResult(boolean sent, String channel, String detail) {
}
