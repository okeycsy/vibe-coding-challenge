package com.kftc.feecalc.domain.fee.ai;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.kftc.feecalc.domain.fee.service.SkillEngineService;
import com.kftc.feecalc.domain.fee.service.SpecialAction;
import com.kftc.feecalc.domain.fee.service.SpecialRulePostProcessor;
import com.kftc.feecalc.domain.fee.service.SpecialRulePostProcessor.FeeLine;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * "## 4. 최종 정산 특이사항" 해석기. AI 가 문장을 읽어 정해진 보정 동작({@link SpecialAction}) JSON 으로만 바꾸고,
 * 금액은 {@link SpecialRulePostProcessor#execute}가 그 동작대로 계산한다 (AI 가 금액을 정하지 않음).
 * AI 가 만든 동작은 {@link SpecialRulePostProcessor#validate} 허용 목록을 통과해야 쓰고, 키가 없거나(RULE)
 * AI 가 실패·형식 오류면(RULE_FALLBACK) 규칙 기반 해석기 {@link SpecialRulePostProcessor#interpret}로 같은 구조를 만든다.
 * 같은 문장·같은 기관 목록의 AI 해석은 기억해 두어, 다시 산출해도 같은 동작(같은 금액)이 나온다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SpecialRuleInterpreter {

    public record Interpretation(AiFeePostProcessor.Mode mode, String model, String note, List<SpecialAction> actions,
                                 List<String> unsupported) {
    }

    public static final String SYSTEM = """
            너는 금융결제원 회비 정산 시스템의 특이사항 해석기야. [최종 정산 특이사항] 문장을 읽고 아래 보정 동작으로만 바꿔. 금액을 직접 계산하지 마.
            동작 종류:
            1) {"type":"MIN_FEE" 또는 "MAX_FEE","amount":원(정수),"target":"ALL" 또는 "NAMED","institutions":[기관명...],"rule":"근거 문장"}
               최저 회비(미만이면 amount 로 올림) / 최고 회비(넘으면 amount 로 내림)
            2) {"type":"ROUND","unit":원 단위(정수, 10·100 등),"rounding":"UP"(절상·올림) 또는 "DOWN"(절사·절삭·버림) 또는 "HALF_UP"(반올림),
                "target":"ALL"(전체) 또는 "FIRST"(첫 번째 기관) 또는 "NAMED"(institutions 의 기관),"institutions":[기관명...],
                "redistribute":"NONE" 또는 "PERF_DESC" 또는 "PERF_ASC","rule":"근거 문장"}
               redistribute: 끝전 처리로 생긴 차이분(초과액)을 대상이 아닌 기관에서 실적 큰 순(PERF_DESC)·작은 순(PERF_ASC)으로 1원씩 되돌려 총액을 맞추라는 문장이 있을 때만 씀. 없으면 NONE.
            규칙:
            - 기관명은 반드시 [기관 목록]에 있는 이름을 그대로 써. 문장이 "1개 기관(첫 번째 기관 또는 지정 기관)"처럼 기관을 특정하지 않으면 FIRST.
            - 차이분 배분 문장은 따로 동작을 만들지 말고, 해당 ROUND 동작의 redistribute 로 넣어.
            - 위 동작으로 바꿀 수 없는 문장은 unsupported 에 원문 그대로 넣어.
            반드시 다음 JSON 객체로만 답해: {"actions":[...],"unsupported":["문장"...]}""";

    private static final int CACHE_LIMIT = 200;

    private final LlmClient llm;
    private final Map<String, Interpretation> cache = new ConcurrentHashMap<>();

    public Interpretation interpret(String specialRules, List<FeeLine> lines, boolean allowAi) {
        List<String> rules = SkillEngineService.lines(specialRules);
        if (rules.isEmpty()) {
            return new Interpretation(AiFeePostProcessor.Mode.RULE, null, null, List.of(), List.of());
        }
        if (!allowAi || !llm.enabled()) {
            return byRule(specialRules, lines, AiFeePostProcessor.Mode.RULE, null);
        }
        StringBuilder user = new StringBuilder("[기관 목록] (산출 순서, 첫 줄이 첫 번째 기관)\n");
        for (FeeLine l : lines) {
            user.append("- ").append(l.name()).append(" (기관코드 ").append(l.code()).append(")\n");
        }
        user.append("\n[최종 정산 특이사항]\n");
        rules.forEach(r -> user.append("- ").append(r).append('\n'));
        String key = llm.model() + '\n' + user;
        Interpretation cached = cache.get(key);
        if (cached != null) {
            return cached;
        }
        try {
            JsonNode res = llm.chatJson(SYSTEM, user.toString());
            if (!res.path("actions").isArray()) {
                throw new IllegalArgumentException("actions 배열이 없습니다.");
            }
            List<SpecialAction> actions = new ArrayList<>();
            for (JsonNode a : res.path("actions")) {
                actions.add(read(a));
            }
            List<SpecialAction> valid = SpecialRulePostProcessor.validate(actions, lines);
            List<String> unsupported = new ArrayList<>();
            res.path("unsupported").forEach(u -> {
                if (u.isTextual() && !u.asText().isBlank() && unsupported.size() < 20) {
                    unsupported.add(u.asText().strip());
                }
            });
            Interpretation result = new Interpretation(AiFeePostProcessor.Mode.AI, llm.model(), null, valid, unsupported);
            if (cache.size() >= CACHE_LIMIT) {
                cache.clear();
            }
            cache.put(key, result);
            return result;
        } catch (RuntimeException e) {
            log.warn("AI 특이사항 해석 실패 → 규칙 기반: {}", e.getMessage());
            return byRule(specialRules, lines, AiFeePostProcessor.Mode.RULE_FALLBACK,
                    "특이사항 AI 해석 실패로 규칙 기반 해석 적용 (" + e.getMessage() + ")");
        }
    }

    private static Interpretation byRule(String specialRules, List<FeeLine> lines, AiFeePostProcessor.Mode mode, String note) {
        SpecialRulePostProcessor.Interpretation r = SpecialRulePostProcessor.interpret(specialRules, lines);
        return new Interpretation(mode, null, note, r.actions(), r.unsupported());
    }

    /** JSON 한 개 → 동작. 모르는 값(enum 밖, 숫자 아님)은 IllegalArgumentException 으로 규칙 기반 전환 */
    static SpecialAction read(JsonNode a) {
        List<String> institutions = new ArrayList<>();
        a.path("institutions").forEach(i -> institutions.add(i.asText()));
        return new SpecialAction(
                SpecialAction.Type.valueOf(text(a, "type")),
                number(a, "amount"),
                number(a, "unit"),
                a.hasNonNull("rounding") ? SpecialAction.Rounding.valueOf(text(a, "rounding")) : null,
                a.hasNonNull("target") ? SpecialAction.Target.valueOf(text(a, "target")) : null,
                institutions,
                a.hasNonNull("redistribute") ? SpecialAction.Redistribute.valueOf(text(a, "redistribute")) : null,
                a.path("rule").asText(""));
    }

    private static String text(JsonNode a, String field) {
        if (!a.path(field).isTextual()) {
            throw new IllegalArgumentException(field + " 값이 없습니다.");
        }
        return a.path(field).asText().strip();
    }

    private static Long number(JsonNode a, String field) {
        JsonNode v = a.path(field);
        if (v.isMissingNode() || v.isNull()) {
            return null;
        }
        if (!v.isIntegralNumber() || !v.canConvertToLong()) {
            throw new IllegalArgumentException(field + " 는 정수여야 합니다.");
        }
        return v.asLong();
    }
}
