package com.kftc.feecalc.domain.fee.service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 2단계 정산의 Step 2: skill.md "## 4. 최종 정산 특이사항"을 1차 계산 결과(수식 + 원 단위 배분)에 적용한다.
 * 규칙 기반(결정적)이라 같은 입력이면 늘 같은 결과가 나오고, 프론트 src/utils/specialRules.js 와 같은 규칙이다
 * (서버 연결 여부와 상관없이 같은 금액). 알아듣는 문장은 아래와 같다.
 * <ol>
 *   <li>"최저/최소/최고/최대 (회비|금액|한도) N원": 상하한. 문장에 기관 이름·별칭이 있으면 그 기관만, 없으면 전체</li>
 *   <li>"N원 단위로 절상(올림·반올림)" + 섹션 안에 "차이분(차액·초과액)은 … 실적 … 1원씩 절삭(차감)" 문장이 있으면:
 *       절상 대상(문장에 기관이 있으면 그 기관, 없으면 첫 번째 기관)을 N원 단위로 올리고, 늘어난 금액만큼 나머지 기관을
 *       최종 인정 실적이 큰 순서(동률이면 기관코드 순)대로 1원씩 깎아 합계를 유지한다. "작은 순"이면 실적이 작은 순서</li>
 *   <li>"N원 미만 절사(절삭·버림·내림)": 대상(없으면 전체)을 N원 단위로 버린다. 합계는 줄어든다.
 *       차이분 문장이 없는 절상·반올림도 대상(없으면 전체)만 바꾼다</li>
 * </ol>
 */
public final class SpecialRulePostProcessor {

    private SpecialRulePostProcessor() {
    }

    /** 1차 계산 결과 한 행. code 는 기관코드(동률 정렬용) */
    public record FeeLine(String institutionId, String code, String name, List<String> aliases, long finalCount,
                          long fee) {
    }

    /** 최종 금액, 보정액(최종 - 1차), 사유. 보정이 없으면 reason 은 null */
    public record Result(long finalFee, long adjustment, String reason) {

        public boolean applied() {
            return reason != null;
        }
    }

    public static final String PREFIX = "특이사항 반영: ";

    public static final String AMOUNT = "\\d[\\d,]*(?:\\.\\d+)?\\s*(?:억|만|천)?(?:\\s*\\d[\\d,]*\\s*(?:만|천))?\\s*원";
    private static final Pattern ROUNDING = Pattern.compile(
            "(\\d[\\d,]*)\\s*원\\s*(?:단위|미만)\\s*(?:로|으로|에서)?\\s*(반올림|절상|올림|절사|절삭|버림|내림)");
    private static final Pattern CLAMP = Pattern.compile("(최저|최소|최고|최대)\\s*(?:회비|금액|한도)?\\s*(?:는|은)?\\s*(" + AMOUNT + ")");
    private static final Pattern DIFF = Pattern.compile("차이|차액|초과");
    private static final Pattern CUT = Pattern.compile("절삭|차감|1원씩");
    private static final Pattern ASC = Pattern.compile("(작은|적은)\\s*(순|기관)");

    public static List<Result> apply(String specialRules, List<FeeLine> lines) {
        int n = lines.size();
        long[] fee = lines.stream().mapToLong(FeeLine::fee).toArray();
        List<List<String>> reasons = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            reasons.add(new ArrayList<>());
        }
        List<String> rules = SkillEngineService.lines(specialRules);
        List<String> shareBackRules = rules.stream().filter(SpecialRulePostProcessor::isShareBack).toList();

        // 1) 최저·최고 회비
        for (String rule : rules) {
            Matcher m = CLAMP.matcher(rule);
            while (m.find()) {
                long limit = parseAmount(m.group(2));
                boolean min = m.group(1).equals("최저") || m.group(1).equals("최소");
                for (int i : orAll(named(rule, lines), n)) {
                    long next = min ? Math.max(fee[i], limit) : Math.min(fee[i], limit);
                    if (next != fee[i]) {
                        reasons.get(i).add(String.format("%s 회비 %,d원 적용 (%s)", m.group(1), limit, signed(next - fee[i])));
                        fee[i] = next;
                    }
                }
            }
        }

        // 2) 원 단위 절상(+ 차이분 실적순 1원 절삭)·절사·반올림
        for (String rule : rules) {
            Matcher m = ROUNDING.matcher(rule);
            if (!m.find()) {
                continue;
            }
            long unit = Long.parseLong(m.group(1).replace(",", ""));
            if (unit <= 1) {
                continue;
            }
            String mode = m.group(2);
            String label = label(mode);
            boolean raise = !label.equals("절사") && !label.equals("절삭");
            boolean shareBack = raise && !shareBackRules.isEmpty() && n > 0;
            List<Integer> named = named(rule, lines);
            List<Integer> targets = !named.isEmpty() ? named : shareBack ? List.of(0) : orAll(named, n);
            long diff = 0;
            for (int i : targets) {
                long next = round(fee[i], unit, mode);
                if (next != fee[i]) {
                    reasons.get(i).add(String.format("%,d원 단위 %s (%s)", unit, label, signed(next - fee[i])));
                    diff += next - fee[i];
                    fee[i] = next;
                }
            }
            if (shareBack && diff != 0) {
                boolean asc = shareBackRules.stream().anyMatch(r -> ASC.matcher(r).find());
                shareBack(lines, fee, reasons, targets, diff, label, asc);
            }
        }

        List<Result> result = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            long before = lines.get(i).fee();
            result.add(new Result(fee[i], fee[i] - before,
                    reasons.get(i).isEmpty() ? null : PREFIX + String.join(", ", reasons.get(i))));
        }
        return result;
    }

    /** "차이분 … 실적 … 1원씩 절삭" 처럼 절상 차이분을 다른 기관에서 되돌리는 문장인지 */
    static boolean isShareBack(String rule) {
        return DIFF.matcher(rule).find() && rule.contains("실적") && CUT.matcher(rule).find();
    }

    /** 대상을 뺀 나머지에서 실적이 큰(asc 면 작은) 순서대로 1원씩 빼거나(diff > 0) 더해 합계를 되돌린다 */
    private static void shareBack(List<FeeLine> lines, long[] fee, List<List<String>> reasons, List<Integer> targets,
                                  long diff, String label, boolean asc) {
        Comparator<Integer> byCount = Comparator.comparingLong(i -> lines.get(i).finalCount());
        List<Integer> order = new ArrayList<>();
        for (int i = 0; i < lines.size(); i++) {
            if (!targets.contains(i)) {
                order.add(i);
            }
        }
        order.sort((asc ? byCount : byCount.reversed())
                .thenComparing(i -> lines.get(i).code() == null ? "" : lines.get(i).code())
                .thenComparing(i -> i));
        long[] delta = new long[lines.size()];
        long left = Math.abs(diff);
        long step = diff > 0 ? -1 : 1;
        while (left > 0) {
            boolean moved = false;
            for (int i : order) {
                if (left == 0) {
                    break;
                }
                if (step < 0 && fee[i] <= 0) {
                    continue;
                }
                fee[i] += step;
                delta[i] += step;
                left--;
                moved = true;
            }
            if (!moved) {
                break;
            }
        }
        String what = label + " 차이분 실적순 " + (step < 0 ? "절삭" : "가산");
        for (int i : order) {
            if (delta[i] != 0) {
                reasons.get(i).add(what + " (" + signed(delta[i]) + ")");
            }
        }
    }

    /** 문장에 이름·별칭이 나온 기관 (더 긴 이름 안에 든 별칭은 뺀다: '하나온은행' 안의 '하나') */
    static List<Integer> named(String rule, List<FeeLine> lines) {
        List<String> found = new ArrayList<>();
        List<Integer> idx = new ArrayList<>();
        for (int i = 0; i < lines.size(); i++) {
            FeeLine l = lines.get(i);
            String hit = rule.contains(l.name()) ? l.name()
                    : l.aliases().stream().filter(rule::contains).max(Comparator.comparingInt(String::length)).orElse(null);
            if (hit != null) {
                found.add(hit);
                idx.add(i);
            }
        }
        List<Integer> result = new ArrayList<>();
        for (int k = 0; k < idx.size(); k++) {
            String h = found.get(k);
            boolean inside = false;
            for (int j = 0; j < found.size(); j++) {
                if (j != k && found.get(j).length() > h.length() && found.get(j).contains(h)) {
                    inside = true;
                }
            }
            if (!inside) {
                result.add(idx.get(k));
            }
        }
        return result;
    }

    private static List<Integer> orAll(List<Integer> named, int n) {
        if (!named.isEmpty()) {
            return named;
        }
        List<Integer> all = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            all.add(i);
        }
        return all;
    }

    static long round(long fee, long unit, String mode) {
        return switch (mode) {
            case "절상", "올림" -> Math.floorDiv(fee + unit - 1, unit) * unit;
            case "반올림" -> Math.floorDiv(fee + unit / 2, unit) * unit;
            default -> Math.floorDiv(fee, unit) * unit;
        };
    }

    private static String label(String mode) {
        return switch (mode) {
            case "올림" -> "절상";
            case "버림", "내림" -> "절사";
            default -> mode;
        };
    }

    public static String signed(long d) {
        return (d > 0 ? "+" : "-") + String.format("%,d원", Math.abs(d));
    }

    /** "50만원", "1억 2,000만원", "900,000원" → 원 */
    public static long parseAmount(String text) {
        Matcher m = Pattern.compile("(\\d[\\d,]*(?:\\.\\d+)?)\\s*(억|만|천)?").matcher(text);
        double total = 0;
        while (m.find()) {
            double v = Double.parseDouble(m.group(1).replace(",", ""));
            String u = m.group(2);
            total += v * (u == null ? 1 : switch (u) {
                case "억" -> 100_000_000;
                case "만" -> 10_000;
                default -> 1_000;
            });
        }
        return Math.round(total);
    }
}
