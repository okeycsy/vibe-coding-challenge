package com.kftc.feecalc.domain.fee.upload;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import com.kftc.feecalc.domain.fee.upload.UploadLayout.DateSource;
import com.kftc.feecalc.domain.fee.upload.UploadLayout.SkillInput;
import com.kftc.feecalc.domain.fee.upload.UploadLayout.ValueColumn;

/**
 * 규칙 기반 엑셀 구조 판별 (AI 키가 없거나 AI 가 실패했을 때). 프론트 utils/upload.js 의 detectLayout 과 같은 규칙이다.
 * 시트 앞쪽 30행 안에서 기관 열이 있는 머리글 행을 찾고, 날짜는 날짜 열 → 날짜 머리글(가로형) → 표 위 제목 순으로 찾는다.
 * 기관·날짜가 아닌 수치 열은 모두 값 열(건수·금액 등)로 읽는다.
 */
public final class RuleLayoutDetector {

    static final int MAX_SHEETS = 10;
    static final int HEADER_SCAN_ROWS = 30;
    static final int SAMPLE_ROWS = 30;

    private static final Pattern INST = Pattern.compile("기관|금융회사|회사|은행|참가|업체|거래처");
    private static final Pattern DATE_KEY = Pattern.compile("기준월|년월|연월|일자|날짜|기준일|거래일|기간|월|분기|date|month",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern SKIP = Pattern.compile("코드|순번|번호|연번|^no\\.?$", Pattern.CASE_INSENSITIVE);
    private static final Pattern AMOUNT = Pattern.compile("금액|수수료|요금|\\(원\\)|액$");
    private static final Pattern COUNT = Pattern.compile("건수|건|횟수|실적|조회|이체|count|cnt", Pattern.CASE_INSENSITIVE);
    private static final Pattern PREFER = Pattern.compile("건수|실적");

    private RuleLayoutDetector() {
    }

    public static UploadLayout detect(List<SheetData> sheets) {
        for (int s = 0; s < Math.min(sheets.size(), MAX_SHEETS); s++) {
            SheetData sheet = sheets.get(s);
            for (int r = 0; r < Math.min(sheet.rows().size(), HEADER_SCAN_ROWS); r++) {
                UploadLayout layout = tryHeader(sheet, s, r);
                if (layout != null) {
                    return layout;
                }
            }
        }
        return null;
    }

    private static UploadLayout tryHeader(SheetData sheet, int s, int r) {
        if (sheet.blank(r)) {
            return null;
        }
        List<Integer> data = dataRows(sheet, r);
        if (data.isEmpty()) {
            return null;
        }
        int width = sheet.width();
        int inst = -1;
        int code = -1;
        for (int c = 0; c < width; c++) {
            String h = squash(sheet.text(r, c));
            if (h.isEmpty() || UploadDate.parse(sheet.cell(r, c)) != null) {
                continue;
            }
            if (h.contains("코드")) {
                if (code < 0) {
                    code = c;
                }
            } else if (inst < 0 && INST.matcher(h).find() && textRate(sheet, data, c) >= 0.5) {
                inst = c;
            }
        }
        if (inst < 0) {
            inst = code;
            code = -1;
        }
        if (inst < 0) {
            return null;
        }

        int date = -1;
        for (int c = 0; c < width && date < 0; c++) {
            if (c != inst && c != code && DATE_KEY.matcher(squash(sheet.text(r, c))).find() && dateRate(sheet, data, c, true) >= 0.5) {
                date = c;
            }
        }
        for (int c = 0; c < width && date < 0; c++) {
            if (c != inst && c != code && dateRate(sheet, data, c, false) >= 0.8) {
                date = c;
            }
        }
        if (date >= 0) {
            List<ValueColumn> values = valueColumns(sheet, r, data, columns(inst, code, date));
            return values.isEmpty() ? null
                    : new UploadLayout(s, r, inst, code, DateSource.COLUMN, date, List.of(), null, values);
        }

        // 가로형: 머리글 칸이 날짜 (기관명 | 2026-07 | 2026-08 …)
        List<Integer> headerDates = new ArrayList<>();
        for (int c = 0; c < width; c++) {
            if (c != inst && c != code && UploadDate.parse(sheet.cell(r, c)) != null && numberRate(sheet, data, c) >= 0.5) {
                headerDates.add(c);
            }
        }
        if (!headerDates.isEmpty()) {
            return new UploadLayout(s, r, inst, code, DateSource.HEADER, -1, headerDates, null,
                    List.of(new ValueColumn(-1, "실적", "COUNT", true)));
        }

        // 표 위 제목의 날짜 (예: "2026년 3분기 실적")
        String title = titleDate(sheet, r);
        if (title != null) {
            List<ValueColumn> values = valueColumns(sheet, r, data, columns(inst, code));
            return values.isEmpty() ? null
                    : new UploadLayout(s, r, inst, code, DateSource.TITLE, -1, List.of(), title, values);
        }
        return null;
    }

    /** 머리글 위 행에서 날짜가 들어 있는 첫 문장 */
    public static String titleDate(SheetData sheet, int headerRow) {
        for (int r = 0; r < headerRow; r++) {
            for (Object v : sheet.rows().get(r)) {
                String t = SheetData.text(v);
                if (!t.isEmpty() && UploadDate.find(t) != null) {
                    return t;
                }
            }
        }
        return null;
    }

    /** 머리글 아래 비어 있지 않은 행 (앞쪽 SAMPLE_ROWS 개) */
    static List<Integer> dataRows(SheetData sheet, int headerRow) {
        List<Integer> rows = new ArrayList<>();
        for (int r = headerRow + 1; r < sheet.rows().size() && rows.size() < SAMPLE_ROWS; r++) {
            if (!sheet.blank(r)) {
                rows.add(r);
            }
        }
        return rows;
    }

    static List<ValueColumn> valueColumns(SheetData sheet, int headerRow, List<Integer> data, Set<Integer> exclude) {
        List<ValueColumn> values = new ArrayList<>();
        for (int c = 0; c < sheet.width(); c++) {
            String header = sheet.text(headerRow, c);
            String h = squash(header);
            if (exclude.contains(c) || h.isEmpty() || SKIP.matcher(h).find() || numberRate(sheet, data, c) < 0.5) {
                continue;
            }
            values.add(new ValueColumn(c, header, kind(h), false));
        }
        return defaultUse(values);
    }

    public static String kind(String header) {
        String h = squash(header);
        return AMOUNT.matcher(h).find() ? "AMOUNT" : COUNT.matcher(h).find() ? "COUNT" : "NUMBER";
    }

    /** 실적에 넣을 기본 열: 머리글에 '건수'·'실적'이 있으면 그 열만, 없으면 금액이 아닌 열 모두, 그것도 없으면 전부 (변수는 rawCount) */
    public static List<ValueColumn> defaultUse(List<ValueColumn> values) {
        boolean prefer = values.stream().anyMatch(v -> PREFER.matcher(squash(v.header())).find());
        boolean nonAmount = values.stream().anyMatch(v -> !"AMOUNT".equals(v.kind()));
        return values.stream().map(v -> new ValueColumn(v.index(), v.header(), v.kind(),
                prefer ? PREFER.matcher(squash(v.header())).find() : !nonAmount || !"AMOUNT".equals(v.kind()))).toList();
    }

    /** 머리글·설명을 맞춰 볼 때 떼는 말: 공백·괄호·'건수'·'횟수'·'실적'·'성공'·count 등 */
    private static final Pattern NOISE = Pattern.compile("[\\s()\\[\\]_\\-·,.]|건수|횟수|실적|성공|처리|count|cnt|수$", Pattern.CASE_INSENSITIVE);

    static String key(String text) {
        String t = text == null ? "" : text.toLowerCase();
        String prev;
        do {
            prev = t;
            t = NOISE.matcher(t).replaceAll("");
        } while (!t.equals(prev));
        return t;
    }

    /**
     * 수치 열을 skill.md 실적 입력 변수에 연결한다 (AI 가 없거나 AI 가 정하지 않은 열). 입력이 rawCount 하나뿐이면 {@link #defaultUse} 와 같고,
     * 여럿이면 열 머리글과 입력 설명의 핵심 낱말이 서로 포함되는 쪽으로 연결한다 (가장 길게 맞는 입력, 금액 열은 설명에 '금액'이 있을 때만).
     * 이미 변수가 있는 열은 그대로 둔다. 맞는 열이 없는 입력은 비워 둔다(화면에서 고른다). 프론트 utils/upload.js suggestMapping 과 같은 규칙
     */
    public static List<ValueColumn> assignVariables(List<ValueColumn> values, List<SkillInput> inputs) {
        if (inputs == null || inputs.isEmpty() || inputs.size() == 1 && SkillInput.DEFAULT_NAME.equals(inputs.get(0).name())) {
            return values.stream().anyMatch(ValueColumn::use) ? values : defaultUse(values);
        }
        List<ValueColumn> out = new ArrayList<>();
        for (ValueColumn v : values) {
            if (v.variable() != null) {
                out.add(v);
                continue;
            }
            String h = key(v.header());
            SkillInput best = null;
            int bestScore = 0;
            for (SkillInput in : inputs) {
                String l = key(in.label());
                if (h.isEmpty() || l.isEmpty()) {
                    continue;
                }
                if ("AMOUNT".equals(v.kind()) && !in.label().contains("금액")) {
                    continue;
                }
                int score = h.equals(l) ? 1000 + l.length() : h.contains(l) || l.contains(h) ? Math.min(h.length(), l.length()) : 0;
                if (score > bestScore) {
                    best = in;
                    bestScore = score;
                }
            }
            out.add(v.withVariable(best == null ? null : best.name()));
        }
        // 입력이 하나뿐인데(이름만 다른) 아무 열도 못 맞추면 기본 규칙(건수·실적 열)으로 그 입력에 넣는다
        if (inputs.size() == 1 && out.stream().noneMatch(ValueColumn::use)) {
            String only = inputs.get(0).name();
            return defaultUse(out).stream().map(v -> v.withVariable(v.use() ? only : null)).toList();
        }
        return out;
    }

    static double textRate(SheetData sheet, List<Integer> data, int c) {
        return rate(sheet, data, c, v -> SheetData.number(v) == null && !SheetData.isDateCell(v));
    }

    static double numberRate(SheetData sheet, List<Integer> data, int c) {
        return rate(sheet, data, c, v -> SheetData.number(v) != null);
    }

    /** keyword = 머리글이 날짜처럼 보이는 열이면 숫자(202607)도 날짜로 본다 */
    static double dateRate(SheetData sheet, List<Integer> data, int c, boolean keyword) {
        return rate(sheet, data, c, v -> (keyword || !(v instanceof Double)) && UploadDate.parse(v) != null);
    }

    private static double rate(SheetData sheet, List<Integer> data, int c, java.util.function.Predicate<Object> test) {
        int filled = 0;
        int hit = 0;
        for (int r : data) {
            Object v = sheet.cell(r, c);
            if (SheetData.empty(v)) {
                continue;
            }
            filled++;
            if (test.test(v)) {
                hit++;
            }
        }
        return filled == 0 ? 0 : (double) hit / filled;
    }

    private static Set<Integer> columns(Integer... cs) {
        return new java.util.HashSet<>(List.of(cs));
    }

    static String squash(String s) {
        return s == null ? "" : s.replaceAll("\\s", "");
    }
}
