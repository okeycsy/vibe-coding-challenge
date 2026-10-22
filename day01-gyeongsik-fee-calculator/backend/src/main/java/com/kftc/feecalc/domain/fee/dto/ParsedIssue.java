package com.kftc.feecalc.domain.fee.dto;

/** AI 이슈 문장 해석 결과. institutionId 와 count 가 모두 있어야 차감에 반영된다. */
public record ParsedIssue(
        String text,
        String institutionId,
        String institutionName,
        String matchedAlias,
        Long count,
        String date,
        String reason) {

    public boolean applicable() {
        return institutionId != null && count != null && count > 0;
    }
}
