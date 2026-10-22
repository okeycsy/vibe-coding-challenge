package com.kftc.feecalc.domain.user.entity;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@Getter
@RequiredArgsConstructor
public enum MemberStatus {

    ACTIVE("정상"),
    PENDING("승인대기"),
    REJECTED("반려");

    private final String label;
}
