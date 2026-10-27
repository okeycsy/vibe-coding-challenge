package com.kftc.feecalc.domain.fee.upload;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.kftc.feecalc.domain.fee.ai.LlmClient;
import com.kftc.feecalc.domain.fee.ai.LlmClient.LlmException;
import com.kftc.feecalc.domain.fee.upload.UploadLayout.DateSource;
import com.kftc.feecalc.domain.fee.upload.UploadLayout.ValueColumn;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 업로드 엑셀의 구조(머리글 행, 기관 열, 날짜 위치, 수치 열)를 판별한다.
 * AI 키가 있으면 시트 앞부분 미리보기를 AI 에 보여 판별하게 하고, AI 결과도 {@link #validate}를 통과해야 쓴다.
 * 키가 없으면(RULE) 또는 AI 가 실패·검증 탈락하면(RULE_FALLBACK) {@link RuleLayoutDetector}로 판별한다.
 * 같은 미리보기의 AI 판별은 서버 메모리에 기억한다. 엑셀 원본은 저장하지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UploadLayoutService {

    static final int PREVIEW_SHEETS = 3;
    static final int PREVIEW_ROWS = 25;
    static final int PREVIEW_COLS = 20;
    static final int CACHE_LIMIT = 200;

    public static final String SYSTEM = """
            너는 금융결제원 회비 산출 시스템의 실적 엑셀 판독 AI야. 시트 미리보기를 보고 표 구조를 판별해. 행 번호 r 과 열 번호 c 는 0부터야.
            반드시 필요한 것은 기관 열(기관명, 없으면 기관코드)과 날짜(최소 년월)야. 날짜 위치는 dateSource 로 알려 줘: \
            COLUMN(행마다 날짜가 적힌 열이 있음: 기준월·일자 등), HEADER(머리글 칸들이 2026-07 처럼 날짜인 가로형 표), \
            TITLE(표 위 제목 문장에만 날짜가 있음: "2026년 3분기 실적" 등).
            기관·날짜·순번·코드가 아닌 수치 열(건수, 금액, 조회·이체 같은 거래 종류별 건수 등)은 모두 valueColumns 에 넣어. \
            kind 는 COUNT(건수·횟수), AMOUNT(금액·수수료), NUMBER(그 밖의 수치) 중 하나야. \
            use 는 회비 실적(건수)으로 더할 열이면 true: '건수'·'실적' 열이 있으면 그 열만, 없으면 금액이 아닌 수치 열 모두.
            머리글이 여러 줄이면 열 이름이 가장 잘 드러나는 줄을 headerRow 로 골라. 기관코드 열이 기관명 열과 따로 있으면 codeColumn 에, 없으면 -1.
            반드시 다음 JSON 객체로만 답해: {"sheet":0,"headerRow":0,"institutionColumn":1,"codeColumn":-1,"dateSource":"COLUMN",\
            "dateColumn":0,"valueColumns":[{"column":2,"kind":"COUNT","use":true}],"reason":"판단 근거 한 문장"}
            해당 열이 없으면 -1 을 넣어. 기관 열이나 날짜를 찾지 못하면 institutionColumn 또는 dateSource 를 null 로 답해.""";

    public record Detection(UploadLayout layout, String mode, String model, String note, String reason) {
    }

    private final LlmClient llm;
    private final Map<String, Detection> cache = new ConcurrentHashMap<>();

    /** 판별 결과. 규칙 기반으로도 못 찾으면 null 이 아니라 layout 이 null 인 Detection (note 에 AI 실패 원인) */
    public Detection detect(List<SheetData> sheets) {
        String note = null;
        if (llm.enabled()) {
            String preview = preview(sheets);
            Detection cached = cache.get(preview);
            if (cached != null) {
                return cached;
            }
            try {
                JsonNode res = llm.chatJson(SYSTEM, preview);
                UploadLayout layout = fromJson(res, sheets);
                String error = layout == null ? "AI 가 기관 열이나 날짜를 찾지 못했다고 답했습니다" : validate(sheets, layout);
                if (error == null) {
                    Detection d = new Detection(normalize(sheets, layout), "AI", llm.model(), null, res.path("reason").asText(null));
                    if (cache.size() >= CACHE_LIMIT) {
                        cache.clear();
                    }
                    cache.put(preview, d);
                    return d;
                }
                note = "AI 판별 결과가 검증을 통과하지 못해 규칙 기반으로 읽음 (" + error + ")";
            } catch (LlmException e) {
                note = "AI 판별 실패로 규칙 기반으로 읽음 (" + e.getMessage() + ")";
            } catch (RuntimeException e) {
                note = "AI 판별 결과를 읽지 못해 규칙 기반으로 읽음 (" + e.getClass().getSimpleName() + ")";
            }
            log.warn(note);
        }
        UploadLayout rule = RuleLayoutDetector.detect(sheets);
        return new Detection(rule, note == null ? "RULE" : "RULE_FALLBACK", null, note, null);
    }

    /** AI 에 보여 줄 미리보기: 시트마다 앞쪽 행을 "r번호 | c0=값 | c1=값" 형태로 */
    static String preview(List<SheetData> sheets) {
        StringBuilder sb = new StringBuilder();
        for (int s = 0; s < Math.min(sheets.size(), PREVIEW_SHEETS); s++) {
            SheetData sheet = sheets.get(s);
            sb.append("### sheet ").append(s).append(" \"").append(sheet.name()).append("\" (").append(sheet.rows().size())
                    .append("행)\n");
            for (int r = 0; r < Math.min(sheet.rows().size(), PREVIEW_ROWS); r++) {
                List<Object> row = sheet.rows().get(r);
                if (row.stream().allMatch(SheetData::empty)) {
                    continue;
                }
                sb.append('r').append(r);
                for (int c = 0; c < Math.min(row.size(), PREVIEW_COLS); c++) {
                    Object v = row.get(c);
                    if (SheetData.empty(v)) {
                        continue;
                    }
                    String t = v instanceof LocalDate d ? d + "(날짜)" : SheetData.text(v);
                    sb.append(" | c").append(c).append('=').append(t.length() > 40 ? t.substring(0, 40) + "…" : t);
                }
                sb.append('\n');
            }
        }
        return sb.toString();
    }

    static UploadLayout fromJson(JsonNode res, List<SheetData> sheets) {
        if (!res.path("institutionColumn").isInt() || !res.path("dateSource").isTextual()) {
            return null;
        }
        int s = res.path("sheet").asInt(0);
        int headerRow = res.path("headerRow").asInt(-1);
        if (s < 0 || s >= sheets.size() || headerRow < 0 || headerRow >= sheets.get(s).rows().size()) {
            throw new IllegalArgumentException("sheet/headerRow");
        }
        SheetData sheet = sheets.get(s);
        int inst = res.path("institutionColumn").asInt();
        int code = res.path("codeColumn").asInt(-1);
        DateSource source = DateSource.valueOf(res.path("dateSource").asText().toUpperCase());
        int date = source == DateSource.COLUMN ? res.path("dateColumn").asInt(-1) : -1;
        List<Integer> headerDates = new ArrayList<>();
        if (source == DateSource.HEADER) {
            for (int c = 0; c < sheet.width(); c++) {
                if (c != inst && c != code && UploadDate.parse(sheet.cell(headerRow, c)) != null) {
                    headerDates.add(c);
                }
            }
        }
        String title = source == DateSource.TITLE ? RuleLayoutDetector.titleDate(sheet, headerRow) : null;
        List<ValueColumn> values = new ArrayList<>();
        if (source == DateSource.HEADER) {
            values.add(new ValueColumn(-1, "실적", "COUNT", true));
        } else {
            for (JsonNode v : res.path("valueColumns")) {
                int c = v.path("column").asInt(-1);
                String header = sheet.text(headerRow, c);
                String kind = v.path("kind").asText("");
                values.add(new ValueColumn(c, header.isEmpty() ? "열 " + (c + 1) : header,
                        Set.of("COUNT", "AMOUNT", "NUMBER").contains(kind) ? kind : RuleLayoutDetector.kind(header),
                        v.path("use").asBoolean(false)));
            }
        }
        return new UploadLayout(s, headerRow, inst, code, source, date, headerDates, title, values);
    }

    /** AI 판별을 실제 시트로 확인한다. 문제가 있으면 이유, 없으면 null */
    static String validate(List<SheetData> sheets, UploadLayout l) {
        SheetData sheet = sheets.get(l.sheet());
        int width = sheet.width();
        List<Integer> data = RuleLayoutDetector.dataRows(sheet, l.headerRow());
        if (data.isEmpty()) {
            return "머리글 아래에 데이터 행이 없음";
        }
        if (l.institutionColumn() < 0 || l.institutionColumn() >= width || filledRate(sheet, data, l.institutionColumn()) < 0.5) {
            return "기관 열(" + l.institutionColumn() + ")이 비어 있음";
        }
        switch (l.dateSource()) {
            case COLUMN -> {
                if (l.dateColumn() < 0 || l.dateColumn() >= width || l.dateColumn() == l.institutionColumn()
                        || RuleLayoutDetector.dateRate(sheet, data, l.dateColumn(), true) < 0.5) {
                    return "날짜 열(" + l.dateColumn() + ")에서 년월을 읽지 못함";
                }
            }
            case HEADER -> {
                if (l.dateHeaderColumns().isEmpty()) {
                    return "날짜 머리글을 읽지 못함";
                }
            }
            case TITLE -> {
                if (l.titleText() == null) {
                    return "표 위 제목에서 날짜를 찾지 못함";
                }
            }
        }
        if (l.dateSource() != DateSource.HEADER) {
            Set<Integer> taken = new HashSet<>(List.of(l.institutionColumn(), l.codeColumn(), l.dateColumn()));
            boolean ok = l.valueColumns().stream().anyMatch(v -> v.index() >= 0 && v.index() < width && !taken.contains(v.index())
                    && RuleLayoutDetector.numberRate(sheet, data, v.index()) >= 0.5);
            if (!ok) {
                return "수치 열이 없음";
            }
        }
        return null;
    }

    /** 검증된 AI 판별에서 숫자가 아닌 값 열·중복 열을 빼고, 실적에 넣을 열이 하나도 없으면 기본 규칙으로 정한다 */
    static UploadLayout normalize(List<SheetData> sheets, UploadLayout l) {
        if (l.dateSource() == DateSource.HEADER) {
            return l;
        }
        SheetData sheet = sheets.get(l.sheet());
        List<Integer> data = RuleLayoutDetector.dataRows(sheet, l.headerRow());
        Set<Integer> seen = new HashSet<>(List.of(l.institutionColumn(), l.codeColumn(), l.dateColumn()));
        List<ValueColumn> values = l.valueColumns().stream()
                .filter(v -> v.index() >= 0 && v.index() < sheet.width() && seen.add(v.index())
                        && RuleLayoutDetector.numberRate(sheet, data, v.index()) >= 0.5)
                .toList();
        if (values.stream().noneMatch(ValueColumn::use)) {
            values = RuleLayoutDetector.defaultUse(values);
        }
        return l.withValueColumns(values);
    }

    private static double filledRate(SheetData sheet, List<Integer> data, int c) {
        return data.stream().filter(r -> !SheetData.empty(sheet.cell(r, c))).count() / (double) data.size();
    }
}
