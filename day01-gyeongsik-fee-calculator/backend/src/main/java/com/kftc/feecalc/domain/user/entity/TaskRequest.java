package com.kftc.feecalc.domain.user.entity;

import java.time.LocalDateTime;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 담당 업무 추가 신청. 관리자가 승인하면 TaskPermission 이 생긴다. */
@Entity
@Table(name = "task_request")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class TaskRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "member_id")
    private Member member;

    @Column(nullable = false, length = 30)
    private String businessCode;

    @Column(length = 500)
    private String reason;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private TaskRequestStatus status;

    private LocalDateTime requestedAt;
    private LocalDateTime decidedAt;

    public TaskRequest(Member member, String businessCode, String reason, LocalDateTime requestedAt) {
        this.member = member;
        this.businessCode = businessCode;
        this.reason = reason;
        this.status = TaskRequestStatus.PENDING;
        this.requestedAt = requestedAt;
    }

    public void approve(LocalDateTime now) {
        decide(TaskRequestStatus.APPROVED, now);
        member.grantTask(businessCode, now);
    }

    public void reject(LocalDateTime now) {
        decide(TaskRequestStatus.REJECTED, now);
    }

    private void decide(TaskRequestStatus next, LocalDateTime now) {
        if (status != TaskRequestStatus.PENDING) {
            throw new BusinessException(ErrorCode.INVALID_STATE, "이미 처리된 신청입니다.");
        }
        this.status = next;
        this.decidedAt = now;
    }
}
