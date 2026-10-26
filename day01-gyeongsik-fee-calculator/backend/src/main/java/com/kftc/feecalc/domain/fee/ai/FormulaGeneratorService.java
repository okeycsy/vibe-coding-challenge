package com.kftc.feecalc.domain.fee.ai;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;
import com.kftc.feecalc.domain.fee.dto.FormulaGenerateResponse;
import com.kftc.feecalc.domain.fee.service.SkillEngineService;
import com.kftc.feecalc.domain.fee.service.SkillEngineService.Counts;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * "## 1. 비즈니스 규칙 요약" 텍스트로 "## 3. 정산 수식"(SpEL)을 만든다 (POST /api/v1/skills/{taskCode}/generate-formula).
 * AI 키가 있으면 LLM 에 먼저 맡기고, AI 수식도 저장과 같은 검사(구문 + 시험 계산 2벌, {@link SkillEngineService#validateFormula})를
 * 통과해야 쓴다. 키가 없거나 AI 가 실패·검사 탈락하면 {@link RuleBasedFormulaGenerator}(내장 변환기)로 만든다. 파일은 저장하지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FormulaGeneratorService {

    /** 정상 예시: 기본 100만 건, 차감 10만 건, 최종 90만 건, 전체 900만 건, 8개 기관, 한 분기 (저장 검증 1번 값) */
    public static final Counts NORMAL = new Counts(1_000_000, 100_000, 900_000);
    /** 실적 0 예시: 모든 건수 0, 8개 기관, 반 분기 (저장 검증 2번 값) */
    public static final Counts ZERO = new Counts(0, 0, 0);

    public static final String SYSTEM = """
            너는 금융결제원 회비 정산 수식 작성 AI야. [비즈니스 규칙 요약]을 읽고 기관 한 곳의 회비(원)를 계산하는 Spring SpEL 수식 하나를 작성해.
            쓸 수 있는 변수: #finalCount(기관 최종 인정 건수), #totalCount(전체 기관 인정 건수 합계), #institutionCount(참가기관 수), \
            #periodScale(기간 환산 비율, 한 분기 = 1, 분기가 아니면 일수 ÷ 91), #rawCount(기본 건수), #deductedCount(차감 건수).
            쓸 수 있는 문법: 숫자, + - * / %, 괄호, 비교(< > <= >= == !=), and/or/!, 삼항 연산자(조건 ? 값 : 값). \
            메서드 호출, T(...) 타입 참조, new, 빈 참조(@), 문자열은 쓸 수 없어.
            총액을 나누는 수식은 300000000.0 처럼 소수점을 붙여 정수 나눗셈 버림을 막고, #totalCount·#institutionCount 로 나눌 때는 \
            (#totalCount == 0 ? 0 : ...) 처럼 0 나누기를 막아. 결과는 항상 0 이상이어야 해.
            원 미만 처리와 합계 맞춤은 엔진이 하므로 수식에 넣지 마. 특정 기관 10원 절상·실적순 1원 절삭 같은 끝전 처리는 \
            "## 4. 최종 정산 특이사항" 후처리 단계에서 하므로 넣지 마.
            균등 분담과 실적 비례 분담을 합치는 혼합형이면 균등분담분만 계산하는 수식을 equalFormula, 실적분담분만 계산하는 수식을 perfFormula 에 따로 적어 \
            (formula = equalFormula + perfFormula). 혼합형이 아니면 두 값은 null.
            반드시 다음 JSON 객체로만 답해: {"formula":"수식","equalFormula":"균등 수식 또는 null","perfFormula":"실적 수식 또는 null",\
            "pattern":"감지한 산정 유형(예: 균등 30% + 실적비례 70% 혼합분담)","explanation":["규칙 항목 → 변수·수식 매핑 설명", "..."]}""";

    private final LlmClient llm;

    public FormulaGenerateResponse generate(String taskCode, String businessRulesText) {
        String rules = businessRulesText == null ? "" : businessRulesText.replace("\r\n", "\n").strip();
        if (rules.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "'## 1. 비즈니스 규칙 요약'에 규칙을 먼저 적어 주세요.");
        }
        String note = null;
        if (llm.enabled()) {
            try {
                JsonNode res = llm.chatJson(SYSTEM, "[비즈니스 규칙 요약]\n" + rules);
                String formula = res.path("formula").asText("").strip();
                if (formula.isEmpty()) {
                    throw new LlmClient.LlmException("AI 응답에 수식이 없습니다.");
                }
                check(formula);
                String equal = optional(res, "equalFormula");
                String perf = optional(res, "perfFormula");
                if (equal != null && perf != null) {
                    check(equal);
                    check(perf);
                } else {
                    equal = null;
                    perf = null;
                }
                List<String> steps = new ArrayList<>();
                res.path("explanation").forEach(s -> steps.add(s.asText()));
                if (steps.isEmpty() && res.path("explanation").isTextual()) {
                    steps.add(res.path("explanation").asText());
                }
                return response(taskCode, formula, equal, perf, res.path("pattern").asText("AI 해석"), steps, "AI", llm.model(), null);
            } catch (LlmClient.LlmException e) {
                note = "AI 수식 생성 실패로 내장 변환기 사용 (" + e.getMessage() + ")";
            } catch (BusinessException e) {
                note = "AI 가 만든 수식이 구문 검사·시험 계산을 통과하지 못해 내장 변환기 사용 (" + e.getMessage() + ")";
            }
            log.warn(note);
        }
        Optional<RuleBasedFormulaGenerator.Generated> rule = RuleBasedFormulaGenerator.generate(rules);
        if (rule.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, (note == null ? "" : note + ". 내장 변환기도 ")
                    + "규칙에서 알아듣는 표현(총액 N원·N% 균등·N% 실적, 기본료 N원 + 건당 N원, N건까지 건당 N원 구간, "
                    + "건당 단가 N원·최저/최고 회비, 총액 N원 실적 비율)을 찾지 못했습니다. 수식을 직접 작성해 주세요.");
        }
        RuleBasedFormulaGenerator.Generated g = rule.get();
        return response(taskCode, g.formula(), g.equalFormula(), g.perfFormula(), g.pattern(), g.steps(),
                note == null ? "RULE" : "RULE_FALLBACK", null, note);
    }

    /** 저장 검증과 같은 검사를 다시 돌려 결과를 응답에 담는다 */
    private static String optional(JsonNode res, String field) {
        JsonNode v = res.path(field);
        return v.isTextual() && !v.asText().isBlank() ? v.asText().strip() : null;
    }

    private static FormulaGenerateResponse response(String taskCode, String formula, String equalFormula, String perfFormula,
                                                    String pattern, List<String> steps, String source, String model, String note) {
        boolean passed = true;
        String message = "섹션·구문 검사와 시험 계산 2벌(정상·실적 0)을 통과했습니다.";
        Long normal = null;
        Long zero = null;
        try {
            check(formula);
            normal = sample(formula, NORMAL, 9_000_000, 1.0);
            zero = sample(formula, ZERO, 0, 0.5);
        } catch (BusinessException e) {
            passed = false;
            message = e.getMessage();
        }
        return new FormulaGenerateResponse(taskCode, formula, equalFormula, perfFormula, pattern, steps, passed, message, normal, zero, source,
                model, note);
    }

    private static void check(String formula) {
        if (formula.length() > SkillEngineService.MAX_FORMULA_LENGTH) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "수식이 " + SkillEngineService.MAX_FORMULA_LENGTH + "자를 넘습니다.");
        }
        SkillEngineService.validateFormula(formula);
    }

    private static long sample(String formula, Counts c, long total, double scale) {
        BigDecimal v = SkillEngineService.evaluate(formula, c, total, 8, scale);
        return v.setScale(0, RoundingMode.HALF_UP).longValueExact();
    }
}
