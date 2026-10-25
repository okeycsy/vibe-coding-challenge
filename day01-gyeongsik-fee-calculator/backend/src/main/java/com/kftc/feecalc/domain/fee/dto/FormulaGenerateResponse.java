package com.kftc.feecalc.domain.fee.dto;

import java.util.List;

/**
 * 자동 생성한 수식. 파일은 저장하지 않는다: [AI 계산식 빌더]에서 확인·시뮬레이션 후 [확정 반영]해야 skill.md 에 들어간다.
 *
 * @param generatedFormula   생성한 SpEL 수식 (총액)
 * @param equalFormula       균등+실적 혼합형이면 균등분담분 분리 수식(formula:equal), 아니면 null
 * @param perfFormula        혼합형이면 실적분담분 분리 수식(formula:perf), 아니면 null
 * @param detectedPattern    감지한 산정 유형 (예: 균등 30% + 실적비례 70% 혼합분담)
 * @param explanation        1번 규칙의 항목이 어떤 변수·수식으로 매핑됐는지 단계별 설명
 * @param validationPassed   저장 검증(구문 + 시험 계산 2벌) 통과 여부
 * @param sampleResultNormal 정상 예시(최종 90만 건 / 전체 900만 건 / 8개 기관 / 한 분기) 결과(원)
 * @param sampleResultZero   실적 0 예시(모든 건수 0 / 8개 기관 / 반 분기) 결과(원)
 * @param source             AI(모델이 작성) / RULE(키 없음, 내장 변환기) / RULE_FALLBACK(AI 실패·검증 실패로 내장 변환기)
 */
public record FormulaGenerateResponse(String taskCode, String generatedFormula, String equalFormula, String perfFormula,
                                      String detectedPattern,
                                      List<String> explanation, boolean validationPassed, String validationMessage,
                                      Long sampleResultNormal, Long sampleResultZero, String source, String model,
                                      String note) {
}
