package com.kftc.feecalc.domain.fee.dto;

import java.util.List;

import jakarta.validation.constraints.NotBlank;

/**
 * 기관 추가·수정 요청. id(내부 ID)는 추가할 때만 쓰며 비우면 기관코드를 소문자로 만든다.
 * type: BANK | SECURITIES | INSURANCE | OTHER (비우면 기관명으로 짐작)
 */
public record InstitutionSaveRequest(
        String id,
        @NotBlank(message = "기관명을 입력해 주세요.") String name,
        @NotBlank(message = "기관코드를 입력해 주세요.") String code,
        String type,
        List<String> aliases) {
}
