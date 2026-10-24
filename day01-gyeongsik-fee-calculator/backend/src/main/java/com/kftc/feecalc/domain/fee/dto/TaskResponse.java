package com.kftc.feecalc.domain.fee.dto;

import java.time.LocalDateTime;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.kftc.feecalc.domain.fee.service.SkillFileService.SkillFileMeta;
import com.kftc.feecalc.domain.fee.service.SkillFileService.TaskEntry;

/** 업무 관리 목록 행: 업무와 연결된 md 파일 1개의 상태 */
public record TaskResponse(
        String taskCode,
        String businessId,
        String name,
        String fileName,
        /** 기본 제공 업무(초기 기준이 서버에 들어 있음)면 true, 관리자가 추가한 업무면 false */
        boolean builtIn,
        @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss") LocalDateTime createdAt,
        String createdBy,
        @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss") LocalDateTime lastModified,
        long size,
        /** 요약·수식 섹션이 있어 산출에 쓸 수 있으면 true */
        boolean ready,
        /** 이 업무 권한을 가진 일반담당자 수 */
        long memberCount) {

    public static TaskResponse of(TaskEntry t, SkillFileMeta m, boolean ready, long memberCount) {
        return new TaskResponse(t.taskCode(), t.businessId(), t.name(), t.fileName(), t.builtIn(), t.createdAt(),
                t.createdBy(), m.lastModified(), m.size(), ready, memberCount);
    }
}
