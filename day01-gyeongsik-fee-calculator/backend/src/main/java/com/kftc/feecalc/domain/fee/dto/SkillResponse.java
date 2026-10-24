package com.kftc.feecalc.domain.fee.dto;

import java.time.LocalDateTime;
import java.util.List;

import com.kftc.feecalc.domain.fee.service.SkillEngineService.ParsedSkill;
import com.kftc.feecalc.domain.fee.service.SkillEngineService.StoredSkill;

/** 업무별 skill.md 원문과 섹션별 추출 결과 */
public record SkillResponse(
        String taskCode,
        String businessId,
        String title,
        /** 산정 유형 (예: 구간별 차등 단가) */
        String calcType,
        /** 결과 표의 단가/분담률 표시 단위 (원/건 또는 %) */
        String rateUnit,
        /** ## 1. 비즈니스 규칙 요약 (줄 단위) */
        List<String> summary,
        String summaryText,
        /** ## 2. AI 예외 차감 지침 */
        String aiGuide,
        /** ## 3. 정산 수식 (SpEL) */
        String formula,
        /** skill.md 원문 */
        String markdown,
        /** 원본(classpath)과 다르면 true */
        boolean modified,
        String updatedBy,
        LocalDateTime updatedAt) {

    public static SkillResponse of(ParsedSkill p, StoredSkill stored, boolean modified) {
        return new SkillResponse(p.taskCode(), p.businessId(), p.title(), p.calcType(), p.rateUnit(), p.summary(),
                p.summaryText(), p.aiGuide(), p.formula(), stored.markdown(), modified, stored.updatedBy(),
                stored.updatedAt());
    }
}
