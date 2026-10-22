package com.kftc.feecalc.domain.fee.entity;

import java.util.ArrayList;
import java.util.List;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 업무별 회비 기준 (오픈뱅킹, 금거정, CMS, CD공동망, 타행환) */
@Entity
@Table(name = "business")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Business {

    /** 업무 코드. 프론트엔드 BUSINESSES[].id 와 같다 (예: openbanking) */
    @Id
    @Column(length = 30)
    private String code;

    @Column(nullable = false, length = 50)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private CalcMethod method;

    /** UNIT 방식 건당 단가(원) */
    private Long unitPrice;

    /** RATIO 방식 분기 총액(원) */
    private Long totalFee;

    /** 한 분기(91일) 기준 전체 실적 건수. 업로드가 없을 때 시연용 실적 생성에 쓴다 */
    private long baseVolume;

    /** 수입결의 수입과목 (예: 41101 회비수입-오픈뱅킹) */
    private String revenueAccount;

    private int sortOrder;

    /** 회비분담기준 요약 문구 */
    @ElementCollection
    @CollectionTable(name = "business_rule_summary", joinColumns = @JoinColumn(name = "business_code"))
    @OrderColumn(name = "line_no")
    @Column(name = "line", length = 300)
    private List<String> summary = new ArrayList<>();

    @Builder
    private Business(String code, String name, CalcMethod method, Long unitPrice, Long totalFee, long baseVolume,
                     String revenueAccount, int sortOrder, List<String> summary) {
        this.code = code;
        this.name = name;
        this.method = method;
        this.unitPrice = unitPrice;
        this.totalFee = totalFee;
        this.baseVolume = baseVolume;
        this.revenueAccount = revenueAccount;
        this.sortOrder = sortOrder;
        if (summary != null) {
            this.summary.addAll(summary);
        }
    }

    /** 단가·총액 기준 변경 (기준 관리 API) */
    public void updateRate(Long unitPrice, Long totalFee) {
        if (method == CalcMethod.UNIT && unitPrice != null) {
            this.unitPrice = unitPrice;
        }
        if (method == CalcMethod.RATIO && totalFee != null) {
            this.totalFee = totalFee;
        }
    }
}
