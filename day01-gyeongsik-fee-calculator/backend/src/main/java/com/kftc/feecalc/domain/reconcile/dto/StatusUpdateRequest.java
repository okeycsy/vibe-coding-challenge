package com.kftc.feecalc.domain.reconcile.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** status: 대사는 대기/확인중/완료(또는 WAITING/CHECKING/DONE), 테스트는 성공/실패/진행중 */
public record StatusUpdateRequest(
        @NotBlank(message = "상태를 입력해 주세요.") String status,
        @Size(max = 1000) String comment) {
}
