package com.kftc.feecalc.domain.reconcile.entity;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@Getter
@RequiredArgsConstructor
public enum TestResultStatus {

    SUCCESS("성공"),
    FAIL("실패"),
    IN_PROGRESS("진행중");

    private final String label;

    public static TestResultStatus parse(String value) {
        for (TestResultStatus s : values()) {
            if (s.name().equalsIgnoreCase(value) || s.label.equals(value)) {
                return s;
            }
        }
        throw new BusinessException(ErrorCode.INVALID_INPUT, "알 수 없는 테스트 결과입니다: " + value);
    }
}
