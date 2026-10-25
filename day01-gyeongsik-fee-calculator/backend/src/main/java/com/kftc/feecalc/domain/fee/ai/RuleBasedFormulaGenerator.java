package com.kftc.feecalc.domain.fee.ai;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AI 키가 없을 때 "## 1. 비즈니스 규칙 요약"에서 "## 3. 정산 수식"을 만드는 규칙 기반 생성기.
 * 기본 업무에 쓰는 다섯 가지 산정 방식만 알아듣는다. 프론트 src/utils/aiRules.js generateFormula 와 같은 규칙이다.
 * <ol>
 *   <li>구간별 차등 단가: "100만 건까지 건당 20원, 100만 건 초과 ~ 300만 건 15원, 300만 건 초과분 10원"</li>
 *   <li>기본료 + 건당 단가: "기본료: 분기 90만원 (… 1건 이상인 기관만 …)", "건당 단가 8원"</li>
 *   <li>총액 분담: "총액 3억원", 선택적으로 "총액의 30%는 … 균등"</li>
 *   <li>건당 단가 + 최저·최고 회비: "건당 단가 12원", "최저 회비 50만원", "최고 회비 1억원"</li>
 * </ol>
 */
public final class RuleBasedFormulaGenerator {

    private RuleBasedFormulaGenerator() {
    }

    public record Generated(String formula, String explanation) {
    }

    private static final Pattern TOTAL = Pattern.compile("총액\\s*(" + RuleBasedFeeRules.AMOUNT + ")");
    private static final Pattern EQUAL_SHARE = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*%[^\\n%]*균등");
    private static final Pattern BASE_FEE = Pattern.compile("기본료[^\\d\\n]*(" + RuleBasedFeeRules.AMOUNT + ")");
    private static final Pattern UNIT = Pattern.compile("건당\\s*(?:단가\\s*)?(\\d[\\d,]*)\\s*원");
    private static final Pattern MIN = Pattern.compile("(?:최저|최소)\\s*(?:회비|금액|한도)?\\s*(?:는|은)?\\s*(" + RuleBasedFeeRules.AMOUNT + ")");
    private static final Pattern MAX = Pattern.compile("(?:최고|최대)\\s*(?:회비|금액|한도)?\\s*(?:는|은)?\\s*(" + RuleBasedFeeRules.AMOUNT + ")");
    private static final Pattern TIER_UPPER = Pattern.compile("(?:(\\d[\\d,]*)\\s*(만|억)?\\s*건\\s*까지|~\\s*(\\d[\\d,]*)\\s*(만|억)?\\s*건)");
    private static final Pattern PRICE = Pattern.compile("(\\d[\\d,]*)\\s*원");

    public static Optional<Generated> generate(String summary) {
        if (summary == null || summary.isBlank()) {
            return Optional.empty();
        }
        return tiered(summary)
                .or(() -> baseFee(summary))
                .or(() -> totalShare(summary))
                .or(() -> unitPrice(summary));
    }

    private static Optional<Generated> tiered(String summary) {
        for (String line : RuleBasedFeeRules.lines(summary)) {
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
                    upper = RuleBasedFeeRules.parseAmount(num + (unit == null ? "" : unit));
                }
                tiers.add(new long[] {upper, Long.parseLong(price.replace(",", ""))});
            }
            if (tiers.size() < 2 || tiers.get(0)[0] <= 0) {
                continue;
            }
            List<String> parts = new ArrayList<>();
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
                } else if (last && upper <= lower) {
                    parts.add("(#finalCount > " + lower + " ? #finalCount - " + lower + " : 0) * " + price);
                } else {
                    parts.add("(#finalCount > " + lower + " ? (#finalCount < " + upper + " ? #finalCount : " + upper + ") - "
                            + lower + " : 0) * " + price);
                }
                lower = Math.max(lower, upper);
            }
            return Optional.of(new Generated(String.join("\n  + ", parts),
                    "구간별 차등 단가 " + tiers.size() + "구간 (최종 인정 건수 기준 누진 감액)"));
        }
        return Optional.empty();
    }

    private static Optional<Generated> baseFee(String summary) {
        Matcher b = BASE_FEE.matcher(summary);
        Matcher u = UNIT.matcher(summary);
        if (!b.find() || !u.find()) {
            return Optional.empty();
        }
        long base = RuleBasedFeeRules.parseAmount(b.group(1));
        long unit = Long.parseLong(u.group(1).replace(",", ""));
        String baseExpr = base + (summary.contains("일수") ? " * #periodScale" : "");
        boolean onlyActive = summary.matches("(?s).*1건\\s*이상.*");
        String formula = (onlyActive ? "(#finalCount > 0 ? " + baseExpr + " : 0)" : baseExpr) + " + #finalCount * " + unit;
        return Optional.of(new Generated(formula, String.format("기본료 %,d원%s + 건당 %d원", base,
                onlyActive ? "(실적 1건 이상 기관만)" : "", unit)));
    }

    private static Optional<Generated> totalShare(String summary) {
        Matcher t = TOTAL.matcher(summary);
        if (!t.find()) {
            return Optional.empty();
        }
        long total = RuleBasedFeeRules.parseAmount(t.group(1));
        Matcher e = EQUAL_SHARE.matcher(summary);
        if (e.find()) {
            BigDecimal equal = new BigDecimal(e.group(1)).movePointLeft(2);
            if (equal.signum() > 0 && equal.compareTo(BigDecimal.ONE) < 0) {
                String eq = equal.stripTrailingZeros().toPlainString();
                String rest = BigDecimal.ONE.subtract(equal).stripTrailingZeros().toPlainString();
                return Optional.of(new Generated(total + ".0 * #periodScale * (" + eq + " / #institutionCount"
                        + " + (#totalCount == 0 ? 0 : " + rest + " * #finalCount / #totalCount))",
                        String.format("총액 %,d원 중 %s%% 균등 + %s%% 실적 비례", total,
                                equal.movePointRight(2).stripTrailingZeros().toPlainString(),
                                BigDecimal.ONE.subtract(equal).movePointRight(2).stripTrailingZeros().toPlainString())));
            }
        }
        return Optional.of(new Generated("#totalCount == 0 ? 0 : " + total + ".0 * #periodScale * #finalCount / #totalCount",
                String.format("총액 %,d원을 인정 건수 비율로 분담", total)));
    }

    private static Optional<Generated> unitPrice(String summary) {
        Matcher u = UNIT.matcher(summary);
        if (!u.find()) {
            return Optional.empty();
        }
        long unit = Long.parseLong(u.group(1).replace(",", ""));
        String fee = "#finalCount * " + unit;
        Matcher mn = MIN.matcher(summary);
        Matcher mx = MAX.matcher(summary);
        Long min = mn.find() ? RuleBasedFeeRules.parseAmount(mn.group(1)) : null;
        Long max = mx.find() ? RuleBasedFeeRules.parseAmount(mx.group(1)) : null;
        String capped = max == null ? fee : "(" + fee + " > " + max + " ? " + max + " : " + fee + ")";
        String formula = min == null ? capped : fee + " < " + min + "\n  ? " + min + "\n  : " + capped;
        StringBuilder ex = new StringBuilder("건당 " + unit + "원");
        if (min != null) {
            ex.append(String.format(", 최저 %,d원", min));
        }
        if (max != null) {
            ex.append(String.format(", 최고 %,d원", max));
        }
        return Optional.of(new Generated(formula, ex.toString()));
    }
}
