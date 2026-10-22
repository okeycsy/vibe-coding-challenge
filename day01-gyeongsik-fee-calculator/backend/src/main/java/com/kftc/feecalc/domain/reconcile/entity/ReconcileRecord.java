package com.kftc.feecalc.domain.reconcile.entity;

import java.time.LocalDateTime;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 산출 결과 기관별 대사 현황. 회비 산출이 끝나면 기관마다 하나씩 '대기'로 생긴다.
 * fee 도메인과는 산출 ID로만 연결하고, 화면 표시용 값은 만들 때 복사해 둔다.
 */
@Entity
@Table(name = "reconcile_record", indexes = @Index(columnList = "calculationId"))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ReconcileRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long calculationId;

    @Column(nullable = false, length = 30)
    private String businessCode;
    private String businessName;
    private String periodLabel;

    @Column(nullable = false, length = 30)
    private String institutionCode;
    private String institutionName;

    private long finalCount;
    private long fee;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ReconcileStatus status;

    /** 참가기관 회신 내용 */
    @Column(length = 1000)
    private String comment;

    private LocalDateTime sentAt;
    private LocalDateTime updatedAt;

    @Builder
    private ReconcileRecord(Long calculationId, String businessCode, String businessName, String periodLabel,
                            String institutionCode, String institutionName, long finalCount, long fee,
                            LocalDateTime createdAt) {
        this.calculationId = calculationId;
        this.businessCode = businessCode;
        this.businessName = businessName;
        this.periodLabel = periodLabel;
        this.institutionCode = institutionCode;
        this.institutionName = institutionName;
        this.finalCount = finalCount;
        this.fee = fee;
        this.status = ReconcileStatus.WAITING;
        this.updatedAt = createdAt;
    }

    /** 참가기관 송부: 대기 → 확인중 */
    public boolean markSent(LocalDateTime now) {
        if (status != ReconcileStatus.WAITING) {
            return false;
        }
        status = ReconcileStatus.CHECKING;
        sentAt = now;
        updatedAt = now;
        return true;
    }

    public void changeStatus(ReconcileStatus next, String comment, LocalDateTime now) {
        this.status = next;
        if (comment != null) {
            this.comment = comment;
        }
        this.updatedAt = now;
    }
}
