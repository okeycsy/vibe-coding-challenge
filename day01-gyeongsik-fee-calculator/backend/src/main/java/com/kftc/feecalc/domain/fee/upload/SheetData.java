package com.kftc.feecalc.domain.fee.upload;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DateUtil;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;

/**
 * 시트 한 장을 값 격자로 옮긴 것. 칸 값은 String(앞뒤 공백 제거) · Double · LocalDate(날짜 서식) 중 하나이고 빈 칸은 "".
 * 원본 파일은 저장하지 않고 요청 처리 중에만 메모리에 둔다.
 */
public record SheetData(String name, List<List<Object>> rows) {

    /** 너무 큰 파일에서 메모리를 지키기 위한 상한 */
    public static final int MAX_ROWS = 50_000;
    public static final int MAX_COLS = 60;

    private static final Pattern NUMBER = Pattern.compile("^-?[\\d,]+(\\.\\d+)?$");

    public static SheetData of(Sheet sheet) {
        List<List<Object>> rows = new ArrayList<>();
        int last = Math.min(sheet.getLastRowNum(), MAX_ROWS);
        for (int r = 0; r <= last; r++) {
            Row row = sheet.getRow(r);
            List<Object> cells = new ArrayList<>();
            if (row != null) {
                int lastCol = Math.min(row.getLastCellNum(), MAX_COLS);
                for (int c = 0; c < lastCol; c++) {
                    cells.add(value(row.getCell(c)));
                }
            }
            rows.add(cells);
        }
        return new SheetData(sheet.getSheetName(), rows);
    }

    private static Object value(Cell cell) {
        if (cell == null) {
            return "";
        }
        CellType type = cell.getCellType() == CellType.FORMULA ? cell.getCachedFormulaResultType() : cell.getCellType();
        try {
            return switch (type) {
                case NUMERIC -> DateUtil.isCellDateFormatted(cell)
                        ? cell.getLocalDateTimeCellValue().toLocalDate()
                        : (Object) cell.getNumericCellValue();
                case STRING -> cell.getStringCellValue().strip();
                case BOOLEAN -> String.valueOf(cell.getBooleanCellValue());
                default -> "";
            };
        } catch (RuntimeException e) {
            return "";
        }
    }

    public Object cell(int r, int c) {
        if (r < 0 || r >= rows.size() || c < 0) {
            return "";
        }
        List<Object> row = rows.get(r);
        return c < row.size() ? row.get(c) : "";
    }

    public String text(int r, int c) {
        return text(cell(r, c));
    }

    public int width() {
        return rows.stream().mapToInt(List::size).max().orElse(0);
    }

    public boolean blank(int r) {
        return r >= rows.size() || rows.get(r).stream().allMatch(SheetData::empty);
    }

    public static boolean empty(Object v) {
        return v == null || (v instanceof String s && s.isBlank());
    }

    public static String text(Object v) {
        if (v instanceof Double d) {
            return d == Math.floor(d) && !d.isInfinite() ? String.valueOf(d.longValue()) : String.valueOf(d);
        }
        return v == null ? "" : v.toString().strip();
    }

    /** 칸 값 → 정수(반올림). 숫자 칸 또는 "1,234" · "1,234건" · "1,234원" 같은 문자. 아니면 null */
    public static Long number(Object v) {
        if (v instanceof Double d) {
            return d.isNaN() || d.isInfinite() ? null : Math.round(d);
        }
        if (v instanceof String s) {
            String t = s.replaceAll("[\\s건원]", "");
            if (NUMBER.matcher(t).matches() && t.chars().anyMatch(Character::isDigit)) {
                return Math.round(Double.parseDouble(t.replace(",", "")));
            }
        }
        return null;
    }

    public static boolean isDateCell(Object v) {
        return v instanceof LocalDate;
    }
}
