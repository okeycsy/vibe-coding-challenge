package com.kftc.feecalc.domain.fee.dto;

import java.util.List;

/**
 * AI 가 1번 규칙으로 만든 변수 정의와 수식. 파일은 저장하지 않는다: [AI 계산식 빌더]에서 확인·시뮬레이션 후 [확정 반영]해야 skill.md 에 들어간다.
 *
 * @param variables          ```variables 블록에 넣을 변수 정의 텍스트 (AI 가 정의하지 않았으면 "")
 * @param variableList       해석한 변수 목록 (엔진이 보충한 rawCount 포함)
 * @param inputs             실적 엑셀 열을 연결해야 하는 입력 변수
 * @param generatedFormula   생성한 SpEL 수식 (총액)
 * @param equalFormula       균등+실적 혼합형이면 균등분담분 분리 수식(formula:equal), 아니면 null
 * @param perfFormula        혼합형이면 실적분담분 분리 수식(formula:perf), 아니면 null
 * @param detectedPattern    AI 가 규칙에서 읽어 낸 산정 방식 (한 줄)
 * @param explanation        1번 규칙의 항목이 어떤 변수·수식으로 매핑됐는지 단계별 설명
 * @param validationPassed   저장 검증(변수 정의 + 구문 + 기관 8곳 시험 계산 2벌) 통과 여부 (응답이 왔으면 늘 true, 실패는 400)
 * @param sampleResultNormal 정상 예시(기관 8곳, 첫 기관 최종 90만 건 / 전체 900만 건 / 한 분기) 첫 기관 결과(원)
 * @param sampleResultZero   실적 0 예시(모든 건수 0 / 8개 기관 / 반 분기) 첫 기관 결과(원)
 * @param source             AI (패턴 변환기는 없다)
 * @param attempts           AI 에 물은 횟수 (1 또는 2: 1차 답변이 검증에 떨어져 오류를 알려 주고 다시 받음)
 */
public record FormulaGenerateResponse(String taskCode, String variables, List<VariableInfo> variableList, List<VariableInfo> inputs,
                                      String generatedFormula, String equalFormula, String perfFormula, String detectedPattern,
                                      List<String> explanation, boolean validationPassed, String validationMessage,
                                      Long sampleResultNormal, Long sampleResultZero, String source, String model,
                                      String note, int attempts) {
}
