package com.kftc.feecalc.domain.user.entity;

import java.time.LocalDateTime;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 회원별 담당 업무(산출 권한). RBAC의 권한 단위는 업무 코드(Business.code)다. */
@Entity
@Table(name = "task_permission",
        uniqueConstraints = @UniqueConstraint(columnNames = {"member_id", "business_code"}))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class TaskPermission {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "member_id")
    private Member member;

    @Column(name = "business_code", nullable = false, length = 30)
    private String businessCode;

    private LocalDateTime grantedAt;

    TaskPermission(Member member, String businessCode, LocalDateTime grantedAt) {
        this.member = member;
        this.businessCode = businessCode;
        this.grantedAt = grantedAt;
    }
}
