package com.kftc.feecalc.domain.fee.entity;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/** 기관 구분 (기관 관리 화면의 필터) */
@Getter
@RequiredArgsConstructor
public enum InstitutionType {

    BANK("은행"),
    SECURITIES("증권"),
    INSURANCE("보험"),
    OTHER("기타");

    private final String label;

    /** 기관명으로 구분을 짐작한다 (시드 데이터용) */
    public static InstitutionType guess(String name) {
        if (name.endsWith("증권")) {
            return SECURITIES;
        }
        if (name.endsWith("보험")) {
            return INSURANCE;
        }
        return name.endsWith("은행") || name.endsWith("뱅크") ? BANK : OTHER;
    }
}
