package com.kftc.feecalc.domain.fee.upload;

import java.util.List;

/**
 * 업로드 엑셀을 어떻게 읽을지(AI 또는 규칙 기반이 판별). 열·행 번호는 0부터.
 * 날짜는 세 가지 중 하나에서 읽는다:
 * <ul>
 *   <li>COLUMN: 날짜 열(dateColumn)의 각 행 값 (기준월·일자 등)</li>
 *   <li>HEADER: 머리글 칸 자체가 날짜인 가로형 표 (기관명 | 2026-07 | 2026-08 …), 값 열은 dateHeaderColumns</li>
 *   <li>TITLE: 표 위 제목 문장의 날짜 (예: "2026년 3분기 실적"), 모든 행에 같은 날짜</li>
 * </ul>
 */
public record UploadLayout(
        int sheet,
        int headerRow,
        int institutionColumn,
        /** 기관코드 열(없으면 -1). 기관명으로 못 찾으면 코드로 다시 찾는다 */
        int codeColumn,
        DateSource dateSource,
        int dateColumn,
        List<Integer> dateHeaderColumns,
        String titleText,
        List<ValueColumn> valueColumns) {

    public enum DateSource {
        COLUMN, HEADER, TITLE
    }

    /**
     * 수치 열. kind = COUNT(건수) · AMOUNT(금액) · NUMBER(그 밖의 수치), variable = 이 열을 더해 넣을 skill.md 실적 입력 변수
     * (없으면 null), use = 어떤 변수에든 연결됐는지(variable != null, 예전 응답과의 호환용)
     */
    public record ValueColumn(int index, String header, String kind, boolean use, String variable) {

        public ValueColumn(int index, String header, String kind, boolean use) {
            this(index, header, kind, use, use ? SkillInput.DEFAULT_NAME : null);
        }

        public ValueColumn withVariable(String variable) {
            return new ValueColumn(index, header, kind, variable != null, variable);
        }
    }

    /** 실적 입력 변수 (skill.md ```variables 의 input). 블록이 없는 예전 문서는 rawCount "기본 건수" 하나 */
    public record SkillInput(String name, String label) {

        public static final String DEFAULT_NAME = "rawCount";
        public static final List<SkillInput> DEFAULT = List.of(new SkillInput(DEFAULT_NAME, "기본 건수"));
    }

    public UploadLayout withValueColumns(List<ValueColumn> columns) {
        return new UploadLayout(sheet, headerRow, institutionColumn, codeColumn, dateSource, dateColumn, dateHeaderColumns, titleText, columns);
    }
}
