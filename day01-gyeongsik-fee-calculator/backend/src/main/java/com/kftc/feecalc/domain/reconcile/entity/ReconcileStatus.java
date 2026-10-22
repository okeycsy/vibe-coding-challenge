package com.kftc.feecalc.domain.reconcile.entity;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@Getter
@RequiredArgsConstructor
public enum ReconcileStatus {

    WAITING("대기"),
    CHECKING("확인중"),
    DONE("완료");

    private final String label;

    /** 영문 이름 또는 한글 라벨(대기/확인중/완료) */
    public static ReconcileStatus parse(String value) {
        for (ReconcileStatus s : values()) {
            if (s.name().equalsIgnoreCase(value) || s.label.equals(value)) {
                return s;
            }
        }
        throw new BusinessException(ErrorCode.INVALID_INPUT, "알 수 없는 대사 상태입니다: " + value);
    }
}
