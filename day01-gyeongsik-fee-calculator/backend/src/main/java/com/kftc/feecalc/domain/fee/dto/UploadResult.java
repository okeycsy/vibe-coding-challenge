package com.kftc.feecalc.domain.fee.dto;

import java.util.List;

/**
 * 실적 엑셀 업로드 결과.
 * counts 를 그대로 산출 요청(CalculationRequest.counts)에 넣으면 업로드 실적으로 산출한다.
 */
public record UploadResult(
        String fileName,
        int rowCount,
        long totalCount,
        List<InstitutionCount> counts,
        /** 기관을 찾지 못한 행의 기관 값 */
        List<String> unmatched) {
}
