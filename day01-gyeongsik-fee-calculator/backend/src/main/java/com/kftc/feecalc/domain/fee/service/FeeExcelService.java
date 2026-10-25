package com.kftc.feecalc.domain.fee.service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.CellType;
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

import lombok.RequiredArgsConstructor;

/** 실적 엑셀 업로드 파싱과 산출 결과 엑셀(대사용·수입결의용) 생성 — Apache POI */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FeeExcelService {

    private static final java.util.Map<String, String> POSTPROCESS_SOURCE = java.util.Map.of(
            "SCRIPT", "skill.md 후처리 스크립트", "AUTO_RULE", "자연어 특이사항을 내장 변환기로 변환 (스크립트 미확정)",
            "DEFAULT", "특이사항 없음 · 기본 배분");

    private final InstitutionRepository institutionRepository;
    private final FeeCalculationService calculationService;
    private final SkillEngineService skillEngine;

    public record ExcelFile(String fileName, byte[] content) {
    }

    // ---------- 업로드 ----------

    /**
     * 첫 시트에서 머리글 행을 찾아 기관(기관코드·기관명)과 건수(건수·실적) 열을 읽는다.
     * 같은 기관이 여러 행이면 합산하고, '합계' 행은 건너뛴다.
     */
    public UploadResult parseUpload(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_EXCEL, "업로드할 파일을 선택해 주세요.");
        }
        // 기관 관리에서 추가·수정한 기관이 바로 반영되도록 요청마다 DB에서 읽는다 (비활성 기관 제외)
        List<Institution> institutions = institutionRepository.findByActiveTrueOrderBySortOrder();
        DataFormatter fmt = new DataFormatter(Locale.KOREA);

        try (InputStream in = file.getInputStream(); Workbook wb = WorkbookFactory.create(in)) {
            Sheet sheet = wb.getSheetAt(0);
            int headerRow = -1;
            int instCol = -1;
            int countCol = -1;
            for (int r = sheet.getFirstRowNum(); r <= Math.min(sheet.getLastRowNum(), 20) && headerRow < 0; r++) {
                Row row = sheet.getRow(r);
                if (row == null) {
                    continue;
                }
                int ic = -1;
                int cc = -1;
                for (Cell cell : row) {
                    String h = fmt.formatCellValue(cell).replace(" ", "");
                    if (ic < 0 && (h.contains("기관") || h.contains("금융회사") || h.contains("코드"))) {
                        ic = cell.getColumnIndex();
                    }
                    if (cc < 0 && (h.contains("건수") || h.contains("실적"))) {
                        cc = cell.getColumnIndex();
                    }
                }
                if (ic >= 0 && cc >= 0) {
                    headerRow = r;
                    instCol = ic;
                    countCol = cc;
                }
            }
            if (headerRow < 0) {
                throw new BusinessException(ErrorCode.INVALID_EXCEL,
                        "머리글 행을 찾지 못했습니다. '기관명'(또는 기관코드)과 '건수' 열이 필요합니다.");
            }

            Map<String, Long> sums = new LinkedHashMap<>();
            List<String> unmatched = new ArrayList<>();
            int rowCount = 0;
            for (int r = headerRow + 1; r <= sheet.getLastRowNum(); r++) {
                Row row = sheet.getRow(r);
                if (row == null) {
                    continue;
                }
                String instValue = fmt.formatCellValue(row.getCell(instCol)).trim();
                if (instValue.isEmpty() || instValue.contains("합계")) {
                    continue;
                }
                Long count = readCount(row.getCell(countCol), fmt);
                if (count == null) {
                    continue;
                }
                Institution inst = matchInstitution(instValue, institutions);
                if (inst == null) {
                    unmatched.add(instValue);
                    continue;
                }
                sums.merge(inst.getCode(), count, Long::sum);
                rowCount++;
            }

            List<InstitutionCount> counts = institutions.stream()
                    .filter(i -> sums.containsKey(i.getCode()))
                    .map(i -> new InstitutionCount(i.getCode(), i.getName(), sums.get(i.getCode())))
                    .toList();
            long total = counts.stream().mapToLong(InstitutionCount::baseCount).sum();
            return new UploadResult(file.getOriginalFilename(), rowCount, total, counts, unmatched);
        } catch (IOException | RuntimeException e) {
            if (e instanceof BusinessException be) {
                throw be;
            }
            throw new BusinessException(ErrorCode.INVALID_EXCEL, "엑셀 파일(xlsx, xls)을 읽을 수 없습니다.");
        }
    }

    /** 업로드 양식: 기관코드 | 기관명 | 건수 */
    public ExcelFile uploadTemplate() {
        try (XSSFWorkbook wb = new XSSFWorkbook()) {
            Sheet sheet = wb.createSheet("실적");
            CellStyle header = headerStyle(wb);
            writeRow(sheet, 0, header, "기관코드", "기관명", "건수");
            int r = 1;
            for (Institution inst : institutionRepository.findByActiveTrueOrderBySortOrder()) {
                writeRow(sheet, r++, null, inst.getBankCode(), inst.getName(), 0L);
            }
            autosize(sheet, 3);
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
            writeRow(detail, 0, header, "기관코드", "기관명", "기준 실적", "AI 차감", "실적(최종인정건수)",
                    "적용 단가/분담률", "균등분담분(원)", "실적분담분(원)", "산출 회비(총합, 원)", "특이사항 보정 전(원)",
                    "특이사항 보정(원)", "특이사항 보정 사유", "차감 사유");
            int r = 1;
            for (FeeCalculationItem i : calc.getItems()) {
                writeRow(detail, r++, null, i.getBankCode(), i.getInstitutionName(), i.getBaseCount(), i.getDeduction(),
                        i.getFinalCount(), i.getRateLabel(), i.getEqualFee(), i.getPerfFee(), i.getFee(),
                        i.getBeforeSpecialFee(), i.getSpecialAdjustment(),
                        i.getSpecialReason() == null ? "" : i.getSpecialReason(),
                        i.getDeductionReasons() == null ? "" : i.getDeductionReasons().replace("\n", " / "));
            }
            writeRow(detail, r, header, "합계", "", calc.getItems().stream().mapToLong(FeeCalculationItem::getBaseCount).sum(),
                    calc.getItems().stream().mapToLong(FeeCalculationItem::getDeduction).sum(),
                    calc.getTotalFinalCount(), "", calc.getItems().stream().mapToLong(FeeCalculationItem::getEqualFee).sum(),
                    calc.getItems().stream().mapToLong(FeeCalculationItem::getPerfFee).sum(), calc.getTotalFeeAmount(),
                    calc.getItems().stream().mapToLong(FeeCalculationItem::getBeforeSpecialFee).sum(),
                    calc.getItems().stream().mapToLong(FeeCalculationItem::getSpecialAdjustment).sum(), "", "");
            autosize(detail, 13);

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

    private Long readCount(Cell cell, DataFormatter fmt) {
        if (cell == null) {
            return null;
        }
        if (cell.getCellType() == CellType.NUMERIC
                || (cell.getCellType() == CellType.FORMULA && cell.getCachedFormulaResultType() == CellType.NUMERIC)) {
            return Math.round(cell.getNumericCellValue());
        }
        String digits = fmt.formatCellValue(cell).replaceAll("[,\\s건]", "");
        return digits.matches("\\d+") ? Long.parseLong(digits) : null;
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
