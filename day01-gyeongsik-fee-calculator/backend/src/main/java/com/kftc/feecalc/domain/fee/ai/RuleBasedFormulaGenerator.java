package com.kftc.feecalc.domain.fee.ai;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.kftc.feecalc.domain.fee.service.SkillEngineService;
import com.kftc.feecalc.domain.fee.service.SpecialRuleConverter;

/**
 * "## 1. 비즈니스 규칙 요약"의 한글 문장에서 산정 패턴을 찾아 "## 3. 정산 수식"(SpEL)을 만드는 내장 변환기.
 * AI 키가 없거나 AI 수식이 검증을 통과하지 못하면 이 변환기를 쓴다. 프론트 src/utils/formulaGenerator.js 와 같은 규칙이다
 * (같은 문장이면 같은 수식·설명). 찾는 순서는 아래와 같다.
 * <ol>
 *   <li>구간별 차등 단가: "100만 건까지 건당 20원, 100만 건 초과 ~ 300만 건 15원, 300만 건 초과분 10원"</li>
 *   <li>기본료 + 건당 단가: "기본료: 분기 90만원", "건당 단가 8원"</li>
 *   <li>균등 + 실적비례 혼합: "총액 3억원", "30%는 … 균등", (선택) "70%는 … 실적/건수 비율"</li>
 *   <li>건당 단가 + 최저·최고 한도: "건당 단가 12원", "최저 회비 50만원", "최고 회비 1억원"</li>
 *   <li>총액 대비 단순 실적 비율: "총액 1억 2,000만원"</li>
 * </ol>
 * 만드는 수식은 SimpleEvaluationContext 에서 도는 숫자·변수·사칙연산·비교·삼항 연산자만 쓰고, 나눗셈은 0 나누기를 막는다.
 */
public final class RuleBasedFormulaGenerator {

    private RuleBasedFormulaGenerator() {
    }

    /**
     * formula: 만든 수식, pattern: 감지한 산정 유형, steps: 규칙 → 변수·수식 매핑 설명(순서대로),
     * equalFormula·perfFormula: 균등+실적 혼합형이면 분리 수식(formula:equal / formula:perf 블록용), 아니면 null
     */
    public record Generated(String formula, String pattern, List<String> steps, String equalFormula, String perfFormula) {

        public Generated(String formula, String pattern, List<String> steps) {
            this(formula, pattern, steps, null, null);
        }
    }

    private static final String AMOUNT = SpecialRuleConverter.AMOUNT;
    private static final Pattern TOTAL = Pattern.compile("총액\\s*(" + AMOUNT + ")");
    private static final Pattern EQUAL_SHARE = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*%[^\\n%]*균등");
    private static final Pattern PERF_SHARE = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*%[^\\n%]*(?:실적|건수)");
    private static final Pattern BASE_FEE = Pattern.compile("기본료[^\\d\\n]*(" + AMOUNT + ")");
    private static final Pattern UNIT = Pattern.compile("건당\\s*(?:단가\\s*)?(\\d[\\d,]*)\\s*원");
    private static final Pattern MIN = Pattern.compile("(?:최저|최소)\\s*(?:회비|금액|한도)?\\s*(?:는|은)?\\s*(" + AMOUNT + ")");
    private static final Pattern MAX = Pattern.compile("(?:최고|최대)\\s*(?:회비|금액|한도)?\\s*(?:는|은)?\\s*(" + AMOUNT + ")");
    private static final Pattern TIER_UPPER = Pattern.compile("(?:(\\d[\\d,]*)\\s*(만|억)?\\s*건\\s*까지|~\\s*(\\d[\\d,]*)\\s*(만|억)?\\s*건)");
    private static final Pattern PRICE = Pattern.compile("(\\d[\\d,]*)\\s*원");

    public static Optional<Generated> generate(String rules) {
        if (rules == null || rules.isBlank()) {
            return Optional.empty();
        }
        return tiered(rules)
                .or(() -> baseFee(rules))
                .or(() -> mixed(rules))
                .or(() -> unitPrice(rules))
                .or(() -> ratio(rules));
    }

    private static Optional<Generated> tiered(String rules) {
        for (String line : SkillEngineService.lines(rules)) {
            if (!line.contains("건까지") && !line.contains("건 까지")) {
                continue;
            }
            // 쉼표로 나눈 조각마다 상한(N건까지 / ~ N건)과 단가(마지막 N원)
            List<long[]> tiers = new ArrayList<>();
            for (String seg : line.substring(line.indexOf(':') + 1).split("[,，]")) {
                Matcher p = PRICE.matcher(seg);
                String price = null;
                while (p.find()) {
                    price = p.group(1);
                }
                if (price == null) {
                    continue;
                }
                Matcher u = TIER_UPPER.matcher(seg);
                long upper = -1;
                if (u.find()) {
                    String num = u.group(1) != null ? u.group(1) : u.group(3);
                    String unit = u.group(1) != null ? u.group(2) : u.group(4);
                    upper = SpecialRuleConverter.parseAmount(num + (unit == null ? "" : unit));
                }
                tiers.add(new long[] {upper, Long.parseLong(price.replace(",", ""))});
            }
            if (tiers.size() < 2 || tiers.get(0)[0] <= 0) {
                continue;
            }
            List<String> parts = new ArrayList<>();
            List<String> steps = new ArrayList<>();
            steps.add("'" + line + "' → 최종 인정 건수(#finalCount)를 구간으로 나눠 구간마다 (구간에 든 건수 × 단가)를 더함");
            long lower = 0;
            for (int i = 0; i < tiers.size(); i++) {
                long upper = tiers.get(i)[0];
                long price = tiers.get(i)[1];
                boolean last = i == tiers.size() - 1;
                if (!last && upper <= lower) {
                    return Optional.empty();
                }
                if (i == 0) {
                    parts.add("(#finalCount < " + upper + " ? #finalCount : " + upper + ") * " + price);
                    steps.add(String.format("%d구간: %,d건까지 건당 %,d원", i + 1, upper, price));
                } else if (last && upper <= lower) {
                    parts.add("(#finalCount > " + lower + " ? #finalCount - " + lower + " : 0) * " + price);
                    steps.add(String.format("%d구간: %,d건 초과분 건당 %,d원", i + 1, lower, price));
                } else {
                    parts.add("(#finalCount > " + lower + " ? (#finalCount < " + upper + " ? #finalCount : " + upper + ") - "
                            + lower + " : 0) * " + price);
                    steps.add(String.format("%d구간: %,d건 초과 ~ %,d건 건당 %,d원", i + 1, lower, upper, price));
                }
                lower = Math.max(lower, upper);
            }
            return Optional.of(new Generated(String.join("\n  + ", parts),
                    "구간별 차등 단가 (" + tiers.size() + "구간 누진)", steps));
        }
        return Optional.empty();
    }

    private static Optional<Generated> baseFee(String rules) {
        Matcher b = BASE_FEE.matcher(rules);
        Matcher u = UNIT.matcher(rules);
        if (!b.find() || !u.find()) {
            return Optional.empty();
        }
        long base = SpecialRuleConverter.parseAmount(b.group(1));
        long unit = Long.parseLong(u.group(1).replace(",", ""));
        return Optional.of(new Generated(
                "(#finalCount > 0 ? " + base + " * #periodScale : 0) + #finalCount * " + unit,
                "기본료 + 건당 단가",
                List.of(String.format("기본료 '%s' → %d * #periodScale (분기 = 1, 분기가 아니면 일수 비례)", b.group(1).strip(), base),
                        "실적이 있는 기관만 기본료 부과 → (#finalCount > 0 ? 기본료 : 0)",
                        String.format("건당 단가 %,d원 → #finalCount * %d", unit, unit))));
    }

    private static Optional<Generated> mixed(String rules) {
        Matcher t = TOTAL.matcher(rules);
        Matcher e = EQUAL_SHARE.matcher(rules);
        if (!t.find() || !e.find()) {
            return Optional.empty();
        }
        BigDecimal equalPct = new BigDecimal(e.group(1));
        if (equalPct.signum() <= 0 || equalPct.compareTo(BigDecimal.valueOf(100)) >= 0) {
            return Optional.empty();
        }
        Matcher p = PERF_SHARE.matcher(rules);
        boolean perfFound = false;
        BigDecimal perfPct = BigDecimal.valueOf(100).subtract(equalPct);
        // 균등 비율 문장이 아닌 첫 "N% … 실적/건수" 문장 (없으면 나머지 = 100 - 균등)
        while (p.find()) {
            if (p.start() != e.start()) {
                perfPct = new BigDecimal(p.group(1));
                perfFound = true;
                break;
            }
        }
        long total = SpecialRuleConverter.parseAmount(t.group(1));
        String eq = ratio(equalPct);
        String perf = ratio(perfPct);
        List<String> steps = new ArrayList<>();
        steps.add(String.format("총액 '%s' → %d.0 (원, 소수점을 붙여 정수 나눗셈 버림 방지)", t.group(1).strip(), total));
        steps.add("기간 환산 → * #periodScale (분기 = 1, 분기가 아니면 일수 ÷ 91)");
        steps.add(String.format("균등 %s%% → %s / #institutionCount (참가기관 수가 0이면 0)", pct(equalPct), eq));
        steps.add(String.format("실적 %s%%%s → %s * #finalCount / #totalCount (전체 인정 건수가 0이면 0)", pct(perfPct),
                perfFound ? "" : "(나머지)", perf));
        if (equalPct.add(perfPct).compareTo(BigDecimal.valueOf(100)) != 0) {
            steps.add("주의: 균등·실적 비율의 합이 100%가 아니어서 회비 합계가 총액과 달라집니다.");
        }
        String equalFormula = "#institutionCount == 0 ? 0 : " + total + ".0 * #periodScale * " + eq + " / #institutionCount";
        String perfFormula = "#totalCount == 0 ? 0 : " + total + ".0 * #periodScale * " + perf + " * #finalCount / #totalCount";
        steps.add("분리 수식: 균등분담분(formula:equal)과 실적분담분(formula:perf)을 따로 두면 4번 후처리에서 각 합계를 따로 맞출 수 있습니다.");
        return Optional.of(new Generated(
                total + ".0 * #periodScale * ((#institutionCount == 0 ? 0 : " + eq + " / #institutionCount)"
                        + " + (#totalCount == 0 ? 0 : " + perf + " * #finalCount / #totalCount))",
                "균등 " + pct(equalPct) + "% + 실적비례 " + pct(perfPct) + "% 혼합분담", steps, equalFormula, perfFormula));
    }

    private static Optional<Generated> unitPrice(String rules) {
        Matcher u = UNIT.matcher(rules);
        if (!u.find()) {
            return Optional.empty();
        }
        long unit = Long.parseLong(u.group(1).replace(",", ""));
        String fee = "#finalCount * " + unit;
        Matcher mn = MIN.matcher(rules);
        Matcher mx = MAX.matcher(rules);
        Long min = mn.find() ? SpecialRuleConverter.parseAmount(mn.group(1)) : null;
        Long max = mx.find() ? SpecialRuleConverter.parseAmount(mx.group(1)) : null;
        String capped = max == null ? fee : "(" + fee + " > " + max + " ? " + max + " : " + fee + ")";
        String formula = min == null ? capped : fee + " < " + min + "\n  ? " + min + "\n  : " + capped;
        List<String> steps = new ArrayList<>();
        steps.add(String.format("건당 단가 %,d원 → #finalCount * %d", unit, unit));
        if (min != null) {
            steps.add(String.format("최저 회비 %,d원 → 단가 계산액이 %d 미만이면 %d", min, min, min));
        }
        if (max != null) {
            steps.add(String.format("최고 회비 %,d원 → 단가 계산액이 %d 초과면 %d", max, max, max));
        }
        String pattern = min != null && max != null ? "건당 단가 + 최저·최고 한도"
                : min != null ? "건당 단가 + 최저 한도" : max != null ? "건당 단가 + 최고 한도" : "건당 단가";
        return Optional.of(new Generated(formula, pattern, steps));
    }

    private static Optional<Generated> ratio(String rules) {
        Matcher t = TOTAL.matcher(rules);
        if (!t.find()) {
            return Optional.empty();
        }
        long total = SpecialRuleConverter.parseAmount(t.group(1));
        return Optional.of(new Generated("#totalCount == 0 ? 0 : " + total + ".0 * #periodScale * #finalCount / #totalCount",
                "총액 대비 단순 실적 비율",
                List.of(String.format("총액 '%s' → %d.0 (원, 소수점을 붙여 정수 나눗셈 버림 방지)", t.group(1).strip(), total),
                        "기간 환산 → * #periodScale (분기 = 1, 분기가 아니면 일수 ÷ 91)",
                        "분담률 = #finalCount / #totalCount (전체 인정 건수가 0이면 0)")));
    }

    /** 30 → "0.3" */
    private static String ratio(BigDecimal pct) {
        return pct.movePointLeft(2).stripTrailingZeros().toPlainString();
    }

    /** 30.0 → "30" */
    private static String pct(BigDecimal pct) {
        return pct.stripTrailingZeros().toPlainString();
    }
}
