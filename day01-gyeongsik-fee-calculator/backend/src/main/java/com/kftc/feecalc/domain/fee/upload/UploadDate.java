package com.kftc.feecalc.domain.fee.upload;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 엑셀 날짜 칸 값 → 일·월·분기 단위 날짜. 년월만 있어도 읽는다. 프론트 utils/upload.js 의 parseUploadDate 와 같은 규칙이다.
 * <ul>
 *   <li>날짜 서식 칸(LocalDate) → 일</li>
 *   <li>숫자 202607 → 월, 20260715 → 일 (날짜 열로 판별된 칸에서만)</li>
 *   <li>문자 2026-07, 2026.07, 2026/7, 2026년 7월, 202607 → 월 / 2026-07-15, 2026년 7월 15일, 20260715 → 일</li>
 *   <li>문자 2026년 3분기, 2026 Q3, 2026-3Q → 분기</li>
 * </ul>
 */
public record UploadDate(String key, Unit unit, LocalDate start, LocalDate end) {

    public enum Unit {
        DAY, MONTH, QUARTER
    }

    private static final Pattern QUARTER = Pattern.compile(
            "^(\\d{4})\\s*년?\\s*[-./]?\\s*(?:([1-4])\\s*분기|[Qq]([1-4])|([1-4])[Qq])$");
    private static final Pattern YMD = Pattern.compile("^(\\d{4})-(\\d{1,2})(?:-(\\d{1,2}))?$");
    private static final Pattern COMPACT = Pattern.compile("^(\\d{4})(\\d{2})(\\d{2})?$");
    // 제목 문장 안의 날짜: 분기 먼저, 없으면 년월
    private static final Pattern FIND_QUARTER = Pattern.compile("(\\d{4})\\s*년?\\s*(?:([1-4])\\s*분기|[Qq]([1-4]))");
    private static final Pattern FIND_MONTH = Pattern.compile("(\\d{4})\\s*(?:[-./]|년)\\s*(\\d{1,2})(?!\\d)");

    /** 칸 값을 날짜로. 읽지 못하면 null */
    public static UploadDate parse(Object value) {
        if (value instanceof LocalDate d) {
            return day(d);
        }
        if (value instanceof Double n) {
            return n == Math.floor(n) && !n.isInfinite() ? parseText(String.valueOf(n.longValue())) : null;
        }
        return value instanceof String s ? parseText(s) : null;
    }

    static UploadDate parseText(String raw) {
        String t = raw.strip().replaceAll("\\s+\\d{1,2}:\\d{2}(:\\d{2})?$", "");
        if (t.isEmpty()) {
            return null;
        }
        Matcher q = QUARTER.matcher(t);
        if (q.matches()) {
            String n = q.group(2) != null ? q.group(2) : q.group(3) != null ? q.group(3) : q.group(4);
            return quarter(Integer.parseInt(q.group(1)), Integer.parseInt(n));
        }
        String n = t.replaceAll("[년월./]", "-").replace("일", "").replaceAll("\\s+", "").replaceAll("-+$", "");
        Matcher m = YMD.matcher(n);
        if (!m.matches()) {
            m = COMPACT.matcher(n);
            if (!m.matches()) {
                return null;
            }
        }
        int year = Integer.parseInt(m.group(1));
        int month = Integer.parseInt(m.group(2));
        if (year < 1900 || year > 2100 || month < 1 || month > 12) {
            return null;
        }
        if (m.group(3) == null) {
            return month(year, month);
        }
        try {
            return day(LocalDate.of(year, month, Integer.parseInt(m.group(3))));
        } catch (DateTimeException e) {
            return null;
        }
    }

    /** 제목 문장(예: "2026년 3분기 실적")에서 날짜를 찾는다. 없으면 null */
    public static UploadDate find(String text) {
        if (text == null) {
            return null;
        }
        Matcher q = FIND_QUARTER.matcher(text);
        if (q.find()) {
            return quarter(Integer.parseInt(q.group(1)), Integer.parseInt(q.group(2) != null ? q.group(2) : q.group(3)));
        }
        Matcher m = FIND_MONTH.matcher(text);
        while (m.find()) {
            int year = Integer.parseInt(m.group(1));
            int month = Integer.parseInt(m.group(2));
            if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12) {
                return month(year, month);
            }
        }
        return null;
    }

    /** 산출 기간과 겹치면 true (월·분기 단위는 기간과 겹치는 달·분기를 포함) */
    public boolean overlaps(LocalDate from, LocalDate to) {
        return !start.isAfter(to) && !end.isBefore(from);
    }

    private static UploadDate day(LocalDate d) {
        return new UploadDate(d.toString(), Unit.DAY, d, d);
    }

    private static UploadDate month(int year, int month) {
        LocalDate s = LocalDate.of(year, month, 1);
        return new UploadDate(String.format("%04d-%02d", year, month), Unit.MONTH, s, s.plusMonths(1).minusDays(1));
    }

    private static UploadDate quarter(int year, int q) {
        LocalDate s = LocalDate.of(year, (q - 1) * 3 + 1, 1);
        return new UploadDate(year + "년 " + q + "분기", Unit.QUARTER, s, s.plusMonths(3).minusDays(1));
    }
}
