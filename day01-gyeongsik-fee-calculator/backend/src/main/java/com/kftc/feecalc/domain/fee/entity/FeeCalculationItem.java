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

    /** Step 1 결과(원): skill.md "## 3. 정산 수식" + 원 단위 배분. "## 4. 최종 정산 특이사항" 보정 전 금액 */
    private long beforeSpecialFee;

    /** 최종 산출 회비(원) = 균등분담분 + 실적분담분 = 보정 전 금액 + 특이사항 보정액 */
    private long fee;

    /** 균등분담분(원). 균등+실적 혼합형이 아니면 0 */
    private long equalFee;

    /** 실적분담분(원) = 최종 회비 - 균등분담분 (특이사항 보정액은 여기에 들어간다) */
    private long perfFee;

    /** Step 2("## 4. 최종 정산 특이사항")로 금액이 바뀌었는지 */
    private boolean specialRuleApplied;

    /** 특이사항 보정액(원, 최종 - 보정 전). 예: +6, -1 */
    private long specialAdjustment;

    /** 특이사항 보정 사유. 예: "특이사항 반영: 10원 단위 절상 (+6원)". 보정이 없으면 null */
    @Column(length = 500)
    private String specialReason;

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

    public void applyFee(long beforeSpecialFee, long equalFee, long fee, String specialReason, String rateLabel) {
        this.beforeSpecialFee = beforeSpecialFee;
        this.fee = fee;
        this.equalFee = equalFee;
        this.perfFee = fee - equalFee;
        this.specialRuleApplied = specialReason != null;
        this.specialAdjustment = fee - beforeSpecialFee;
        this.specialReason = specialReason;
        this.rateLabel = rateLabel;
    }
}
