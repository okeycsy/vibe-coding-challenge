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

    /** 산출에 적용한 단가(UNIT) 또는 기간 환산 총액(RATIO). skill.md 엔진 도입 후에는 appliedTotalFee = 회비 합계 */
    private Long appliedUnitPrice;
    private Long appliedTotalFee;

    /** 산출에 적용한 skill.md 업무 코드·산정 유형·SpEL 수식 (나중에 기준이 바뀌어도 근거를 남긴다) */
    @Column(length = 30)
    private String skillCode;

    @Column(length = 100)
    private String appliedCalcType;

    @Column(length = 2000)
    private String appliedFormula;

    /** 산출에 적용한 "## 4. 최종 정산 특이사항" 원문 (없으면 빈 문자열) */
    @Column(length = 4000)
    private String appliedSpecialRules;

    /** 실적 출처: UPLOAD(엑셀 업로드) | DEMO(시연용 생성) */
    @Column(length = 10)
    private String source;

    private String uploadFileName;

    @Column(length = 30)
    private String calculatedBy;

    private LocalDateTime calculatedAt;

    /** AI 단계(이슈 차감 판별) 동작 방식: AI / RULE(키 없음) / RULE_FALLBACK(AI 실패) */
    @Column(length = 20)
    private String aiMode;

    @Column(length = 60)
    private String aiModel;

    @Column(length = 1000)
    private String aiNote;

    /** "## 4. 최종 정산 특이사항" 해석 방식: AI / RULE(키 없음) / RULE_FALLBACK(AI 실패) */
    @Column(length = 20)
    private String specialRuleMode;

    @Column(length = 60)
    private String specialRuleModel;

    @Column(length = 1000)
    private String specialRuleNote;

    /** 해석된 보정 동작 JSON: {"actions":[...],"unsupported":[...]} */
    @Column(length = 8000)
    private String specialActionsJson;

    @OneToMany(mappedBy = "calculation", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("sortOrder")
    private List<FeeCalculationItem> items = new ArrayList<>();

    @OneToMany(mappedBy = "calculation", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("id")
    private List<AiIssue> issues = new ArrayList<>();

    @Builder
    private FeeCalculation(Business business, LocalDate periodFrom, LocalDate periodTo, double periodScale,
                           Long appliedUnitPrice, Long appliedTotalFee, String skillCode, String appliedCalcType,
                           String appliedFormula, String appliedSpecialRules, String source, String uploadFileName,
                           String calculatedBy, LocalDateTime calculatedAt) {
        this.business = business;
        this.periodFrom = periodFrom;
        this.periodTo = periodTo;
        this.periodScale = periodScale;
        this.appliedUnitPrice = appliedUnitPrice;
        this.appliedTotalFee = appliedTotalFee;
        this.skillCode = skillCode;
        this.appliedCalcType = appliedCalcType;
        this.appliedFormula = appliedFormula;
        this.appliedSpecialRules = appliedSpecialRules;
        this.source = source;
        this.uploadFileName = uploadFileName;
        this.calculatedBy = calculatedBy;
        this.calculatedAt = calculatedAt;
    }

    /** skill.md 수식으로 산출한 뒤 회비 합계를 기록한다 */
    public void applyTotalFee(long totalFee) {
        this.appliedTotalFee = totalFee;
    }

    public void applyAiResult(String aiMode, String aiModel, String aiNote) {
        this.aiMode = aiMode;
        this.aiModel = aiModel;
        this.aiNote = aiNote;
    }

    public void applySpecialInterpretation(String mode, String model, String note, String actionsJson) {
        this.specialRuleMode = mode;
        this.specialRuleModel = model;
        this.specialRuleNote = note;
        this.specialActionsJson = actionsJson;
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
