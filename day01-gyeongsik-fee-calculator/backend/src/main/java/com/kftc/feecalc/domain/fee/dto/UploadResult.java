package com.kftc.feecalc.domain.fee.dto;

import java.util.List;

/**
 * 실적 엑셀 업로드 결과.
 * counts 를 그대로 산출 요청(CalculationRequest.counts)에 넣으면 업로드 실적으로 산출한다.
 * counts 는 columns 중 use = true 인 수치 열을 더한 값이고, 화면에서 열을 바꾸면 values 로 다시 더한다.
 */
public record UploadResult(
        String fileName,
        /** 산출 기간 안에서 읽어 기관에 반영한 행 수 */
        int rowCount,
        long totalCount,
        List<InstitutionCount> counts,
        /** 기관을 찾지 못한 기관 값 (중복 없이) */
        List<String> unmatched,
        Layout layout,
        List<Column> columns,
        /** 기관별 수치 열 합계 (columns 순서) */
        List<InstitutionValues> values,
        /** 산출 기간 밖이라 뺀 날짜별 행 수·합계 */
        List<Excluded> excluded,
        /** 날짜를 읽지 못해 뺀 행 수와 원문 예시 */
        int unreadableRows,
        List<String> unreadableSamples,
        /** 산출 기간 안이라 반영한 날짜 */
        List<String> includedDates,
        Analysis analysis) {

    /** 읽은 위치. headerRow 는 엑셀 행 번호(1부터). dateSource = COLUMN · HEADER · TITLE, dateUnit = DAY · MONTH · QUARTER · MIXED */
    public record Layout(String sheetName, int headerRow, String institutionHeader, String dateSource, String dateHeader,
                         String dateUnit) {
    }

    /** 수치 열. kind = COUNT · AMOUNT · NUMBER, use = 실적(기본 건수)에 넣는지 기본값 */
    public record Column(int index, String header, String kind, boolean use) {
    }

    public record InstitutionValues(String institutionId, String name, List<Long> values) {
    }

    public record Excluded(String date, int rows, List<Long> values) {
    }

    /** 판별 방식: AI · RULE(키 없음) · RULE_FALLBACK(AI 실패·검증 탈락), note = 실패 원인 */
    public record Analysis(String mode, String model, String note, String reason) {
    }
}
