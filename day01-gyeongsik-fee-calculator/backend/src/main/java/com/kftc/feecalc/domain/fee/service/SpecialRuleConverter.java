package com.kftc.feecalc.domain.fee.service;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * "## 4. 최종 정산 특이사항"의 자연어 문장을 후처리 스크립트({@link PostprocessScript})로 바꾸는 내장 변환기.
 * AI 키가 없거나 AI 결과가 검증을 통과하지 못할 때, 그리고 서버 미연결(Mock) 브라우저에서 쓴다
 * (프론트 src/utils/postprocess.js convertSpecialRules 와 같은 규칙). 알아듣는 문장:
 * <ul>
 *   <li>"소수점 … 반올림" → roundHalf(equal) · roundHalf(perf). 없으면 allocate(fee)</li>
 *   <li>"최저/최소/최고/최대 (회비|금액|한도) N원" → min/max(fee, N[, "기관명"])</li>
 *   <li>"균등(실적)분담 … N% … 목표|총액|합계 … 보정|맞|일치|유지" → fixSum(equal|perf, N%, over=…, under=…)</li>
 *   <li>"N원 단위로 절상·올림·절사·절삭·버림·내림·반올림" → roundUp/Down/Half(fee, N[, "기관명"|first])
 *       (같은 섹션에 "차이분·증액분 … 실적 … 1원씩 절삭·차감" 문장이 있으면 first 대상 + spreadDiff)</li>
 *   <li>"총액은 변하지 않" → assert sum(fee) == before, "0원 이상" → assert all(fee >= 0)</li>
 * </ul>
 */
public final class SpecialRuleConverter {

    private SpecialRuleConverter() {
    }

    public record Converted(String script, List<String> steps, List<String> unsupported) {
    }

    /** 기관 이름과 별칭 (문장 속 기관명 찾기용) */
    public record Institution(String name, List<String> aliases) {
    }

    public static final String AMOUNT = "\\d[\\d,]*(?:\\.\\d+)?\\s*(?:억|만|천)?(?:\\s*\\d[\\d,]*\\s*(?:만|천))?\\s*원";
    private static final Pattern ROUNDING = Pattern.compile(
            "(\\d[\\d,]*)\\s*원\\s*(?:단위|미만)\\s*(?:로|으로|에서)?\\s*(반올림|절상|올림|절사|절삭|버림|내림)");
    private static final Pattern CLAMP = Pattern.compile("(최저|최소|최고|최대)\\s*(?:회비|금액|한도)?\\s*(?:는|은)?\\s*(" + AMOUNT + ")");
    private static final Pattern FIX_SUM = Pattern.compile("(균등|실적)\\S*[^\\n]*?(\\d+(?:\\.\\d+)?)\\s*%[^\\n]*?(목표|총액|합계)");
    private static final Pattern DIFF = Pattern.compile("차이|차액|초과|증액|증가");
    private static final Pattern CUT = Pattern.compile("절삭|차감|1원씩");
    private static final Pattern ASC = Pattern.compile("(작은|적은)\\s*(순|기관)");
    private static final Pattern HALF_EACH = Pattern.compile("소수점?[^\\n]*반올림");
    private static final Pattern OVER = Pattern.compile("(큰|많은)\\s*(기관|경우)[^\\n]*(감액|차감|빼)");
    private static final Pattern UNDER = Pattern.compile("(작은|적은)\\s*(기관|경우)[^\\n]*(증액|가산|더)");
    private static final Pattern KEEP_TOTAL = Pattern.compile("총액[^\\n]*(변하지|변동|유지)|합계\\s*=\\s*총액");
    private static final Pattern NON_NEGATIVE = Pattern.compile("0\\s*원\\s*이상");
    private static final Pattern ADD_TO_EQUAL = Pattern.compile("균등[^\\n]*가산");
    private static final Pattern NOISE = Pattern.compile("^\\[.*\\]$|기관코드\\s*(오름차순|순)|정수|검증|반복");

    public static Converted convert(String specialRules, List<Institution> institutions) {
        List<String> rules = SkillEngineService.lines(specialRules);
        List<String> script = new ArrayList<>();
        List<String> steps = new ArrayList<>();
        List<String> asserts = new ArrayList<>();
        boolean[] used = new boolean[rules.size()];
        String all = String.join("\n", rules);
        boolean perfOrder = all.contains("실적분담");

        // 0) 정수화
        int halfLine = indexOf(rules, HALF_EACH);
        if (halfLine >= 0) {
            script.add("roundHalf(equal)");
            script.add("roundHalf(perf)");
            steps.add("'" + rules.get(halfLine) + "' → 균등분담분·실적분담분을 각각 원 단위로 반올림: roundHalf(equal), roundHalf(perf)");
            used[halfLine] = true;
        } else {
            script.add("allocate(fee)");
            steps.add("회비를 원 단위로 배분(최대잔여법): allocate(fee)");
        }

        // 1) 최저·최고
        for (int k = 0; k < rules.size(); k++) {
            Matcher m = CLAMP.matcher(rules.get(k));
            while (m.find()) {
                boolean min = m.group(1).equals("최저") || m.group(1).equals("최소");
                List<String> names = named(rules.get(k), institutions);
                script.add((min ? "min" : "max") + "(fee, " + parseAmount(m.group(2)) + quoted(names) + ")");
                steps.add("'" + rules.get(k) + "' → " + (min ? "최저" : "최고") + " 회비 " + String.format("%,d", parseAmount(m.group(2))) + "원"
                        + (names.isEmpty() ? " (전체 기관)" : " (" + String.join("·", names) + ")"));
                used[k] = true;
            }
        }

        // 2) 합계 목표 보정
        for (int k = 0; k < rules.size(); k++) {
            Matcher m = FIX_SUM.matcher(rules.get(k));
            if (!m.find() || rules.get(k).contains("=")) {
                continue;
            }
            String comp = m.group(1).equals("균등") ? "equal" : "perf";
            String pct = m.group(2);
            String desc = perfOrder ? "perfDesc" : "countDesc";
            String asc = perfOrder ? "perfAsc" : "countAsc";
            script.add("fixSum(" + comp + ", " + pct + "%, over=" + desc + ", under=" + asc + ")");
            steps.add("'" + rules.get(k) + "' → " + (comp.equals("equal") ? "균등분담분" : "실적분담분") + " 합계를 총액의 " + pct
                    + "%에 맞춤 (초과면 " + (perfOrder ? "실적분담분" : "인정 건수") + " 큰 기관부터 1원씩 감액, 미달이면 작은 기관부터 1원씩 증액)");
            asserts.add("assert sum(" + comp + ") == " + pct + "%");
            used[k] = true;
            break;
        }
        for (int k = 0; k < rules.size(); k++) {
            if (OVER.matcher(rules.get(k)).find() || UNDER.matcher(rules.get(k)).find()) {
                used[k] = true;
            }
        }

        // 3) 끝전 처리 (+ 차이분 되돌리기)
        List<Integer> shareBackLines = new ArrayList<>();
        for (int k = 0; k < rules.size(); k++) {
            if (isShareBack(rules.get(k))) {
                shareBackLines.add(k);
            }
        }
        boolean shareBack = false;
        for (int k = 0; k < rules.size(); k++) {
            Matcher m = ROUNDING.matcher(rules.get(k));
            if (!m.find()) {
                continue;
            }
            long unit = Long.parseLong(m.group(1).replace(",", ""));
            if (unit <= 1 || unit > PostprocessScript.MAX_UNIT) {
                continue;
            }
            String mode = m.group(2);
            String fn = switch (mode) {
                case "절상", "올림" -> "roundUp";
                case "반올림" -> "roundHalf";
                default -> "roundDown";
            };
            boolean raise = !fn.equals("roundDown");
            boolean sb = raise && !shareBackLines.isEmpty();
            List<String> names = named(rules.get(k), institutions);
            String target = !names.isEmpty() ? quoted(names) : sb ? ", first" : "";
            String addTo = ADD_TO_EQUAL.matcher(all).find() ? ", addTo=equal" : "";
            script.add(fn + "(fee, " + unit + target + addTo + ")");
            String who = !names.isEmpty() ? String.join("·", names) : sb ? "첫 번째 기관" : "전체 기관";
            steps.add("'" + rules.get(k) + "' → " + who + " 회비를 " + unit + "원 단위로 " + PostprocessEngine.label(
                    fn.equals("roundUp") ? PostprocessScript.Rounding.UP : fn.equals("roundHalf") ? PostprocessScript.Rounding.HALF_UP : PostprocessScript.Rounding.DOWN)
                    + (addTo.isEmpty() ? " (차이는 실적분담분에)" : " (차이는 균등분담분에)"));
            used[k] = true;
            if (!names.isEmpty()) {
                asserts.add("assert fee(\"" + names.get(0) + "\") % " + unit + " == 0");
            }
            if (sb) {
                boolean asc = shareBackLines.stream().anyMatch(i -> ASC.matcher(rules.get(i)).find());
                String order = perfOrder ? (asc ? "perfAsc" : "perfDesc") : (asc ? "countAsc" : "countDesc");
                script.add("spreadDiff(perf, others, " + order + ")");
                steps.add("'" + rules.get(shareBackLines.get(0)) + "' → 늘어난 금액만큼 나머지 기관의 실적분담분을 "
                        + (perfOrder ? "실적분담분" : "인정 건수") + "가 " + (asc ? "작은" : "큰") + " 순서대로 1원씩 차감 (합계 유지)");
                shareBack = true;
            }
        }
        if (shareBack) {
            for (int i : shareBackLines) {
                used[i] = true;
            }
            asserts.add("assert sum(fee) == before");
        }

        // 4) 검증 문장
        for (int k = 0; k < rules.size(); k++) {
            String r = rules.get(k);
            if (KEEP_TOTAL.matcher(r).find()) {
                if (!asserts.contains("assert sum(fee) == before")) {
                    asserts.add("assert sum(fee) == before");
                }
                used[k] = true;
            }
            if (NON_NEGATIVE.matcher(r).find()) {
                used[k] = true;
            }
            if (r.contains("가산") && (r.contains("증액") || r.contains("증가"))) {
                used[k] = true; // "증액분은 … 실적분담회비에 가산" (addTo 로 반영)
            }
            if (r.contains("일의 자리") && r.contains("0")) {
                used[k] = true; // "일의 자리 = 0원" (끝전 처리 검증으로 반영)
            }
            if (r.contains("=") && FIX_SUM.matcher(r).find()) {
                used[k] = true; // "균등분담회비 합계 = 전체 회비의 25%" (fixSum 검증으로 반영)
            }
            if (NOISE.matcher(r).find()) {
                used[k] = true;
            }
        }
        if (!asserts.contains("assert all(fee >= 0)")) {
            asserts.add("assert all(fee >= 0)");
        }
        script.addAll(asserts);
        steps.add("검증: " + String.join(" · ", asserts.stream().map(a -> a.substring(7)).toList()));

        List<String> unsupported = new ArrayList<>();
        for (int k = 0; k < rules.size(); k++) {
            if (!used[k]) {
                unsupported.add(rules.get(k));
            }
        }
        return new Converted(String.join("\n", script), steps, unsupported);
    }

    static boolean isShareBack(String rule) {
        return DIFF.matcher(rule).find() && rule.contains("실적") && CUT.matcher(rule).find();
    }

    private static int indexOf(List<String> rules, Pattern p) {
        for (int i = 0; i < rules.size(); i++) {
            if (p.matcher(rules.get(i)).find()) {
                return i;
            }
        }
        return -1;
    }

    private static String quoted(List<String> names) {
        StringBuilder sb = new StringBuilder();
        for (String n : names) {
            sb.append(", \"").append(n).append('"');
        }
        return sb.toString();
    }

    /** 문장에 이름·별칭이 나온 기관의 이름 (더 긴 이름 안에 든 별칭은 뺀다: '하나온은행' 안의 '하나') */
    public static List<String> named(String rule, List<Institution> institutions) {
        List<String> found = new ArrayList<>();
        List<String> names = new ArrayList<>();
        for (Institution inst : institutions) {
            String hit = rule.contains(inst.name()) ? inst.name()
                    : inst.aliases().stream().filter(rule::contains).max(java.util.Comparator.comparingInt(String::length)).orElse(null);
            if (hit != null) {
                found.add(hit);
                names.add(inst.name());
            }
        }
        List<String> result = new ArrayList<>();
        for (int k = 0; k < names.size(); k++) {
            String h = found.get(k);
            boolean inside = false;
            for (int j = 0; j < found.size(); j++) {
                if (j != k && found.get(j).length() > h.length() && found.get(j).contains(h)) {
                    inside = true;
                }
            }
            if (!inside && !result.contains(names.get(k))) {
                result.add(names.get(k));
            }
        }
        return result;
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
