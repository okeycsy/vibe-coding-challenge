package com.kftc.feecalc.domain.fee.ai;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AI 키가 없거나 AI 호출이 실패했을 때 쓰는 규칙 기반(Rule-based) 해석. 정해진 한국어 표현만 알아듣는다.
 * 프론트 src/utils/aiRules.js 와 같은 규칙이다 (서버 미연결 Mock 모드에서 같은 결과가 나오도록).
 * <ul>
 *   <li>이슈 판별: "## 2. AI 예외 차감 지침"에서 "차감하지 않는다 / 차감 대상이 아니다 / 차감 제외" 줄의 핵심 낱말이
 *       이슈 문장에 절반 이상 들어 있으면 차감에서 뺀다.</li>
 *   <li>최종 보정: "## 1. 비즈니스 규칙 요약"의 "최저/최고 회비 N원", "(기관) N원 단위 절상/절사/반올림",
 *       "차이분은 실적 큰 순서대로 1원씩" 문장을 1차 회비에 적용한다.</li>
 * </ul>
 */
public final class RuleBasedFeeRules {

    private RuleBasedFeeRules() {
    }

    /** 최종 보정 입력: 기관별 1차 산출 결과 */
    public record FeeLine(String institutionId, String name, List<String> aliases, long finalCount, long primaryFee) {
    }

    /** 최종 보정 결과. reason 이 null 이면 보정 없음 */
    public record Adjustment(long finalFee, String reason) {
    }

    // ---------- Step A: 이슈 차감 판별 ----------

    private static final Pattern EXCLUDE = Pattern.compile("차감하지\\s*않|차감\\s*대상이\\s*아니|차감에서\\s*제외|차감\\s*제외");
    private static final Pattern SUBJECT_END = Pattern.compile("(건은|건도|경우|이므로|하므로|므로)");
    private static final List<String> SUFFIXES = List.of("에서", "으로", "하는", "한", "된", "로", "은", "는", "이", "가",
            "을", "를", "의", "도", "에", "과", "와");
    private static final Set<String> STOPWORDS = Set.of("건", "기관", "경우", "등", "같은", "다시", "쪽", "애초에", "정상",
            "거래", "건수", "대상", "처리");

    /** 지침상 차감에서 빼야 하면 근거가 된 지침 줄, 차감 대상이면 null */
    public static String excludedBy(String guide, String issueText) {
        if (guide == null || guide.isBlank() || issueText == null) {
            return null;
        }
        for (String line : lines(guide)) {
            Matcher m = EXCLUDE.matcher(line);
            // "기관명과 건수가 없으면 차감하지 않는다"는 문장 해석기(기관·건수 인식)가 이미 처리한다
            if (!m.find() || line.contains("없으면")) {
                continue;
            }
            List<String> keys = keywords(line.substring(0, m.start()));
            if (keys.isEmpty()) {
                continue;
            }
            long hit = keys.stream().filter(issueText::contains).count();
            if (hit >= Math.max(1, (keys.size() + 1) / 2)) {
                return line;
            }
        }
        return null;
    }

    static List<String> keywords(String clause) {
        Matcher end = SUBJECT_END.matcher(clause);
        String subject = end.find() ? clause.substring(0, end.start()) : clause;
        Set<String> keys = new LinkedHashSet<>();
        for (String raw : subject.split("[\\s·,()\\[\\]/~'\"‘’“”.]+")) {
            String w = stripSuffix(raw.strip());
            if (w.length() >= 2 && !STOPWORDS.contains(w)) {
                keys.add(w);
            }
        }
        return new ArrayList<>(keys);
    }

    private static String stripSuffix(String w) {
        for (String s : SUFFIXES) {
            if (w.endsWith(s) && w.length() - s.length() >= 2) {
                return w.substring(0, w.length() - s.length());
            }
        }
        return w;
    }

    // ---------- Step C: 최종 보정 ----------

    static final String AMOUNT = "\\d[\\d,]*(?:\\.\\d+)?\\s*(?:억|만|천)?(?:\\s*\\d[\\d,]*\\s*(?:만|천))?\\s*원";
    private static final Pattern ROUNDING = Pattern.compile(
            "(\\d[\\d,]*)\\s*원\\s*(?:단위|미만)\\s*(?:로|으로|에서)?\\s*(반올림|절상|올림|절사|절삭|버림|내림)");
    private static final Pattern CLAMP = Pattern.compile("(최저|최소|최고|최대)\\s*(?:회비|금액|한도)?\\s*(?:는|은)?\\s*(" + AMOUNT + ")");
    private static final Pattern SHARE_BACK = Pattern.compile("(차이|차액)");

    public static List<Adjustment> postProcess(String summary, List<FeeLine> lines) {
        int n = lines.size();
        long[] fee = lines.stream().mapToLong(FeeLine::primaryFee).toArray();
        List<List<String>> reasons = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            reasons.add(new ArrayList<>());
        }
        List<String> rules = summary == null ? List.of() : lines(summary);

        // 1) 최저·최고 회비 (수식에 이미 있으면 바뀌는 기관이 없다)
        for (String rule : rules) {
            Matcher m = CLAMP.matcher(rule);
            while (m.find()) {
                long limit = parseAmount(m.group(2));
                boolean min = m.group(1).equals("최저") || m.group(1).equals("최소");
                for (int i : targets(rule, lines)) {
                    long next = min ? Math.max(fee[i], limit) : Math.min(fee[i], limit);
                    if (next != fee[i]) {
                        reasons.get(i).add(String.format("%s 회비 %,d원 적용 (%s)", m.group(1), limit, signed(next - fee[i])));
                        fee[i] = next;
                    }
                }
            }
        }

        // 2) 원 단위 절상·절사·반올림, 3) 차이분 실적순 1원씩 되돌리기
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
            List<Integer> targets = targets(rule, lines);
            long diff = 0;
            for (int i : targets) {
                long next = round(fee[i], unit, mode);
                if (next != fee[i]) {
                    reasons.get(i).add(String.format("%,d원 단위 %s (%s)", unit, label(mode), signed(next - fee[i])));
                    diff += next - fee[i];
                    fee[i] = next;
                }
            }
            if (diff != 0 && SHARE_BACK.matcher(rule).find() && rule.contains("1원씩")) {
                shareBack(rule, lines, fee, reasons, targets, diff, label(mode));
            }
        }

        List<Adjustment> result = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            result.add(new Adjustment(fee[i], reasons.get(i).isEmpty() ? null : "규칙 반영: " + String.join(", ", reasons.get(i))));
        }
        return result;
    }

    /** 대상 기관을 뺀 나머지에서 실적이 큰(또는 작은) 순서대로 1원씩 빼거나(diff > 0) 더해 합계를 되돌린다 */
    private static void shareBack(String rule, List<FeeLine> lines, long[] fee, List<List<String>> reasons,
                                  List<Integer> targets, long diff, String modeLabel) {
        boolean asc = rule.matches(".*(작은|적은)\\s*(순|기관).*");
        Comparator<Integer> byCount = Comparator.comparingLong(i -> lines.get(i).finalCount());
        List<Integer> order = new ArrayList<>();
        for (int i = 0; i < lines.size(); i++) {
            if (!targets.contains(i)) {
                order.add(i);
            }
        }
        order.sort((asc ? byCount : byCount.reversed()).thenComparing(i -> i));
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
        String what = modeLabel + " 차이분 실적순 " + (step < 0 ? "절삭" : "가산");
        for (int i : order) {
            if (delta[i] != 0) {
                reasons.get(i).add(what + " (" + signed(delta[i]) + ")");
            }
        }
    }

    /** 규칙 문장에 이름·별칭이 나온 기관. 하나도 없으면 전체 기관 */
    static List<Integer> targets(String rule, List<FeeLine> lines) {
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
        // '하나온은행'처럼 더 긴 이름 안에 들어 있는 별칭('하나')은 뺀다
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
        if (result.isEmpty()) {
            for (int i = 0; i < lines.size(); i++) {
                result.add(i);
            }
        }
        return result;
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

    static String signed(long d) {
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

    /** 마크다운 목록 줄 → 글머리표를 뗀 문장 목록 */
    static List<String> lines(String text) {
        return Arrays.stream(text.split("\\R"))
                .map(String::strip)
                .filter(l -> !l.isEmpty())
                .map(l -> l.replaceFirst("^([-*]|\\d+\\.)\\s+", ""))
                .toList();
    }
}
