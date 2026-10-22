package com.kftc.feecalc.domain.reconcile.entity;

import java.time.LocalDateTime;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 참가기관 연동 테스트 결과 */
@Entity
@Table(name = "test_result")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class TestResult {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 30)
    private String institutionCode;
    private String institutionName;

    @Column(nullable = false, length = 30)
    private String businessCode;
    private String businessName;

    /** 테스트 항목 (예: 출금이체 API 연동) */
    @Column(nullable = false)
    private String item;

    private LocalDateTime testedAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private TestResultStatus result;

    @Column(length = 500)
    private String note;

    private int retestCount;

    @Builder
    private TestResult(String institutionCode, String institutionName, String businessCode, String businessName,
                       String item, LocalDateTime testedAt, TestResultStatus result, String note) {
        this.institutionCode = institutionCode;
        this.institutionName = institutionName;
        this.businessCode = businessCode;
        this.businessName = businessName;
        this.item = item;
        this.testedAt = testedAt;
        this.result = result;
        this.note = note;
    }

    public void update(TestResultStatus result, String note, LocalDateTime now) {
        this.result = result;
        if (note != null) {
            this.note = note;
        }
        this.testedAt = now;
    }

    /** 재테스트 요청: 진행중으로 바꾸고 횟수를 올린다 */
    public void requestRetest(LocalDateTime now) {
        this.result = TestResultStatus.IN_PROGRESS;
        this.retestCount++;
        this.note = "재테스트 요청 (" + retestCount + "회차)";
        this.testedAt = now;
    }
}
