package com.kftc.feecalc.domain.fee.service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;
import com.kftc.feecalc.domain.fee.dto.CalculationResponse;
import com.kftc.feecalc.domain.fee.dto.InstitutionCount;
import com.kftc.feecalc.domain.fee.dto.UploadResult;
import com.kftc.feecalc.domain.fee.entity.AiIssue;
import com.kftc.feecalc.domain.fee.entity.Business;
import com.kftc.feecalc.domain.fee.entity.CalcMethod;
import com.kftc.feecalc.domain.fee.entity.FeeCalculation;
import com.kftc.feecalc.domain.fee.entity.FeeCalculationItem;
import com.kftc.feecalc.domain.fee.entity.Institution;
import com.kftc.feecalc.domain.fee.repository.InstitutionRepository;
import com.kftc.feecalc.domain.fee.upload.SheetData;
import com.kftc.feecalc.domain.fee.upload.UploadLayout;
import com.kftc.feecalc.domain.fee.upload.UploadLayout.SkillInput;
import com.kftc.feecalc.domain.fee.upload.UploadLayoutService;
import com.kftc.feecalc.domain.fee.upload.UploadReader;

import lombok.RequiredArgsConstructor;

/** 실적 엑셀 업로드 파싱과 산출 결과 엑셀(대사용·수입결의용) 생성 — Apache POI */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FeeExcelService {

    private static final java.util.Map<String, String> POSTPROCESS_SOURCE = java.util.Map.of(
            "SCRIPT", "확정 스크립트 적용", "AUTO_RULE", "자동 변환 적용 (스크립트 미확정)",
            "DEFAULT", "특이사항 없음 · 기본 배분");

    private final InstitutionRepository institutionRepository;
    private final FeeCalculationService calculationService;
    private final SkillEngineService skillEngine;
    private final UploadLayoutService layoutService;

    public record ExcelFile(String fileName, byte[] content) {
    }

    // ---------- 업로드 ----------

    /**
     * 업로드 엑셀을 읽는다. 형식은 고정하지 않고 AI(키가 없거나 실패하면 규칙 기반)가 머리글 행·기관 열·날짜(년월 이상)·수치 열을 판별한다.
     * from~to 를 주면 그 기간과 겹치지 않는 날짜의 행은 빼고 날짜별로 알려 준다. 같은 기관이 여러 행이면 합산하고 합계 행은 건너뛴다.
     * 엑셀 원본은 저장하지 않는다.
     */
    public UploadResult parseUpload(MultipartFile file, LocalDate from, LocalDate to) {
        return parseUpload(file, from, to, null);
    }

    /**
     * taskCode(업무 코드 또는 업무 ID)를 주면 그 업무 skill.md 의 실적 입력 변수(```variables 의 input)에 수치 열을 연결하고
     * (AI 가 열마다 variable 을 정하고, 못 정한 열은 머리글 규칙으로), 기관별 변수 값(counts[].inputs)과 변수 정의로 계산한 rawCount(baseCount)를 돌려준다.
     * 업무가 없거나 기준 문서를 아직 못 읽으면 예전 방식(rawCount 하나)으로 읽는다
     */
    public UploadResult parseUpload(MultipartFile file, LocalDate from, LocalDate to, String taskCode) {
        if (file == null || file.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_EXCEL, "업로드할 파일을 선택해 주세요.");
        }
        if (from != null && to != null && from.isAfter(to)) {
            throw new BusinessException(ErrorCode.INVALID_PERIOD, "시작일(From)이 종료일(To)보다 늦습니다.");
        }
        // 기관 관리에서 추가·수정한 기관이 바로 반영되도록 요청마다 DB에서 읽는다 (비활성 기관 제외)
        List<Institution> institutions = institutionRepository.findByActiveTrueOrderBySortOrder();

        List<SheetData> sheets = new ArrayList<>();
        try (InputStream in = file.getInputStream(); Workbook wb = WorkbookFactory.create(in)) {
            for (int s = 0; s < Math.min(wb.getNumberOfSheets(), 10); s++) {
                sheets.add(SheetData.of(wb.getSheetAt(s)));
            }
        } catch (IOException | RuntimeException e) {
            throw new BusinessException(ErrorCode.INVALID_EXCEL, "엑셀 파일(xlsx, xls)을 읽을 수 없습니다.");
        }

        SkillVariables variables = variablesOf(taskCode);
        List<SkillInput> inputs = variables == null ? SkillInput.DEFAULT
                : variables.inputs().stream().map(d -> new SkillInput(d.name(), d.label())).toList();
        UploadLayoutService.Detection detection = layoutService.detect(sheets, inputs);
        UploadLayout layout = detection.layout();
        if (layout == null) {
            throw new BusinessException(ErrorCode.INVALID_EXCEL,
                    "표 구조를 판별하지 못했습니다. 기관명(또는 기관코드) 열과 날짜(최소 년월: 기준월 열, 2026-07 같은 머리글, "
                            + "또는 표 위 '2026년 3분기' 같은 제목)가 필요합니다."
                            + (detection.note() == null ? "" : " " + detection.note()));
        }
        SheetData sheet = sheets.get(layout.sheet());
        UploadReader.Read<Institution> read = UploadReader.read(sheet, layout,
                v -> matchInstitution(v, institutions), from == null || to == null ? null : from, to);

        List<UploadLayout.ValueColumn> valueColumns = layout.valueColumns();
        List<UploadResult.Column> columns = valueColumns.stream()
                .map(v -> new UploadResult.Column(v.index(), v.header(), v.kind(), v.use(), v.variable())).toList();
        List<UploadResult.Mapping> mapping = new ArrayList<>();
        for (SkillInput in : inputs) {
            List<Integer> cols = new ArrayList<>();
            for (int c = 0; c < valueColumns.size(); c++) {
                if (in.name().equals(valueColumns.get(c).variable())) {
                    cols.add(c);
                }
            }
            mapping.add(new UploadResult.Mapping(in.name(), in.label(), cols));
        }
        List<UploadResult.InstitutionValues> values = new ArrayList<>();
        List<Institution> matched = new ArrayList<>();
        List<Map<String, Long>> inputValues = new ArrayList<>();
        for (Institution i : institutions) {
            long[] sum = read.sums.get(i);
            if (sum == null) {
                continue;
            }
            matched.add(i);
            values.add(new UploadResult.InstitutionValues(i.getCode(), i.getName(), Arrays.stream(sum).boxed().toList()));
            Map<String, Long> byInput = new LinkedHashMap<>();
            for (UploadResult.Mapping m : mapping) {
                long count = 0;
                for (int c : m.columns()) {
                    count += c < sum.length ? sum[c] : 0;
                }
                byInput.put(m.variable(), Math.max(0, count));
            }
            inputValues.add(byInput);
        }
        long[] base = baseCounts(variables, inputValues);
        List<InstitutionCount> counts = new ArrayList<>();
        for (int i = 0; i < matched.size(); i++) {
            counts.add(new InstitutionCount(matched.get(i).getCode(), matched.get(i).getName(), base[i], inputValues.get(i)));
        }
        long total = counts.stream().mapToLong(InstitutionCount::baseCount).sum();
        List<UploadResult.Excluded> excluded = read.excluded.entrySet().stream()
                .map(e -> new UploadResult.Excluded(e.getKey(), e.getValue().rows, Arrays.stream(e.getValue().values).boxed().toList()))
                .toList();
        String dateHeader = switch (layout.dateSource()) {
            case COLUMN -> sheet.text(layout.headerRow(), layout.dateColumn());
            case HEADER -> layout.dateHeaderColumns().stream().map(c -> sheet.text(layout.headerRow(), c))
                    .reduce((a, b) -> a + ", " + b).orElse("");
            case TITLE -> layout.titleText();
        };
        UploadResult.Layout info = new UploadResult.Layout(sheet.name(), layout.headerRow() + 1,
                sheet.text(layout.headerRow(), layout.institutionColumn()), layout.dateSource().name(), dateHeader, read.dateUnit());
        return new UploadResult(file.getOriginalFilename(), read.rowCount, total, counts, List.copyOf(read.unmatched), info,
                columns, mapping, values, excluded, read.unreadableRows, read.unreadableSamples, List.copyOf(read.includedDates),
                new UploadResult.Analysis(detection.mode(), detection.model(), detection.note(), detection.reason()));
    }

    /** 업무의 변수 정의. 업무 코드가 없거나 기준 문서를 못 읽으면(없는 업무·구조 오류) null = 예전 방식 */
    private SkillVariables variablesOf(String taskCode) {
        if (taskCode == null || taskCode.isBlank()) {
            return null;
        }
        try {
            return skillEngine.getSkill(taskCode.trim()).variables();
        } catch (BusinessException e) {
            return null;
        }
    }

    /**
     * 기관별 rawCount: 변수 정의가 있으면 그 정의로 계산(입력 합이 아니라 rawCount 줄의 값), 계산할 수 없으면(수식 오류 등) 입력 합계.
     * 산출 때는 FeeCalculationService 가 같은 정의로 다시 계산하므로 여기서는 화면 표시용이다
     */
    private static long[] baseCounts(SkillVariables variables, List<Map<String, Long>> inputValues) {
        long[] base = new long[inputValues.size()];
        if (variables != null) {
            try {
                return variables.bind(inputValues.stream().map(in -> new SkillVariables.Row(in, 0)).toList(), 1.0).rawCount();
            } catch (RuntimeException e) {
                // 변수 정의가 이 입력으로는 계산되지 않음 → 입력 합계로 보여 주고, 산출 때 같은 오류를 알린다
            }
        }
        for (int i = 0; i < base.length; i++) {
            base[i] = Math.max(0, inputValues.get(i).values().stream().mapToLong(Long::longValue).sum());
        }
        return base;
    }

    /** 업로드 양식: 기준월 | 기관코드 | 기관명 | 건수 (기준월은 이번 달로 채워 둠) */
    public ExcelFile uploadTemplate() {
        try (XSSFWorkbook wb = new XSSFWorkbook()) {
            Sheet sheet = wb.createSheet("실적");
            CellStyle header = headerStyle(wb);
            writeRow(sheet, 0, header, "기준월", "기관코드", "기관명", "건수");
            String month = LocalDate.now().toString().substring(0, 7);
            int r = 1;
            for (Institution inst : institutionRepository.findByActiveTrueOrderBySortOrder()) {
                writeRow(sheet, r++, null, month, inst.getBankCode(), inst.getName(), 0L);
            }
            autosize(sheet, 4);
            return new ExcelFile("회비실적_업로드양식.xlsx", toBytes(wb));
        } catch (IOException e) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "엑셀 생성에 실패했습니다.");
        }
    }

    // ---------- 다운로드 ----------

    /** 참가기관 송부 대사용: 대사내역 · 산출기준 · AI 이슈 이력 3개 시트 */
    public ExcelFile reconcileWorkbook(Long calculationId) {
        FeeCalculation calc = calculationService.getCalculation(calculationId);
        Business biz = calc.getBusiness();
        Period period = new Period(calc.getPeriodFrom(), calc.getPeriodTo());

        try (XSSFWorkbook wb = new XSSFWorkbook()) {
            CellStyle header = headerStyle(wb);

            Sheet detail = wb.createSheet("대사내역");
            // 실적 입력이 여럿(변수 정의의 input 2개 이상)이면 기준 실적 옆에 항목별 건수를 함께 적는다
            boolean multiInput = calc.getItems().stream().anyMatch(i -> CalculationResponse.inputsOf(i.getInputsJson()).size() >= 2);
            List<Object> head = new ArrayList<>(List.of("기관코드", "기관명", "기준 실적"));
            if (multiInput) {
                head.add("실적 항목별 건수");
            }
            head.addAll(List.of("AI 차감", "실적(최종인정건수)", "적용 단가/분담률", "균등분담분(원)", "실적분담분(원)", "산출 회비(총합, 원)",
                    "특이사항 보정 전(원)", "특이사항 보정(원)", "특이사항 보정 사유", "차감 사유"));
            writeRow(detail, 0, header, head.toArray());
            int r = 1;
            for (FeeCalculationItem i : calc.getItems()) {
                List<Object> row = new ArrayList<>(List.of(i.getBankCode(), i.getInstitutionName(), i.getBaseCount()));
                if (multiInput) {
                    row.add(inputsText(i.getInputsJson()));
                }
                row.addAll(Arrays.asList(i.getDeduction(), i.getFinalCount(), i.getRateLabel(), i.getEqualFee(), i.getPerfFee(), i.getFee(),
                        i.getBeforeSpecialFee(), i.getSpecialAdjustment(),
                        i.getSpecialReason() == null ? "" : i.getSpecialReason(),
                        i.getDeductionReasons() == null ? "" : i.getDeductionReasons().replace("\n", " / ")));
                writeRow(detail, r++, null, row.toArray());
            }
            List<Object> total = new ArrayList<>(List.of("합계", "", calc.getItems().stream().mapToLong(FeeCalculationItem::getBaseCount).sum()));
            if (multiInput) {
                total.add("");
            }
            total.addAll(Arrays.asList(calc.getItems().stream().mapToLong(FeeCalculationItem::getDeduction).sum(),
                    calc.getTotalFinalCount(), "", calc.getItems().stream().mapToLong(FeeCalculationItem::getEqualFee).sum(),
                    calc.getItems().stream().mapToLong(FeeCalculationItem::getPerfFee).sum(), calc.getTotalFeeAmount(),
                    calc.getItems().stream().mapToLong(FeeCalculationItem::getBeforeSpecialFee).sum(),
                    calc.getItems().stream().mapToLong(FeeCalculationItem::getSpecialAdjustment).sum(), "", ""));
            writeRow(detail, r, header, total.toArray());
            autosize(detail, head.size());

            Sheet basis = wb.createSheet("산출기준");
            int b = 0;
            writeRow(basis, b++, header, "항목", "내용");
            writeRow(basis, b++, null, "업무", biz.getName());
            writeRow(basis, b++, null, "산출 기간", period.label());
            if (calc.getAppliedFormula() != null) {
                writeRow(basis, b++, null, "산출 방식", calc.getAppliedCalcType() + " (" + calc.getSkillCode() + ".md)");
                writeRow(basis, b++, null, "회비 합계(원)", calc.getTotalFeeAmount());
                writeRow(basis, b++, null, "원 단위 처리", "원 미만 버림 후 최대잔여법으로 배정(합계 = 수식 결과 합계의 반올림)");
            } else if (biz.getMethod() == CalcMethod.UNIT) {
                writeRow(basis, b++, null, "산출 방식", biz.getMethod().getLabel());
                writeRow(basis, b++, null, "건당 단가(원)", calc.getAppliedUnitPrice());
            } else {
                writeRow(basis, b++, null, "산출 방식", biz.getMethod().getLabel());
                writeRow(basis, b++, null, "기간 총액(원)", calc.getAppliedTotalFee());
            }
            if (period.quarter() == 0) {
                writeRow(basis, b++, null, "기간 환산", period.days() + "일 ÷ " + Period.QUARTER_DAYS + "일");
            }
            writeRow(basis, b++, null, "실적 출처", "UPLOAD".equals(calc.getSource())
                    ? "엑셀 업로드 (" + calc.getUploadFileName() + ")" : "시연용 예시 실적");
            List<String> summary = calc.getSkillCode() != null
                    ? skillEngine.getSkill(calc.getSkillCode()).summary() : biz.getSummary();
            for (String line : summary) {
                writeRow(basis, b++, null, "1. 비즈니스 규칙 요약", line);
            }
            for (String line : SkillEngineService.lines(calc.getAppliedVariables())) {
                writeRow(basis, b++, null, "3. 변수 정의(적용)", line);
            }
            if (calc.getAppliedFormula() != null) {
                writeRow(basis, b++, null, "3. 정산 수식(적용)", calc.getAppliedFormula().replaceAll("\\s+", " "));
            }
            List<String> special = SkillEngineService.lines(calc.getAppliedSpecialRules());
            if (special.isEmpty()) {
                writeRow(basis, b++, null, "4. 최종 정산 특이사항", "없음");
            }
            for (String line : special) {
                writeRow(basis, b++, null, "4. 최종 정산 특이사항", line);
            }
            if (calc.getPostprocessSource() != null) {
                writeRow(basis, b++, null, "4번 스크립트 출처",
                        POSTPROCESS_SOURCE.getOrDefault(calc.getPostprocessSource(), calc.getPostprocessSource()));
                for (String line : SkillEngineService.lines(calc.getAppliedPostprocess())) {
                    writeRow(basis, b++, null, "4번 후처리 스크립트", line);
                }
                CalculationResponse.PostprocessResult pr = CalculationResponse.result(calc.getPostprocessResultJson());
                for (CalculationResponse.Check c : pr.checks()) {
                    writeRow(basis, b++, null, "4번 검증", (c.passed() ? "통과" : "실패") + " · " + c.label()
                            + (c.actual() == null ? "" : " (실제 " + c.actual() + ")"));
                }
                for (String line : pr.notes()) {
                    writeRow(basis, b++, null, "4번 참고", line);
                }
            }
            autosize(basis, 2);

            Sheet issues = wb.createSheet("AI 이슈 이력");
            writeRow(issues, 0, header, "No", "이슈 문장", "인식 기관", "차감 건수", "일자", "사유", "반영 여부");
            int n = 1;
            for (AiIssue a : calc.getIssues()) {
                writeRow(issues, n, null, (long) n, a.getText(), a.getInstitutionName(), a.getCount(), a.getIssueDate(),
                        a.getReason(), a.isApplied() ? "반영" : "미반영(기관·건수 인식 실패)");
                n++;
            }
            autosize(issues, 7);

            return new ExcelFile(biz.getName() + "_회비대사_" + period.tag() + ".xlsx", toBytes(wb));
        } catch (IOException e) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "엑셀 생성에 실패했습니다.");
        }
    }

    /** 수입결의용: 결의일자 · 수입과목 · 거래처 · 금액 · 적요 */
    public ExcelFile revenueWorkbook(Long calculationId) {
        FeeCalculation calc = calculationService.getCalculation(calculationId);
        Business biz = calc.getBusiness();
        Period period = new Period(calc.getPeriodFrom(), calc.getPeriodTo());

        try (XSSFWorkbook wb = new XSSFWorkbook()) {
            CellStyle header = headerStyle(wb);
            Sheet sheet = wb.createSheet("수입결의");
            writeRow(sheet, 0, header, "결의일자", "수입과목", "거래처", "실적(최종인정건수)", "균등분담분", "실적분담분",
                    "금액(산출 회비 총합)", "적요");
            String today = LocalDate.now().toString();
            int r = 1;
            for (FeeCalculationItem i : calc.getItems()) {
                writeRow(sheet, r++, null, today, biz.getRevenueAccount(), i.getInstitutionName(), i.getFinalCount(),
                        i.getEqualFee(), i.getPerfFee(), i.getFee(), biz.getName() + " 회비 " + period.label());
            }
            writeRow(sheet, r, header, "", "", "합계", calc.getTotalFinalCount(),
                    calc.getItems().stream().mapToLong(FeeCalculationItem::getEqualFee).sum(),
                    calc.getItems().stream().mapToLong(FeeCalculationItem::getPerfFee).sum(), calc.getTotalFeeAmount(), "");
            autosize(sheet, 8);
            return new ExcelFile(biz.getName() + "_수입결의_" + period.tag() + ".xlsx", toBytes(wb));
        } catch (IOException e) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "엑셀 생성에 실패했습니다.");
        }
    }

    // ---------- helpers ----------

    /** 엑셀 기관 칸 값 → 기관. 기관코드·내부 ID·기관명이 같으면 그 기관, 아니면 이름·별칭이 가장 길게 들어 있는 기관 */
    public static Institution matchInstitution(String value, List<Institution> institutions) {
        String v = value.replace(" ", "");
        for (Institution i : institutions) {
            if (v.equalsIgnoreCase(i.getBankCode()) || v.equalsIgnoreCase(i.getCode()) || v.equals(i.getName())) {
                return i;
            }
        }
        // 이름·별칭이 들어 있으면 가장 길게 맞는 기관
        Institution best = null;
        int bestLength = 0;
        for (Institution i : institutions) {
            String a = i.findMatchedAlias(v);
            if (a != null && a.length() > bestLength) {
                best = i;
                bestLength = a.length();
            }
        }
        return best;
    }

    /** 실적 항목별 건수 표시: "출금이체 건수 120 / 입금이체 건수 30" (변수 이름은 적용 변수 정의의 input 설명으로 바꾼다) */
    static String inputsText(String inputsJson) {
        Map<String, Long> in = CalculationResponse.inputsOf(inputsJson);
        StringBuilder sb = new StringBuilder();
        in.forEach((k, v) -> sb.append(sb.isEmpty() ? "" : " / ").append(k).append(' ').append(String.format("%,d", v)));
        return sb.toString();
    }

    private CellStyle headerStyle(Workbook wb) {
        CellStyle style = wb.createCellStyle();
        Font font = wb.createFont();
        font.setBold(true);
        style.setFont(font);
        style.setFillForegroundColor(IndexedColors.PALE_BLUE.getIndex());
        style.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        return style;
    }

    private void writeRow(Sheet sheet, int rowIdx, CellStyle style, Object... values) {
        Row row = sheet.createRow(rowIdx);
        for (int c = 0; c < values.length; c++) {
            Cell cell = row.createCell(c);
            Object v = values[c];
            if (v instanceof Number num) {
                cell.setCellValue(num.doubleValue());
            } else if (v != null) {
                cell.setCellValue(v.toString());
            }
            if (style != null) {
                cell.setCellStyle(style);
            }
        }
    }

    private void autosize(Sheet sheet, int cols) {
        for (int c = 0; c < cols; c++) {
            // 한글은 autoSizeColumn 이 좁게 잡으므로 넉넉히 고정 폭을 준다
            sheet.setColumnWidth(c, Math.min(255 * 256, Math.max(14, maxLength(sheet, c) * 2 + 2) * 256));
        }
    }

    private int maxLength(Sheet sheet, int col) {
        int max = 0;
        DataFormatter fmt = new DataFormatter();
        for (Row row : sheet) {
            Cell cell = row.getCell(col);
            if (cell != null) {
                max = Math.max(max, fmt.formatCellValue(cell).length());
            }
        }
        return Math.min(max, 60);
    }

    private byte[] toBytes(Workbook wb) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        wb.write(out);
        return out.toByteArray();
    }
}
