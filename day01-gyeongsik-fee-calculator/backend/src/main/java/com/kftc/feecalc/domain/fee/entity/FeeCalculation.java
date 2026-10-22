package com.kftc.feecalc.domain.fee.entity;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 업무·기간별 회비 산출 1회분 (헤더) */
@Entity
@Table(name = "fee_calculation")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class FeeCalculation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "business_code")
    private Business business;

    @Column(nullable = false)
    private LocalDate periodFrom;

    @Column(nullable = false)
    private LocalDate periodTo;

    /** 분기 기준 값에 곱한 비율 (정확히 한 분기면 1, 아니면 일수 ÷ 91) */
    private double periodScale;

    /** 산출에 적용한 단가(UNIT) 또는 기간 환산 총액(RATIO) */
    private Long appliedUnitPrice;
    private Long appliedTotalFee;

    /** 실적 출처: UPLOAD(엑셀 업로드) | DEMO(시연용 생성) */
    @Column(length = 10)
    private String source;

    private String uploadFileName;

    @Column(length = 30)
    private String calculatedBy;

    private LocalDateTime calculatedAt;

    @OneToMany(mappedBy = "calculation", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("sortOrder")
    private List<FeeCalculationItem> items = new ArrayList<>();

    @OneToMany(mappedBy = "calculation", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("id")
    private List<AiIssue> issues = new ArrayList<>();

    @Builder
    private FeeCalculation(Business business, LocalDate periodFrom, LocalDate periodTo, double periodScale,
                           Long appliedUnitPrice, Long appliedTotalFee, String source, String uploadFileName,
                           String calculatedBy, LocalDateTime calculatedAt) {
        this.business = business;
        this.periodFrom = periodFrom;
        this.periodTo = periodTo;
        this.periodScale = periodScale;
        this.appliedUnitPrice = appliedUnitPrice;
        this.appliedTotalFee = appliedTotalFee;
        this.source = source;
        this.uploadFileName = uploadFileName;
        this.calculatedBy = calculatedBy;
        this.calculatedAt = calculatedAt;
    }

    public void addItem(FeeCalculationItem item) {
        items.add(item);
        item.attach(this);
    }

    public void addIssue(AiIssue issue) {
        issues.add(issue);
        issue.attach(this);
    }

    public long getTotalFinalCount() {
        return items.stream().mapToLong(FeeCalculationItem::getFinalCount).sum();
    }

    public long getTotalFeeAmount() {
        return items.stream().mapToLong(FeeCalculationItem::getFee).sum();
    }
}
