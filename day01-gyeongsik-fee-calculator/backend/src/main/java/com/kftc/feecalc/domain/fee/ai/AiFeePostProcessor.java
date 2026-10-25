package com.kftc.feecalc.domain.fee.ai;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.kftc.feecalc.domain.fee.ai.RuleBasedFeeRules.Adjustment;
import com.kftc.feecalc.domain.fee.ai.RuleBasedFeeRules.FeeLine;
import com.kftc.feecalc.domain.fee.dto.ParsedIssue;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 회비 산출의 AI 단계. {@link com.kftc.feecalc.domain.fee.service.FeeCalculationService#calculate} 가 부른다.
 * <ol>
 *   <li>Step A {@link #reviewIssues}: 이슈 문장을 "## 2. AI 예외 차감 지침"에 비춰 차감 대상인지 판별</li>
 *   <li>Step B 는 SkillEngineService 의 formula 1차 계산 (이 클래스 밖)</li>
 *   <li>Step C {@link #adjustFees}: "## 1. 비즈니스 규칙 요약"의 단수 처리·예외 규정 중 수식에 없는 것을 1차 회비에 반영</li>
 * </ol>
 * AI 키가 없으면 {@link RuleBasedFeeRules}로, AI 호출이 실패하거나 응답이 이상하면 그 단계만 규칙 기반으로 바꿔 산출을 이어 간다.
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

    public record FeeReview(List<Adjustment> adjustments, Outcome outcome) {
    }

    public static final String ISSUE_SYSTEM = """
            너는 금융결제원 회비 정산 검증 AI야. 담당자가 입력한 예외 차감 이슈 문장마다 [AI 예외 차감 지침]상 차감 대상이 맞는지 판단해.
            기관과 건수는 이미 해석되어 있으니 바꾸지 말고 차감 여부만 정해. 지침에서 차감하지 않는다고 한 경우(예: 기관 자체 ATM 장애)는 deduct=false 야.
            반드시 다음 JSON 객체로만 답해: {"results":[{"index":번호,"deduct":true 또는 false,"reason":"지침 근거 한 문장"}]}""";

    public static final String FEE_SYSTEM = """
            너는 금융결제원 정산 검증 AI야. 1차 수식으로 계산된 기관별 회비 내역을 보고, [비즈니스 규칙 요약]에 적힌 단수 처리(예: 특정 기관 10원 단위 절상, \
            절상 차이분은 실적 큰 순서대로 1원씩 절삭 등)나 예외 규정 중 수식에 미처 반영되지 않은 세부 규칙을 적용해 최종 회비(finalFee)와 조정 사유(adjustReason)를 JSON 배열로 반환해.
            [정산 수식]에 이미 들어 있는 규칙(구간 단가, 최저·최고 한도, 총액 분담 등)은 다시 적용하지 마. 규칙에 없는 임의 조정은 하지 마.
            조정하지 않는 기관은 finalFee 를 1차 산출회비와 같게 두고 adjustReason 은 빈 문자열로 둬.
            adjustReason 형식 예: "규칙 반영: 10원 단위 절상 (+6원)", "규칙 반영: 절상 차이분 실적순 절삭 (-1원)".
            반드시 다음 JSON 객체로만 답해: {"items":[{"institutionId":"기관ID","finalFee":정수,"adjustReason":"사유 또는 빈 문자열"}]}""";

    private final LlmClient llm;

    public boolean aiEnabled() {
        return llm.enabled();
    }

    public String model() {
        return llm.model();
    }

    // ---------- Step A ----------

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

    // ---------- Step C ----------

    /** lines 와 같은 순서로 최종 회비와 조정 사유를 돌려준다 */
    public FeeReview adjustFees(String summary, String formula, List<FeeLine> lines, boolean allowAi) {
        if (!allowAi || !llm.enabled()) {
            return new FeeReview(RuleBasedFeeRules.postProcess(summary, lines), new Outcome(Mode.RULE, null));
        }
        if (lines.isEmpty()) {
            return new FeeReview(List.of(), new Outcome(Mode.AI, null));
        }
        try {
            long total = lines.stream().mapToLong(FeeLine::primaryFee).sum();
            StringBuilder user = new StringBuilder("[비즈니스 규칙 요약]\n").append(summary)
                    .append("\n\n[정산 수식] (1차 계산에 이미 적용됨)\n").append(formula)
                    .append("\n\n[1차 산출 결과] 전체 회비 합계: ").append(total).append("원\n")
                    .append("기관ID | 기관명 | 최종인정건수(#finalCount) | 1차 산출회비\n");
            for (FeeLine l : lines) {
                user.append(l.institutionId()).append(" | ").append(l.name()).append(" | ").append(l.finalCount())
                        .append(" | ").append(l.primaryFee()).append('\n');
            }
            JsonNode res = llm.chatJson(FEE_SYSTEM, user.toString());
            JsonNode items = res.isArray() ? res : res.path("items");
            Map<String, JsonNode> byId = new HashMap<>();
            for (JsonNode it : items) {
                byId.put(it.path("institutionId").asText(""), it);
            }
            List<Adjustment> result = new ArrayList<>();
            int rejected = 0;
            for (FeeLine l : lines) {
                JsonNode it = byId.get(l.institutionId());
                if (it == null || !it.path("finalFee").isNumber()) {
                    result.add(new Adjustment(l.primaryFee(), null));
                    continue;
                }
                double raw = it.path("finalFee").asDouble();
                long fee = Math.round(raw);
                // 원 단위 정수, 0 이상, 1차 금액의 2배(최소 1,000원) 안쪽 조정만 받는다. 벗어나면 1차 금액 유지
                if (raw != fee || fee < 0 || Math.abs(fee - l.primaryFee()) > Math.max(l.primaryFee(), 1_000)) {
                    rejected++;
                    result.add(new Adjustment(l.primaryFee(), null));
                    continue;
                }
                if (fee == l.primaryFee()) {
                    result.add(new Adjustment(fee, null));
                    continue;
                }
                String reason = it.path("adjustReason").asText("").strip();
                if (reason.isEmpty()) {
                    reason = "규칙 반영: AI 보정 (" + RuleBasedFeeRules.signed(fee - l.primaryFee()) + ")";
                }
                result.add(new Adjustment(fee, reason.length() > 300 ? reason.substring(0, 300) : reason));
            }
            return new FeeReview(result, new Outcome(Mode.AI,
                    rejected == 0 ? null : "AI 보정값이 허용 범위를 벗어난 " + rejected + "개 기관은 1차 금액을 유지했습니다."));
        } catch (RuntimeException e) {
            log.warn("AI 최종 보정 실패 → 규칙 기반: {}", e.getMessage());
            return new FeeReview(RuleBasedFeeRules.postProcess(summary, lines),
                    new Outcome(Mode.RULE_FALLBACK, "최종 보정 AI 호출 실패로 규칙 기반 적용 (" + e.getMessage() + ")"));
        }
    }
}
