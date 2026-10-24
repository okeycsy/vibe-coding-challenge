package com.kftc.feecalc.common.exception;

import org.springframework.http.HttpStatus;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@Getter
@RequiredArgsConstructor
public enum ErrorCode {

    INVALID_INPUT(HttpStatus.BAD_REQUEST, "입력값이 올바르지 않습니다."),
    INVALID_PERIOD(HttpStatus.BAD_REQUEST, "산출 기간이 올바르지 않습니다."),
    INVALID_EXCEL(HttpStatus.BAD_REQUEST, "엑셀 파일을 읽을 수 없습니다."),

    LOGIN_FAILED(HttpStatus.UNAUTHORIZED, "아이디 또는 비밀번호가 올바르지 않습니다."),
    ACCOUNT_LOCKED(HttpStatus.LOCKED, "비밀번호 5회 오류로 잠긴 계정입니다. 관리자에게 잠금 해제를 요청해 주세요."),
    ACCOUNT_PENDING(HttpStatus.FORBIDDEN, "가입 승인 대기 중인 계정입니다."),
    ACCOUNT_REJECTED(HttpStatus.FORBIDDEN, "가입이 반려된 계정입니다."),
    NO_TASK_PERMISSION(HttpStatus.FORBIDDEN, "해당 업무의 산출 권한이 없습니다."),
    ADMIN_ONLY(HttpStatus.FORBIDDEN, "시스템관리자만 회비 기준(skill.md)을 수정할 수 있습니다."),

    MEMBER_NOT_FOUND(HttpStatus.NOT_FOUND, "회원을 찾을 수 없습니다."),
    BUSINESS_NOT_FOUND(HttpStatus.NOT_FOUND, "업무를 찾을 수 없습니다."),
    CALCULATION_NOT_FOUND(HttpStatus.NOT_FOUND, "산출 내역을 찾을 수 없습니다."),
    TASK_REQUEST_NOT_FOUND(HttpStatus.NOT_FOUND, "업무 권한 신청을 찾을 수 없습니다."),
    RECONCILE_NOT_FOUND(HttpStatus.NOT_FOUND, "대사 내역을 찾을 수 없습니다."),
    TEST_RESULT_NOT_FOUND(HttpStatus.NOT_FOUND, "테스트 결과를 찾을 수 없습니다."),

    DUPLICATE_TASK_REQUEST(HttpStatus.CONFLICT, "이미 승인 대기 중인 신청이 있습니다."),
    ALREADY_GRANTED(HttpStatus.CONFLICT, "이미 보유한 업무 권한입니다."),
    INVALID_STATE(HttpStatus.CONFLICT, "현재 상태에서는 처리할 수 없습니다."),

    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "서버 오류가 발생했습니다.");

    private final HttpStatus status;
    private final String message;
}
