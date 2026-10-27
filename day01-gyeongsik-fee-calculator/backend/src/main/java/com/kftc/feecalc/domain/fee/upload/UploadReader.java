package com.kftc.feecalc.domain.fee.upload;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.function.Function;
import java.util.regex.Pattern;

import com.kftc.feecalc.domain.fee.upload.UploadLayout.DateSource;
import com.kftc.feecalc.domain.fee.upload.UploadLayout.ValueColumn;

/**
 * 판별한 구조(UploadLayout)대로 행을 읽어 기관별 수치 열 합계를 낸다. 프론트 utils/upload.js 의 readRows 와 같은 규칙이다.
 * <ul>
 *   <li>합계·소계 행과 수치가 하나도 없는 행은 건너뛴다</li>
 *   <li>날짜 칸이 비어 있으면 위 행 날짜를 쓴다(병합 셀). 날짜를 읽지 못한 행은 뺀다(unreadable)</li>
 *   <li>산출 기간(from~to)과 겹치지 않는 날짜의 행은 뺀다(excluded). 월·분기 단위는 기간과 겹치는 달·분기를 넣는다</li>
 *   <li>기관명으로 못 찾으면 기관코드 열로 다시 찾고, 그래도 없으면 unmatched</li>
 * </ul>
 */
public final class UploadReader {

    private static final Pattern TOTAL = Pattern.compile("합계|소계|총계|^계$|^total$", Pattern.CASE_INSENSITIVE);
    private static final int SAMPLE_LIMIT = 5;

    public static final class Excluded {
        public int rows;
        public final long[] values;

        Excluded(int n) {
            values = new long[n];
        }
    }

    /** 읽은 결과. sums 는 기관 → 값 열별 합계 (읽은 순서) */
    public static final class Read<T> {
        public final Map<T, long[]> sums = new LinkedHashMap<>();
        public final Set<String> unmatched = new LinkedHashSet<>();
        public final Map<String, Excluded> excluded = new TreeMap<>();
        public final List<String> unreadableSamples = new ArrayList<>();
        public final Set<String> includedDates = new TreeSet<>();
        public final Set<UploadDate.Unit> units = new LinkedHashSet<>();
        public int rowCount;
        public int unreadableRows;

        public String dateUnit() {
            return units.isEmpty() ? null : units.size() > 1 ? "MIXED" : units.iterator().next().name();
        }
    }

    private UploadReader() {
    }

    public static <T> Read<T> read(SheetData sheet, UploadLayout layout, Function<String, T> matcher, LocalDate from, LocalDate to) {
        Read<T> out = new Read<>();
        boolean header = layout.dateSource() == DateSource.HEADER;
        int n = header ? 1 : layout.valueColumns().size();
        UploadDate title = layout.dateSource() == DateSource.TITLE ? UploadDate.find(layout.titleText()) : null;
        UploadDate last = null;
        for (int r = layout.headerRow() + 1; r < sheet.rows().size(); r++) {
            if (sheet.blank(r)) {
                continue;
            }
            String inst = sheet.text(r, layout.institutionColumn());
            String code = layout.codeColumn() >= 0 ? sheet.text(r, layout.codeColumn()) : "";
            if (inst.isEmpty() && code.isEmpty() || TOTAL.matcher(inst.replace(" ", "")).find()
                    || layout.dateColumn() >= 0 && TOTAL.matcher(sheet.text(r, layout.dateColumn()).replace(" ", "")).find()) {
                continue;
            }

            if (header) {
                // 가로형: 날짜 머리글 칸마다 따로 기간을 본다
                long[] in = new long[1];
                List<UploadDate> dates = new ArrayList<>();
                for (int c : layout.dateHeaderColumns()) {
                    Long v = SheetData.number(sheet.cell(r, c));
                    UploadDate d = UploadDate.parse(sheet.cell(layout.headerRow(), c));
                    if (v == null || d == null) {
                        continue;
                    }
                    if (from != null && !d.overlaps(from, to)) {
                        Excluded e = out.excluded.computeIfAbsent(d.key(), k -> new Excluded(1));
                        e.rows++;
                        e.values[0] += v;
                        continue;
                    }
                    in[0] += v;
                    dates.add(d);
                }
                if (!dates.isEmpty() && add(out, matcher, inst, code, in)) {
                    dates.forEach(d -> {
                        out.includedDates.add(d.key());
                        out.units.add(d.unit());
                    });
                }
                continue;
            }

            long[] vals = new long[n];
            boolean any = false;
            for (int i = 0; i < n; i++) {
                Long v = SheetData.number(sheet.cell(r, layout.valueColumns().get(i).index()));
                if (v != null) {
                    vals[i] = v;
                    any = true;
                }
            }
            if (!any) {
                continue;
            }
            UploadDate d;
            if (title != null) {
                d = title;
            } else {
                Object raw = sheet.cell(r, layout.dateColumn());
                d = SheetData.empty(raw) ? last : UploadDate.parse(raw);
                if (d == null) {
                    out.unreadableRows++;
                    if (out.unreadableSamples.size() < SAMPLE_LIMIT) {
                        out.unreadableSamples.add(SheetData.empty(raw) ? "(빈 칸) " + inst : SheetData.text(raw));
                    }
                    continue;
                }
                last = d;
            }
            if (from != null && !d.overlaps(from, to)) {
                Excluded e = out.excluded.computeIfAbsent(d.key(), k -> new Excluded(n));
                e.rows++;
                for (int i = 0; i < n; i++) {
                    e.values[i] += vals[i];
                }
                continue;
            }
            if (add(out, matcher, inst, code, vals)) {
                out.includedDates.add(d.key());
                out.units.add(d.unit());
            }
        }
        return out;
    }

    private static <T> boolean add(Read<T> out, Function<String, T> matcher, String inst, String code, long[] vals) {
        T match = inst.isEmpty() ? null : matcher.apply(inst);
        if (match == null && !code.isEmpty()) {
            match = matcher.apply(code);
        }
        if (match == null) {
            out.unmatched.add(inst.isEmpty() ? code : inst);
            return false;
        }
        long[] sum = out.sums.computeIfAbsent(match, k -> new long[vals.length]);
        for (int i = 0; i < vals.length; i++) {
            sum[i] += vals[i];
        }
        out.rowCount++;
        return true;
    }
}
