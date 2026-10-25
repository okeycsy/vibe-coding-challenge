package com.kftc.feecalc.domain.fee.ai;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.kftc.feecalc.domain.fee.dto.ParsedIssue;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 회비 산출 전 이슈 차감 판별의 AI 단계. {@link com.kftc.feecalc.domain.fee.service.FeeCalculationService#calculate} 가 부른다.
 * {@link #reviewIssues}: 이슈 문장을 "## 2. AI 예외 차감 지침"에 비춰 차감 대상인지 판별한다.
 * AI 키가 없으면 {@link RuleBasedFeeRules}로, AI 호출이 실패하거나 응답이 이상하면 규칙 기반으로 바꿔 산출을 이어 간다.
 * <p>
 * 금액은 AI 가 정하지 않는다: 1차 수식은 SpEL 로, "## 4. 최종 정산 특이사항"은 빌더에서 확정한 후처리 스크립트를
 * {@link com.kftc.feecalc.domain.fee.service.PostprocessEngine}이 실행해 계산한다 (산출 중 AI 호출 없음).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiFeePostProcessor {

    /** AI 를 썼는지: AI(모델 응답 반영) / RULE(키 없음, 규칙 기반) / RULE_FALLBACK(AI 실패로 규칙 기반) */
    public enum Mode { AI, RULE, RULE_FALLBACK }

    public record Outcome(Mode mode, String note) {
    }

    public record IssueDecision(boolean deduct, String judgement) {
    }

    public record IssueReview(List<IssueDecision> decisions, Outcome outcome) {
    }

    public static final String ISSUE_SYSTEM = """
            너는 금융결제원 회비 정산 검증 AI야. 담당자가 입력한 예외 차감 이슈 문장마다 [AI 예외 차감 지침]상 차감 대상이 맞는지 판단해.
            기관과 건수는 이미 해석되어 있으니 바꾸지 말고 차감 여부만 정해. 지침에서 차감하지 않는다고 한 경우(예: 기관 자체 ATM 장애)는 deduct=false 야.
            반드시 다음 JSON 객체로만 답해: {"results":[{"index":번호,"deduct":true 또는 false,"reason":"지침 근거 한 문장"}]}""";

    private final LlmClient llm;

    public boolean aiEnabled() {
        return llm.enabled();
    }

    public String model() {
        return llm.model();
    }

    /** parsed 와 같은 순서로 차감 여부를 돌려준다. 기관·건수를 못 찾은 문장은 AI 에 보내지 않고 미반영 */
    public IssueReview reviewIssues(String guide, List<ParsedIssue> parsed, boolean allowAi) {
        List<IssueDecision> rule = new ArrayList<>();
        for (ParsedIssue p : parsed) {
            if (!p.applicable()) {
                rule.add(new IssueDecision(false, "기관명 또는 차감 건수를 문장에서 찾지 못해 반영하지 않았습니다."));
                continue;
            }
            String line = RuleBasedFeeRules.excludedBy(guide, p.text());
            rule.add(line == null ? new IssueDecision(true, "지침상 차감 대상")
                    : new IssueDecision(false, "지침상 차감 제외: " + line));
        }
        if (!allowAi || !llm.enabled()) {
            return new IssueReview(rule, new Outcome(Mode.RULE, null));
        }
        if (parsed.stream().noneMatch(ParsedIssue::applicable) || guide == null || guide.isBlank()) {
            return new IssueReview(rule, new Outcome(Mode.AI, null));
        }
        try {
            StringBuilder user = new StringBuilder("[AI 예외 차감 지침]\n").append(guide).append("\n\n[이슈 목록]\n");
            for (int i = 0; i < parsed.size(); i++) {
                ParsedIssue p = parsed.get(i);
                if (p.applicable()) {
                    user.append(i).append(". ").append(p.text()).append(" (기관: ").append(p.institutionName())
                            .append(", 건수: ").append(p.count()).append("건)\n");
                }
            }
            JsonNode res = llm.chatJson(ISSUE_SYSTEM, user.toString());
            Map<Integer, JsonNode> byIndex = new HashMap<>();
            for (JsonNode r : res.path("results")) {
                if (r.path("index").canConvertToInt()) {
                    byIndex.put(r.path("index").asInt(), r);
                }
            }
            List<IssueDecision> decisions = new ArrayList<>();
            int missing = 0;
            for (int i = 0; i < parsed.size(); i++) {
                JsonNode r = byIndex.get(i);
                if (!parsed.get(i).applicable()) {
                    decisions.add(rule.get(i));
                } else if (r == null || !r.path("deduct").isBoolean()) {
                    missing++;
                    decisions.add(rule.get(i));
                } else {
                    boolean deduct = r.path("deduct").asBoolean();
                    String reason = r.path("reason").asText("").strip();
                    decisions.add(new IssueDecision(deduct, (deduct ? "AI 판별(차감 대상)" : "AI 판별(차감 제외)")
                            + (reason.isEmpty() ? "" : ": " + reason)));
                }
            }
            return new IssueReview(decisions, new Outcome(Mode.AI,
                    missing == 0 ? null : "AI 가 판별하지 않은 이슈 " + missing + "건은 규칙 기반으로 판별했습니다."));
        } catch (RuntimeException e) {
            log.warn("AI 이슈 판별 실패 → 규칙 기반: {}", e.getMessage());
            return new IssueReview(rule, new Outcome(Mode.RULE_FALLBACK, "이슈 판별 AI 호출 실패로 규칙 기반 적용 (" + e.getMessage() + ")"));
        }
    }
}
