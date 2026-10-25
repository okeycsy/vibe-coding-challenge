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

/** 산출에 입력한 AI 이슈(예외 차감 요청) 문장과 해석 결과 */
@Entity
@Table(name = "ai_issue")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AiIssue {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "calculation_id")
    private FeeCalculation calculation;

    @Column(nullable = false, length = 1000)
    private String text;

    private String institutionCode;
    private String institutionName;
    private String matchedAlias;
    private Long count;
    /** "5/3" 형태 */
    private String issueDate;
    private String reason;

    /** 기관과 건수를 모두 찾고, "## 2. AI 예외 차감 지침"상 차감 대상이라 차감에 반영했는지 */
    private boolean applied;

    /** 차감 여부 판별 근거 (AI 또는 규칙 기반) */
    @Column(length = 500)
    private String judgement;

    @Builder
    private AiIssue(String text, String institutionCode, String institutionName, String matchedAlias, Long count,
                    String issueDate, String reason, boolean applied, String judgement) {
        this.text = text;
        this.institutionCode = institutionCode;
        this.institutionName = institutionName;
        this.matchedAlias = matchedAlias;
        this.count = count;
        this.issueDate = issueDate;
        this.reason = reason;
        this.applied = applied;
        this.judgement = judgement;
    }

    void attach(FeeCalculation calculation) {
        this.calculation = calculation;
    }
}
