package com.kftc.feecalc.domain.fee.dto;

import jakarta.validation.constraints.NotBlank;

/** 업무 추가 요청. fileName 은 확장자(.md) 생략 가능, 비우면 {업무 코드}.md */
public record TaskCreateRequest(
        @NotBlank(message = "업무 코드를 입력해 주세요.") String taskCode,
        @NotBlank(message = "업무명을 입력해 주세요.") String name,
        String fileName) {
}
