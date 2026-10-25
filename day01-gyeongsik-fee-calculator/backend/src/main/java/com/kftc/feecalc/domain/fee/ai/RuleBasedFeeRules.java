package com.kftc.feecalc.domain.fee.ai;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AI 키가 없거나 AI 호출이 실패했을 때 쓰는 이슈 차감 판별(Step A)의 규칙 기반(Rule-based) 해석.
 * 프론트 src/utils/aiRules.js 와 같은 규칙이다 (서버 미연결 Mock 모드에서 같은 결과가 나오도록).
 * "## 2. AI 예외 차감 지침"에서 "차감하지 않는다 / 차감 대상이 아니다 / 차감 제외" 줄의 핵심 낱말이
 * 이슈 문장에 절반 이상 들어 있으면 차감에서 뺀다.
 * (1차 계산 뒤 끝전·예외 후처리는 "## 4. 최종 정산 특이사항"을 읽는 {@link com.kftc.feecalc.domain.fee.service.SpecialRulePostProcessor})
 */
public final class RuleBasedFeeRules {

    private RuleBasedFeeRules() {
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

    /** 마크다운 목록 줄 → 글머리표를 뗀 문장 목록 */
    static List<String> lines(String text) {
        return Arrays.stream(text.split("\\R"))
                .map(String::strip)
                .filter(l -> !l.isEmpty())
                .map(l -> l.replaceFirst("^([-*]|\\d+\\.)\\s+", ""))
                .toList();
    }
}
