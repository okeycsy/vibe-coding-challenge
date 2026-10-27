package com.kftc.feecalc.domain.fee.controller;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;

import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.kftc.feecalc.common.dto.ApiResponse;
import com.kftc.feecalc.domain.fee.dto.BusinessRateUpdateRequest;
import com.kftc.feecalc.domain.fee.dto.BusinessResponse;
import com.kftc.feecalc.domain.fee.dto.CalculationRequest;
import com.kftc.feecalc.domain.fee.dto.CalculationResponse;
import com.kftc.feecalc.domain.fee.dto.CalculationSummary;
import com.kftc.feecalc.domain.fee.dto.InstitutionResponse;
import com.kftc.feecalc.domain.fee.dto.IssueParseRequest;
import com.kftc.feecalc.domain.fee.dto.ParsedIssue;
import com.kftc.feecalc.domain.fee.dto.UploadResult;
import com.kftc.feecalc.domain.fee.service.FeeCalculationService;
import com.kftc.feecalc.domain.fee.service.FeeExcelService;
import com.kftc.feecalc.domain.fee.service.FeeExcelService.ExcelFile;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

/** 업무별 회비 기준, 엑셀 업로드/다운로드, AI 예외 차감 산출 */
@RestController
@RequestMapping("/api/fee")
@RequiredArgsConstructor
public class FeeController {

    private static final MediaType XLSX =
            MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    private final FeeCalculationService calculationService;
    private final FeeExcelService excelService;

    // ---------- 회비 기준 ----------

    @GetMapping("/businesses")
    public ApiResponse<List<BusinessResponse>> getBusinesses() {
        return ApiResponse.ok(calculationService.getBusinesses());
    }

    @GetMapping("/businesses/{code}")
    public ApiResponse<BusinessResponse> getBusiness(@PathVariable String code) {
        return ApiResponse.ok(calculationService.getBusinessInfo(code));
    }

    @PutMapping("/businesses/{code}/rate")
    public ApiResponse<BusinessResponse> updateRate(@PathVariable String code,
                                                    @Valid @RequestBody BusinessRateUpdateRequest request) {
        return ApiResponse.ok("회비 기준을 변경했습니다.", calculationService.updateRate(code, request));
    }

    @GetMapping("/institutions")
    public ApiResponse<List<InstitutionResponse>> getInstitutions() {
        return ApiResponse.ok(calculationService.getInstitutions());
    }

    // ---------- 엑셀 업로드 ----------

    /** from·to 를 주면 그 기간 밖 날짜의 행은 빼고 excluded 로 알려 준다 */
    @PostMapping(value = "/uploads", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<UploadResult> upload(@RequestParam("file") MultipartFile file,
                                            @RequestParam(value = "from", required = false) LocalDate from,
                                            @RequestParam(value = "to", required = false) LocalDate to) {
        UploadResult result = excelService.parseUpload(file, from, to);
        int excludedRows = result.excluded().stream().mapToInt(UploadResult.Excluded::rows).sum() + result.unreadableRows();
        String msg = "실적 " + result.rowCount() + "행을 읽었습니다."
                + (excludedRows > 0 ? " 기간 밖·날짜 불명 " + excludedRows + "행은 제외했습니다." : "")
                + (result.unmatched().isEmpty() ? "" : " 기관을 찾지 못한 " + result.unmatched().size() + "곳은 제외했습니다.");
        return ApiResponse.ok(msg, result);
    }

    @GetMapping("/uploads/template")
    public ResponseEntity<byte[]> uploadTemplate() {
        return download(excelService.uploadTemplate());
    }

    // ---------- AI 이슈 ----------

    /** 이슈 문장 미리보기 해석 (산출 전 태그 표시용) */
    @PostMapping("/issues/parse")
    public ApiResponse<ParsedIssue> parseIssue(@Valid @RequestBody IssueParseRequest request) {
        return ApiResponse.ok(calculationService.parseIssue(request.text()));
    }

    // ---------- 산출 ----------

    @PostMapping("/calculations")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<CalculationResponse> calculate(@Valid @RequestBody CalculationRequest request) {
        return ApiResponse.ok("회비 초안을 산출했습니다.", calculationService.calculate(request));
    }

    @GetMapping("/calculations")
    public ApiResponse<List<CalculationSummary>> getCalculations() {
        return ApiResponse.ok(calculationService.getCalculations());
    }

    @GetMapping("/calculations/{id}")
    public ApiResponse<CalculationResponse> getCalculation(@PathVariable Long id) {
        return ApiResponse.ok(calculationService.getCalculationInfo(id));
    }

    /** 참가기관 송부 대사용 엑셀 */
    @GetMapping("/calculations/{id}/excel/reconcile")
    public ResponseEntity<byte[]> downloadReconcile(@PathVariable Long id) {
        return download(excelService.reconcileWorkbook(id));
    }

    /** 수입결의용 엑셀 */
    @GetMapping("/calculations/{id}/excel/revenue")
    public ResponseEntity<byte[]> downloadRevenue(@PathVariable Long id) {
        return download(excelService.revenueWorkbook(id));
    }

    private ResponseEntity<byte[]> download(ExcelFile file) {
        return ResponseEntity.ok()
                .contentType(XLSX)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(file.fileName(), StandardCharsets.UTF_8).build().toString())
                .body(file.content());
    }
}
