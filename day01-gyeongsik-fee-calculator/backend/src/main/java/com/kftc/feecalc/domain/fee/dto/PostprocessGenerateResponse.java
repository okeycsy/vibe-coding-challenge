package com.kftc.feecalc.domain.fee.dto;

import java.util.List;

import com.kftc.feecalc.domain.fee.service.PostprocessEngine;

/**
 * 자동 생성한 후처리 스크립트. 파일은 저장하지 않는다: [AI 계산식 빌더]에서 시뮬레이션 후 [확정 반영]해야 skill.md 에 들어간다.
 *
 * @param generatedScript  생성한 스크립트 (한 줄 = 한 단계)
 * @param explanation      4번 문장이 어떤 단계로 바뀌었는지 설명
 * @param unsupported      스크립트로 바꾸지 못한 문장 (손으로 보완)
 * @param validationPassed 문법 검사 + 시험 실행 2벌(정상·실적 0) 통과 여부
 * @param sample           시험 실행(기관 7곳) 결과
 * @param checks           시험 실행에서 assert 결과
 * @param source           AI(모델이 작성) / RULE(키 없음, 내장 변환기) / RULE_FALLBACK(AI 실패·검증 실패로 내장 변환기)
 */
public record PostprocessGenerateResponse(String taskCode, String generatedScript, List<String> explanation,
                                          List<String> unsupported, boolean validationPassed, String validationMessage,
                                          List<SampleItem> sample, List<CalculationResponse.Check> checks, List<String> notes,
                                          String source, String model, String note) {

    public record SampleItem(String name, long finalCount, long equalFee, long perfFee, long fee, long beforeSpecialFee,
                             String reason) {

        public static SampleItem of(PostprocessEngine.Line l, PostprocessEngine.ItemResult r) {
            return new SampleItem(l.name(), l.finalCount(), r.equalFee(), r.perfFee(), r.fee(), r.beforeSpecialFee(), r.reason());
        }
    }
}
