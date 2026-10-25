package com.kftc.feecalc.domain.fee.service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 2단계 정산의 Step 2: skill.md "## 4. 최종 정산 특이사항"을 1차 계산 결과(수식 + 원 단위 배분)에 적용한다.
 * 두 부분으로 나뉜다.
 * <ol>
 *   <li>해석: 문장 → 보정 동작({@link SpecialAction}) 목록. 서버는 AI({@code SpecialRuleInterpreter})가 하고, 키가 없거나
 *       AI 가 실패하면 이 클래스의 규칙 기반 {@link #interpret}가 한다. AI 가 만든 동작은 {@link #validate}(허용 목록)를 통과해야 쓴다</li>
 *   <li>실행: {@link #execute}가 동작대로 금액을 계산한다 (결정적, AI 를 쓰지 않음)</li>
 * </ol>
 * 프론트 src/utils/specialRules.js 와 같은 규칙이다. 규칙 기반 해석기가 알아듣는 문장:
 * <ol>
 *   <li>"최저/최소/최고/최대 (회비|금액|한도) N원": 상하한. 문장에 기관 이름·별칭이 있으면 그 기관만, 없으면 전체</li>
 *   <li>"N원 단위로 절상(올림·반올림)" + 섹션 안에 "차이분(차액·초과액)은 … 실적 … 1원씩 절삭(차감)" 문장이 있으면:
 *       절상 대상(문장에 기관이 있으면 그 기관, 없으면 첫 번째 기관)을 N원 단위로 올리고, 늘어난 금액만큼 나머지 기관을
 *       최종 인정 실적이 큰 순서(동률이면 기관코드 순)대로 1원씩 깎아 합계를 유지한다. "작은 순"이면 실적이 작은 순서</li>
 *   <li>"N원 미만 절사(절삭·버림·내림)": 대상(없으면 전체)을 N원 단위로 버린다. 합계는 줄어든다.
 *       차이분 문장이 없는 절상·반올림도 대상(없으면 전체)만 바꾼다</li>
 * </ol>
 * 상하한이 끝전 처리보다 먼저 실행된다.
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

    /** 해석 결과: 보정 동작과, 어떤 동작으로도 바꾸지 못한 문장 */
    public record Interpretation(List<SpecialAction> actions, List<String> unsupported) {
    }

    public static final String PREFIX = "특이사항 반영: ";
    public static final int MAX_ACTIONS = 20;
    public static final long MAX_UNIT = 100_000_000L;
    public static final long MAX_AMOUNT = 1_000_000_000_000L;

    public static final String AMOUNT = "\\d[\\d,]*(?:\\.\\d+)?\\s*(?:억|만|천)?(?:\\s*\\d[\\d,]*\\s*(?:만|천))?\\s*원";
    private static final Pattern ROUNDING = Pattern.compile(
            "(\\d[\\d,]*)\\s*원\\s*(?:단위|미만)\\s*(?:로|으로|에서)?\\s*(반올림|절상|올림|절사|절삭|버림|내림)");
    private static final Pattern CLAMP = Pattern.compile("(최저|최소|최고|최대)\\s*(?:회비|금액|한도)?\\s*(?:는|은)?\\s*(" + AMOUNT + ")");
    private static final Pattern DIFF = Pattern.compile("차이|차액|초과");
    private static final Pattern CUT = Pattern.compile("절삭|차감|1원씩");
    private static final Pattern ASC = Pattern.compile("(작은|적은)\\s*(순|기관)");

    /** 규칙 기반 해석 + 실행 (AI 를 쓰지 않는 경로, 테스트·시연 산출용) */
    public static List<Result> apply(String specialRules, List<FeeLine> lines) {
        return execute(interpret(specialRules, lines).actions(), lines);
    }

    /** 규칙 기반 해석기: 문장의 낱말(금액·단위·절상/절사·기관명)로 보정 동작을 만든다 */
    public static Interpretation interpret(String specialRules, List<FeeLine> lines) {
        int n = lines.size();
        List<String> rules = SkillEngineService.lines(specialRules);
        List<String> shareBackRules = rules.stream().filter(SpecialRulePostProcessor::isShareBack).toList();
        boolean asc = shareBackRules.stream().anyMatch(r -> ASC.matcher(r).find());
        boolean[] used = new boolean[rules.size()];
        List<SpecialAction> actions = new ArrayList<>();

        // 1) 최저·최고 회비
        for (int k = 0; k < rules.size(); k++) {
            String rule = rules.get(k);
            Matcher m = CLAMP.matcher(rule);
            while (m.find()) {
                List<String> names = names(rule, lines);
                actions.add(SpecialAction.clamp(m.group(1).equals("최저") || m.group(1).equals("최소"), parseAmount(m.group(2)),
                        names.isEmpty() ? SpecialAction.Target.ALL : SpecialAction.Target.NAMED, names, rule));
                used[k] = true;
            }
        }

        // 2) 원 단위 절상(+ 차이분 실적순 1원 절삭)·절사·반올림
        boolean sharedBack = false;
        for (int k = 0; k < rules.size(); k++) {
            String rule = rules.get(k);
            Matcher m = ROUNDING.matcher(rule);
            if (!m.find()) {
                continue;
            }
            long unit = Long.parseLong(m.group(1).replace(",", ""));
            if (unit <= 1 || unit > MAX_UNIT) {
                continue;
            }
            SpecialAction.Rounding rounding = switch (m.group(2)) {
                case "절상", "올림" -> SpecialAction.Rounding.UP;
                case "반올림" -> SpecialAction.Rounding.HALF_UP;
                default -> SpecialAction.Rounding.DOWN;
            };
            boolean shareBack = rounding != SpecialAction.Rounding.DOWN && !shareBackRules.isEmpty() && n > 0;
            List<String> names = names(rule, lines);
            SpecialAction.Target target = !names.isEmpty() ? SpecialAction.Target.NAMED
                    : shareBack ? SpecialAction.Target.FIRST : SpecialAction.Target.ALL;
            actions.add(SpecialAction.round(unit, rounding, target, names,
                    !shareBack ? SpecialAction.Redistribute.NONE
                            : asc ? SpecialAction.Redistribute.PERF_ASC : SpecialAction.Redistribute.PERF_DESC,
                    rule));
            used[k] = true;
            sharedBack |= shareBack;
        }

        List<String> unsupported = new ArrayList<>();
        for (int k = 0; k < rules.size(); k++) {
            if (!used[k] && !(sharedBack && isShareBack(rules.get(k)))) {
                unsupported.add(rules.get(k));
            }
        }
        return new Interpretation(actions, unsupported);
    }

    /**
     * AI 가 만든 동작을 허용 목록으로 검사해 다듬는다. 종류·단위·금액·대상이 범위를 벗어나거나 기관을 찾을 수 없으면
     * IllegalArgumentException. 상하한을 끝전 처리보다 앞에 둔다 (같은 종류끼리는 순서 유지)
     */
    public static List<SpecialAction> validate(List<SpecialAction> actions, List<FeeLine> lines) {
        if (actions.size() > MAX_ACTIONS) {
            throw new IllegalArgumentException("보정 동작이 너무 많습니다 (최대 " + MAX_ACTIONS + "개).");
        }
        List<SpecialAction> clamps = new ArrayList<>();
        List<SpecialAction> rounds = new ArrayList<>();
        for (SpecialAction a : actions) {
            if (a.type() == null) {
                throw new IllegalArgumentException("보정 종류(type)가 없습니다.");
            }
            List<String> institutions = a.institutions() == null ? List.of()
                    : a.institutions().stream().filter(s -> s != null && !s.isBlank()).map(String::strip).distinct().toList();
            SpecialAction.Target target = a.target() != null ? a.target()
                    : institutions.isEmpty() ? SpecialAction.Target.ALL : SpecialAction.Target.NAMED;
            if (target == SpecialAction.Target.NAMED) {
                if (institutions.isEmpty() || institutions.size() > 50) {
                    throw new IllegalArgumentException("지정 기관(institutions)이 비었거나 너무 많습니다.");
                }
                for (String name : institutions) {
                    if (indexOf(name, lines) < 0) {
                        throw new IllegalArgumentException("산출 대상에 없는 기관입니다: " + name);
                    }
                }
            } else {
                institutions = List.of();
            }
            String rule = a.rule() == null ? "" : a.rule().strip();
            rule = rule.length() > 300 ? rule.substring(0, 300) : rule;
            SpecialAction.Redistribute redistribute = a.redistribute() == null ? SpecialAction.Redistribute.NONE : a.redistribute();
            if (a.type() == SpecialAction.Type.ROUND) {
                if (a.unit() == null || a.unit() < 2 || a.unit() > MAX_UNIT || a.rounding() == null) {
                    throw new IllegalArgumentException("끝전 처리 단위(unit) 또는 방식(rounding)이 올바르지 않습니다.");
                }
                rounds.add(SpecialAction.round(a.unit(), a.rounding(), target, institutions, redistribute, rule));
            } else {
                if (a.amount() == null || a.amount() < 0 || a.amount() > MAX_AMOUNT) {
                    throw new IllegalArgumentException("최저·최고 회비 금액(amount)이 올바르지 않습니다.");
                }
                if (redistribute != SpecialAction.Redistribute.NONE) {
                    throw new IllegalArgumentException("최저·최고 회비에는 차이분 배분(redistribute)을 쓸 수 없습니다.");
                }
                clamps.add(SpecialAction.clamp(a.type() == SpecialAction.Type.MIN_FEE, a.amount(), target, institutions, rule));
            }
        }
        List<SpecialAction> result = new ArrayList<>(clamps);
        result.addAll(rounds);
        return result;
    }

    /** 보정 동작을 차례로 실행한다 (결정적). lines 와 같은 순서로 결과를 돌려준다 */
    public static List<Result> execute(List<SpecialAction> actions, List<FeeLine> lines) {
        int n = lines.size();
        long[] fee = lines.stream().mapToLong(FeeLine::fee).toArray();
        List<List<String>> reasons = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            reasons.add(new ArrayList<>());
        }
        for (SpecialAction a : actions) {
            List<Integer> targets = targets(a, lines);
            if (a.type() != SpecialAction.Type.ROUND) {
                boolean min = a.type() == SpecialAction.Type.MIN_FEE;
                for (int i : targets) {
                    long next = min ? Math.max(fee[i], a.amount()) : Math.min(fee[i], a.amount());
                    if (next != fee[i]) {
                        reasons.get(i).add(String.format("%s 회비 %,d원 적용 (%s)", min ? "최저" : "최고", a.amount(), signed(next - fee[i])));
                        fee[i] = next;
                    }
                }
                continue;
            }
            long diff = 0;
            for (int i : targets) {
                long next = round(fee[i], a.unit(), a.rounding());
                if (next != fee[i]) {
                    reasons.get(i).add(String.format("%,d원 단위 %s (%s)", a.unit(), a.roundingLabel(), signed(next - fee[i])));
                    diff += next - fee[i];
                    fee[i] = next;
                }
            }
            if (a.redistribute() != SpecialAction.Redistribute.NONE && diff != 0) {
                shareBack(lines, fee, reasons, targets, diff, a.roundingLabel(), a.redistribute() == SpecialAction.Redistribute.PERF_ASC);
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

    private static List<Integer> targets(SpecialAction a, List<FeeLine> lines) {
        List<Integer> idx = new ArrayList<>();
        switch (a.target()) {
            case FIRST -> {
                if (!lines.isEmpty()) {
                    idx.add(0);
                }
            }
            case NAMED -> a.institutions().forEach(name -> {
                int i = indexOf(name, lines);
                if (i >= 0 && !idx.contains(i)) {
                    idx.add(i);
                }
            });
            default -> {
                for (int i = 0; i < lines.size(); i++) {
                    idx.add(i);
                }
            }
        }
        return idx;
    }

    /** 기관명·기관 ID·기관코드가 같거나 별칭에 든 행 (없으면 -1) */
    static int indexOf(String name, List<FeeLine> lines) {
        for (int i = 0; i < lines.size(); i++) {
            FeeLine l = lines.get(i);
            if (name.equals(l.name()) || name.equals(l.institutionId()) || name.equals(l.code())) {
                return i;
            }
        }
        for (int i = 0; i < lines.size(); i++) {
            if (lines.get(i).aliases().contains(name)) {
                return i;
            }
        }
        return -1;
    }

    private static List<String> names(String rule, List<FeeLine> lines) {
        return named(rule, lines).stream().map(i -> lines.get(i).name()).toList();
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

    static long round(long fee, long unit, SpecialAction.Rounding rounding) {
        return switch (rounding) {
            case UP -> Math.floorDiv(fee + unit - 1, unit) * unit;
            case HALF_UP -> Math.floorDiv(fee + unit / 2, unit) * unit;
            case DOWN -> Math.floorDiv(fee, unit) * unit;
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
