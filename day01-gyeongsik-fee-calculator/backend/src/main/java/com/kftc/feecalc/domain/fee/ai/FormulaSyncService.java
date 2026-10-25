package com.kftc.feecalc.domain.fee.ai;

import java.math.RoundingMode;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;
import com.kftc.feecalc.domain.fee.dto.FormulaSyncResponse;
import com.kftc.feecalc.domain.fee.service.SkillEngineService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * "## 1. 비즈니스 규칙 요약"을 읽어 "## 3. 정산 수식"의 ```formula 블록을 새로 쓴다 (POST /api/v1/skills/sync-formula).
 * AI 가 쓴 수식도 저장과 같은 검사(SpEL 구문 + 예시 값 시험 계산, {@link SkillEngineService#validateFormula})를 통과해야 돌려준다.
 * 통과하지 못하거나 AI 키가 없으면 {@link RuleBasedFormulaGenerator}로 만든다. 파일 저장은 하지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FormulaSyncService {

    static final Pattern SUMMARY = Pattern.compile("(?ms)^##\\s*1\\.\\s*비즈니스 규칙 요약[ \\t]*\\R(.*?)(?=^##\\s|\\z)");
    static final Pattern FORMULA_BLOCK = Pattern.compile("(?s)(```formula[ \\t]*\\R)(.*?)(```)");
    static final Pattern SECTION3 = Pattern.compile("(?m)^##\\s*3\\.[^\\n]*$");

    public static final String SYSTEM = """
            너는 금융결제원 회비 정산 수식 작성 AI야. [비즈니스 규칙 요약]을 읽고 기관 한 곳의 회비(원)를 계산하는 Spring SpEL 수식 하나를 작성해.
            쓸 수 있는 변수: #finalCount(기관 최종 인정 건수), #totalCount(전체 기관 인정 건수 합계), #institutionCount(참가기관 수), \
            #periodScale(기간 환산 비율, 한 분기 = 1, 분기가 아니면 일수 ÷ 91), #rawCount(기본 건수), #deductedCount(차감 건수).
            쓸 수 있는 문법: 숫자, + - * / %, 괄호, 비교(< > <= >= == !=), and/or/!, 삼항 연산자(조건 ? 값 : 값). \
            메서드 호출, T(...) 타입 참조, new, 빈 참조(@), 문자열은 쓸 수 없어.
            총액을 나누는 수식은 300000000.0 처럼 소수점을 붙여 정수 나눗셈 버림을 막고, #totalCount == 0 이면 0 이 되게 해. 결과는 항상 0 이상이어야 해.
            원 미만 처리와 합계 맞춤은 엔진이 하므로 수식에 넣지 마. 특정 기관만의 절상·절삭 같은 단수 처리는 수식이 아니라 최종 보정 단계에서 하므로 넣지 마.
            반드시 다음 JSON 객체로만 답해: {"formula":"수식","explanation":"한국어 한 문장 설명"}""";

    private final LlmClient llm;

    public FormulaSyncResponse sync(String taskCode, String content) {
        String md = content.replace("\r\n", "\n");
        Matcher sm = SUMMARY.matcher(md);
        String summary = sm.find() ? sm.group(1).strip() : "";
        if (summary.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "'## 1. 비즈니스 규칙 요약' 섹션에 규칙을 먼저 적어 주세요.");
        }
        Matcher fm = FORMULA_BLOCK.matcher(md);
        String previous = fm.find() ? fm.group(2).strip() : "";

        String note = null;
        if (llm.enabled()) {
            try {
                JsonNode res = llm.chatJson(SYSTEM, "[비즈니스 규칙 요약]\n" + summary
                        + (previous.isEmpty() ? "" : "\n\n[지금 수식] (형식 참고용, 규칙과 다르면 규칙을 따른다)\n" + previous));
                String formula = res.path("formula").asText("").strip();
                if (formula.isEmpty()) {
                    throw new LlmClient.LlmException("AI 응답에 수식이 없습니다.");
                }
                long sample = check(formula);
                return new FormulaSyncResponse(taskCode, formula, previous, replaceFormula(md, formula), "AI", llm.model(),
                        res.path("explanation").asText(""), null, sample);
            } catch (LlmClient.LlmException e) {
                note = "AI 수식 생성 실패로 규칙 기반 생성 (" + e.getMessage() + ")";
            } catch (BusinessException e) {
                note = "AI 가 만든 수식이 구문 검사·시험 계산을 통과하지 못해 규칙 기반 생성 (" + e.getMessage() + ")";
            }
            log.warn(note);
        }
        Optional<RuleBasedFormulaGenerator.Generated> rule = RuleBasedFormulaGenerator.generate(summary);
        if (rule.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, (note == null ? "AI 키(AI_API_KEY)가 설정되지 않아 " : note + ". ")
                    + "규칙 기반 생성기가 알아듣는 표현(총액 N원·N% 균등, 기본료 N원 + 건당 N원, N건까지 건당 N원 구간, "
                    + "건당 단가 N원·최저/최고 회비)이 요약에 없습니다. 수식을 직접 작성해 주세요.");
        }
        String formula = rule.get().formula();
        long sample = check(formula);
        return new FormulaSyncResponse(taskCode, formula, previous, replaceFormula(md, formula),
                note == null ? "RULE" : "RULE_FALLBACK", null, "규칙 기반 생성: " + rule.get().explanation(), note, sample);
    }

    /** 저장 때와 같은 검사 + 시험 계산 1건 */
    private static long check(String formula) {
        if (formula.length() > SkillEngineService.MAX_FORMULA_LENGTH) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "수식이 " + SkillEngineService.MAX_FORMULA_LENGTH + "자를 넘습니다.");
        }
        SkillEngineService.validateFormula(formula);
        return SkillEngineService.evaluate(formula, new SkillEngineService.Counts(1_000_000, 100_000, 900_000),
                9_000_000, 8, 1.0).setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    /** ```formula 블록 안만 바꾼다. 블록이 없으면 "## 3." 제목 아래(없으면 끝)에 만든다 */
    static String replaceFormula(String md, String formula) {
        Matcher fm = FORMULA_BLOCK.matcher(md);
        if (fm.find()) {
            return md.substring(0, fm.start(2)) + formula + "\n" + md.substring(fm.start(3));
        }
        String block = "```formula\n" + formula + "\n```\n";
        Matcher s3 = SECTION3.matcher(md);
        if (s3.find()) {
            return md.substring(0, s3.end()) + "\n\n" + block + md.substring(s3.end()).replaceFirst("^\\n+", "\n");
        }
        return md.stripTrailing() + "\n\n## 3. 정산 수식\n\n" + block;
    }
}
