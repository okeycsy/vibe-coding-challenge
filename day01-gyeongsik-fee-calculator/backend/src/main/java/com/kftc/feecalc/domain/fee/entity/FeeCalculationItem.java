package com.kftc.feecalc.domain.fee.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 기관별 산출 결과 행 */
@Entity
@Table(name = "fee_calculation_item")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class FeeCalculationItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "calculation_id")
    private FeeCalculation calculation;

    @Column(nullable = false, length = 30)
    private String institutionCode;

    private String institutionName;
    private String bankCode;

    private long baseCount;
    /** AI 이슈로 차감한 건수 */
    private long deduction;
    private long finalCount;

    /** 화면 표시용: "20원/건" 또는 "12.34%" */
    private String rateLabel;

    /** 1차 산출 회비(원): skill.md 수식 결과 */
    private long primaryFee;

    /** 최종 산출 회비(원): 1차 회비에 "## 1. 비즈니스 규칙 요약"의 단수 처리·예외 규정을 반영한 값 */
    private long fee;

    /** AI(또는 규칙 기반) 최종 보정 사유. 보정이 없으면 null */
    @Column(length = 500)
    private String aiAdjustReason;

    /** 차감 사유(이슈 원문) */
    @Column(length = 2000)
    private String deductionReasons;

    private int sortOrder;

    @Builder
    private FeeCalculationItem(String institutionCode, String institutionName, String bankCode, long baseCount,
                               long deduction, String deductionReasons, int sortOrder) {
        this.institutionCode = institutionCode;
        this.institutionName = institutionName;
        this.bankCode = bankCode;
        this.baseCount = baseCount;
        this.deduction = deduction;
        this.finalCount = baseCount - deduction;
        this.deductionReasons = deductionReasons;
        this.sortOrder = sortOrder;
    }

    void attach(FeeCalculation calculation) {
        this.calculation = calculation;
    }

    public void applyFee(long primaryFee, long fee, String aiAdjustReason, String rateLabel) {
        this.primaryFee = primaryFee;
        this.fee = fee;
        this.aiAdjustReason = aiAdjustReason;
        this.rateLabel = rateLabel;
    }
}
