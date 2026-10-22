package com.kftc.feecalc.domain.user.entity;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@Getter
@RequiredArgsConstructor
public enum TaskRequestStatus {

    PENDING("승인 대기중"),
    APPROVED("승인"),
    REJECTED("반려");

    private final String label;
}
