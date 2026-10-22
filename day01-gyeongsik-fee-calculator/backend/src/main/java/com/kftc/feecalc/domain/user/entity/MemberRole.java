package com.kftc.feecalc.domain.user.entity;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/** 프론트엔드 ROLES 와 같은 3종. code 는 프론트의 role 값과 같다. */
@Getter
@RequiredArgsConstructor
public enum MemberRole {

    OPERATOR("operator", "사용자", "kftc", "calc"),
    SYSADMIN("sysadmin", "관리자", "kftc", "admin"),
    INSTITUTION("institution", "참가기관", "institution", "calc");

    private final String code;
    private final String label;
    /** kftc(금융결제원) | institution(참가기관) */
    private final String side;
    /** 로그인 후 첫 화면 */
    private final String home;
}
