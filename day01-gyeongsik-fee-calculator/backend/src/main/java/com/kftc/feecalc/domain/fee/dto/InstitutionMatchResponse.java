package com.kftc.feecalc.domain.fee.dto;

/**
 * 매칭 시험 결과: 엑셀 기관 칸 값(excel)과 AI 이슈 문장(issue) 규칙으로 각각 어느 기관이 잡히는지.
 * 찾지 못하면 id 가 null.
 */
public record InstitutionMatchResponse(String value, Match excel, Match issue) {

    public record Match(String id, String name, String code, String matchedBy) {
    }
}
