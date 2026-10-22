package com.kftc.feecalc.domain.reconcile.controller;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.kftc.feecalc.common.dto.ApiResponse;
import com.kftc.feecalc.domain.reconcile.dto.NotificationRequest;
import com.kftc.feecalc.domain.reconcile.dto.NotificationResult;
import com.kftc.feecalc.domain.reconcile.dto.ReconcileRecordResponse;
import com.kftc.feecalc.domain.reconcile.dto.ReconcileSummary;
import com.kftc.feecalc.domain.reconcile.dto.StatusUpdateRequest;
import com.kftc.feecalc.domain.reconcile.dto.TestResultResponse;
import com.kftc.feecalc.domain.reconcile.service.ReconcileService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

/** 참가기관 대사/테스트 결과 관리, 수행률 집계, Mattermost 알림 */
@RestController
@RequestMapping("/api/reconcile")
@RequiredArgsConstructor
public class ReconcileController {

    private final ReconcileService reconcileService;

    // ---------- 대사 ----------

    @GetMapping("/records")
    public ApiResponse<List<ReconcileRecordResponse>> getRecords(@RequestParam(required = false) Long calculationId,
                                                                 @RequestParam(required = false) String institutionId) {
        return ApiResponse.ok(reconcileService.getRecords(calculationId, institutionId));
    }

    /** 결제원: 상태 변경 / 참가기관: 회신(comment)과 함께 상태 변경 */
    @PatchMapping("/records/{id}")
    public ApiResponse<ReconcileRecordResponse> updateStatus(@PathVariable Long id,
                                                             @Valid @RequestBody StatusUpdateRequest request) {
        return ApiResponse.ok("대사 상태를 변경했습니다.", reconcileService.updateStatus(id, request));
    }

    /** 참가기관 송부 (대기 → 확인중) */
    @PostMapping("/calculations/{calculationId}/send")
    public ApiResponse<List<ReconcileRecordResponse>> send(@PathVariable Long calculationId) {
        return ApiResponse.ok("참가기관에 대사를 요청했습니다.", reconcileService.sendToInstitutions(calculationId));
    }

    // ---------- 수행률 ----------

    @GetMapping("/summary")
    public ApiResponse<ReconcileSummary> getSummary() {
        return ApiResponse.ok(reconcileService.getSummary());
    }

    // ---------- 연동 테스트 ----------

    @GetMapping("/tests")
    public ApiResponse<List<TestResultResponse>> getTests(@RequestParam(required = false) String institutionId) {
        return ApiResponse.ok(reconcileService.getTests(institutionId));
    }

    @PatchMapping("/tests/{id}")
    public ApiResponse<TestResultResponse> updateTest(@PathVariable Long id,
                                                      @Valid @RequestBody StatusUpdateRequest request) {
        return ApiResponse.ok("테스트 결과를 변경했습니다.", reconcileService.updateTest(id, request));
    }

    @PostMapping("/tests/{id}/retest")
    public ApiResponse<TestResultResponse> retest(@PathVariable Long id) {
        return ApiResponse.ok("재테스트를 요청했습니다.", reconcileService.requestRetest(id));
    }

    // ---------- 알림 ----------

    /** 마이페이지 › Mattermost 알림 설정의 테스트 발송 */
    @PostMapping("/notifications/test")
    public ApiResponse<NotificationResult> sendTestNotification(@Valid @RequestBody NotificationRequest request) {
        NotificationResult result = reconcileService.sendTestNotification(request.text());
        return ApiResponse.ok(result.detail(), result);
    }
}
