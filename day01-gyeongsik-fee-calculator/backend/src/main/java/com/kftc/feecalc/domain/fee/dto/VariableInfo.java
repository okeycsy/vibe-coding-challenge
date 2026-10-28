package com.kftc.feecalc.domain.fee.dto;

import java.util.List;

import com.kftc.feecalc.domain.fee.service.SkillVariables;
import com.kftc.feecalc.domain.fee.service.SkillVariables.Definition;

/**
 * ```variables 블록의 변수 한 개 (화면 표시용).
 *
 * @param kind           INPUT(실적 엑셀 열을 연결하는 입력) · SUM(전체 기관 합계) · NUMBER(상수) · EXPR(파생 수식)
 * @param label          INPUT 의 설명 (엑셀 열과 맞출 때 쓴다), 그 밖에는 null
 * @param expr           SUM 은 대상 변수명, NUMBER 는 숫자, EXPR 은 SpEL, INPUT 은 null
 * @param perInstitution 기관마다 값이 다른지
 * @param auto           블록에 없어 엔진이 보충한 정의인지 (입력이 하나일 때의 rawCount 등)
 */
public record VariableInfo(String name, String kind, String label, String expr, boolean perInstitution, boolean auto) {

    public static VariableInfo from(Definition d) {
        return new VariableInfo(d.name(), d.kind().name(), d.label(), d.expr(), d.perInstitution(), d.line() == 0);
    }

    public static List<VariableInfo> list(SkillVariables vars) {
        return vars.definitions().stream().map(VariableInfo::from).toList();
    }

    /** 실적 엑셀 열을 연결해야 하는 입력 변수만 */
    public static List<VariableInfo> inputs(SkillVariables vars) {
        return vars.inputs().stream().map(VariableInfo::from).toList();
    }
}
