package com.kftc.feecalc.domain.fee.dto;

import java.time.LocalDateTime;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.kftc.feecalc.domain.fee.service.SkillEngineService.ParsedSkill;
import com.kftc.feecalc.domain.fee.service.SkillFileService.SkillFileMeta;

/** 업무 skill.md 전문과 섹션별 해석 결과 */
public record SkillDetailResponse(
        String taskCode,
        String taskName,
        String businessId,
        /** skill.md 전문 */
        String content,
        /** ## 3. 정산 수식 (SpEL) */
        String formula,
        /** ## 1. 비즈니스 규칙 요약 (줄 단위) */
        List<String> summary,
        /** ## 2. AI 예외 차감 지침 */
        String aiGuide,
        /** 산정 유형 (예: 구간별 차등 단가) */
        String calcType,
        /** 결과 표의 단가/분담률 표시 단위 (원/건 또는 %) */
        String rateUnit,
        @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss") LocalDateTime lastModified,
        long size,
        String version,
        /** 초기 기준과 다르면 true */
        boolean modified,
        String updatedBy,
        /** 연결된 md 파일명 */
        String fileName,
        /** 섹션·수식이 없어 아직 산출에 쓸 수 없으면 그 이유 (예: 막 추가한 업무), 쓸 수 있으면 null */
        String parseError) {

    public static SkillDetailResponse of(String taskName, String fileName, String content, ParsedSkill p,
                                         SkillFileMeta m) {
        return new SkillDetailResponse(p.taskCode(), taskName, p.businessId(), content, p.formula(), p.summary(),
                p.aiGuide(), p.calcType(), p.rateUnit(), m.lastModified(), m.size(), m.version(), m.modified(),
                m.updatedBy(), fileName, null);
    }

    /** 아직 작성 중인 skill.md: 원문만 주고 섹션은 비운다 */
    public static SkillDetailResponse incomplete(String taskCode, String businessId, String taskName, String fileName,
                                                 String content, String parseError, SkillFileMeta m) {
        return new SkillDetailResponse(taskCode, taskName, businessId, content, "", List.of(), "", "", "",
                m.lastModified(), m.size(), m.version(), m.modified(), m.updatedBy(), fileName, parseError);
    }
}
