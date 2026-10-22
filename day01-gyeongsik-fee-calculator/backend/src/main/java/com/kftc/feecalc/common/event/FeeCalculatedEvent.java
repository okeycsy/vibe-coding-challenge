package com.kftc.feecalc.common.event;

/** 회비 산출 완료 이벤트. reconcile 도메인이 받아 기관별 대사 내역을 만든다. */
public record FeeCalculatedEvent(Long calculationId) {
}
