package com.kftc.feecalc.domain.auth.entity;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@Getter
@RequiredArgsConstructor
public enum LoginResult {

    SUCCESS("정상 로그인"),
    LOGOUT("로그아웃"),
    WRONG_PASSWORD("비밀번호 오류"),
    LOCKED("잠금 계정 접근"),
    NOT_APPROVED("승인 전 계정 접근"),
    UNLOCKED("잠금 해제");

    private final String label;
}
