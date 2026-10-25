package com.kftc.feecalc.domain.fee.dto;

/**
 * 자동 생성한 수식. 파일은 아직 저장하지 않는다: 담당자가 편집기에서 content 를 확인하고 [저장]해야 반영된다.
 *
 * @param source      AI(모델이 작성) / RULE(키 없음, 규칙 기반) / RULE_FALLBACK(AI 실패·검증 실패로 규칙 기반)
 * @param sampleFee   시험 계산 결과(최종 인정 90만 건, 전체 900만 건, 8개 기관, 한 분기)
 */
public record FormulaSyncResponse(String taskCode, String formula, String previousFormula, String content,
                                  String source, String model, String explanation, String note, long sampleFee) {
}
