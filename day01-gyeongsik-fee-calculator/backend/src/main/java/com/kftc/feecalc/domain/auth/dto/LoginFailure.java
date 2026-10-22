package com.kftc.feecalc.domain.auth.dto;

/** 로그인 실패 시 data 로 내려가는 정보 (남은 시도 횟수 안내용) */
public record LoginFailure(int failCount, int remainingAttempts, boolean locked) {
}
