package com.kftc.feecalc.domain.fee.dto;

import java.time.LocalDateTime;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.kftc.feecalc.domain.fee.service.SkillEngineService;
import com.kftc.feecalc.domain.fee.service.SkillEngineService.ParsedSkill;
import com.kftc.feecalc.domain.fee.service.SkillFileService.SkillFileMeta;

/** 업무 skill.md 전문과 섹션별 해석 결과 */
public record SkillDetailResponse(
        String taskCode,
        String taskName,
        String businessId,
        /** skill.md 전문 */
        String content,
        /** ## 3. 정산 수식 (SpEL). 분리형이면 "(균등) + (실적)" 표시용 */
        String formula,
        /** 분리형(formula:equal / formula:perf)일 때 균등·실적 수식, 아니면 null */
        String equalFormula,
        String perfFormula,
        /** ## 3. 의 ```variables 변수 정의 블록 원문 (없으면 "") */
        String variables,
        /** 변수 정의 목록 (엔진이 보충한 rawCount 포함). 블록이 없는 예전 문서는 rawCount 입력 하나 */
        List<VariableInfo> variableList,
        /** 실적 엑셀 열을 연결해야 하는 입력 변수 (정의 순서) */
        List<VariableInfo> inputs,
        /** ## 1. 비즈니스 규칙 요약 (줄 단위) */
        List<String> summary,
        /** ## 2. AI 예외 차감 지침 */
        String aiGuide,
        /** ## 4. 최종 정산 특이사항 (줄 단위, 없으면 빈 목록) */
        List<String> specialRules,
        /** ## 4. 최종 정산 특이사항 자연어 원문 (postprocess 블록 제외) */
        String specialRulesRaw,
        /** ## 4. 의 ```postprocess 후처리 스크립트 (없으면 "") */
        String postprocess,
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
        /** 섹션·수식이 없어 아직 산출에 쓸 수 없으면 그 이유 (예: 막 추가한 업무, 수식 미작성 초안), 쓸 수 있으면 null */
        String parseError) {

    public static SkillDetailResponse of(String taskName, String fileName, String content, ParsedSkill p,
                                         SkillFileMeta m) {
        return new SkillDetailResponse(p.taskCode(), taskName, p.businessId(), content, p.formula(), p.equalFormula(), p.perfFormula(),
                p.variables().text(), VariableInfo.list(p.variables()), VariableInfo.inputs(p.variables()), p.summary(),
                p.aiGuide(), p.specialRules(), p.specialRulesRaw(), p.postprocess(), p.calcType(), p.rateUnit(), m.lastModified(), m.size(), m.version(), m.modified(),
                m.updatedBy(), fileName, p.hasFormula() ? null : SkillEngineService.FORMULA_MISSING);
    }

    /** 아직 작성 중인 skill.md: 원문만 주고 섹션은 비운다 */
    public static SkillDetailResponse incomplete(String taskCode, String businessId, String taskName, String fileName,
                                                 String content, String parseError, SkillFileMeta m) {
        return new SkillDetailResponse(taskCode, taskName, businessId, content, "", null, null, "", List.of(), List.of(), List.of(), "", List.of(), "", "", "", "",
                m.lastModified(), m.size(), m.version(), m.modified(), m.updatedBy(), fileName, parseError);
    }
}
