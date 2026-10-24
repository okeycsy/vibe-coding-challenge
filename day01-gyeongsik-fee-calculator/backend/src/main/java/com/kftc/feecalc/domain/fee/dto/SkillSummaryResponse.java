package com.kftc.feecalc.domain.fee.dto;

import java.time.LocalDateTime;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.kftc.feecalc.domain.fee.service.SkillFileService.SkillFileMeta;

/** 업무 목록 행: 접근 가능 여부와 파일 상태. 내용은 권한이 있을 때 상세 API로만 준다 */
public record SkillSummaryResponse(
        String taskCode,
        String taskName,
        String businessId,
        boolean accessible,
        @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss") LocalDateTime lastModified,
        long size,
        String version,
        boolean modified) {

    public static SkillSummaryResponse of(String taskName, String businessId, boolean accessible, SkillFileMeta m) {
        return new SkillSummaryResponse(m.taskCode(), taskName, businessId, accessible, m.lastModified(), m.size(),
                m.version(), m.modified());
    }
}
