package com.kftc.feecalc.domain.user.dto;

import java.time.LocalDateTime;

import com.kftc.feecalc.domain.user.entity.TaskRequest;

public record TaskRequestResponse(
        Long id,
        String memberId,
        String memberName,
        String taskId,
        String reason,
        String status,
        LocalDateTime requestedAt,
        LocalDateTime decidedAt) {

    public static TaskRequestResponse from(TaskRequest r) {
        return new TaskRequestResponse(r.getId(), r.getMember().getLoginId(), r.getMember().getName(),
                r.getBusinessCode(), r.getReason(), r.getStatus().getLabel(), r.getRequestedAt(), r.getDecidedAt());
    }
}
