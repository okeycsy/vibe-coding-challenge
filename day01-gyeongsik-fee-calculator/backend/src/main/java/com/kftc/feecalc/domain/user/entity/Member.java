package com.kftc.feecalc.domain.user.entity;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 회원 = 로그인 계정. 비밀번호 오류 횟수와 잠금 시각도 함께 관리한다. */
@Entity
@Table(name = "member")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Member {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 30)
    private String loginId;

    @Column(nullable = false)
    private String passwordHash;

    @Column(nullable = false, length = 50)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private MemberRole role;

    /** 참가기관 담당자일 때 소속 기관 코드 (Institution.code) */
    @Column(length = 30)
    private String institutionCode;

    @Column(nullable = false, length = 50)
    private String org;

    private String dept;
    private String empNo;
    private String email;
    private String extension;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private MemberStatus status;

    private LocalDate joinedAt;

    /** 연속 비밀번호 오류 횟수 */
    private int failCount;

    /** 잠긴 시각. null 이면 잠기지 않음 */
    private LocalDateTime lockedAt;

    @OneToMany(mappedBy = "member", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<TaskPermission> taskPermissions = new ArrayList<>();

    @Builder
    private Member(String loginId, String passwordHash, String name, MemberRole role, String institutionCode,
                   String org, String dept, String empNo, String email, String extension,
                   MemberStatus status, LocalDate joinedAt) {
        this.loginId = loginId;
        this.passwordHash = passwordHash;
        this.name = name;
        this.role = role;
        this.institutionCode = institutionCode;
        this.org = org;
        this.dept = dept;
        this.empNo = empNo;
        this.email = email;
        this.extension = extension;
        this.status = status == null ? MemberStatus.PENDING : status;
        this.joinedAt = joinedAt;
    }

    public boolean isLocked() {
        return lockedAt != null;
    }

    /** 오류 횟수를 올리고, 최대 횟수에 닿으면 잠근다. 남은 시도 횟수를 돌려준다. */
    public int recordLoginFailure(int maxFailCount, LocalDateTime now) {
        failCount++;
        if (failCount >= maxFailCount) {
            lockedAt = now;
        }
        return Math.max(0, maxFailCount - failCount);
    }

    public void resetLoginFailure() {
        failCount = 0;
        lockedAt = null;
    }

    /** 시연 데이터용: 이미 잠긴 상태로 만든다 */
    public void lock(int failCount, LocalDateTime lockedAt) {
        this.failCount = failCount;
        this.lockedAt = lockedAt;
    }

    public void changePassword(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public void updateProfile(String dept, String email, String extension) {
        this.dept = dept;
        this.email = email;
        this.extension = extension;
    }

    public void approve() {
        this.status = MemberStatus.ACTIVE;
    }

    public void reject() {
        this.status = MemberStatus.REJECTED;
    }

    public boolean hasTask(String businessCode) {
        return taskPermissions.stream().anyMatch(p -> p.getBusinessCode().equals(businessCode));
    }

    /** 업무 산출 권한: 관리자는 전체, 사용자는 부여받은 업무만, 참가기관은 산출하지 않음 */
    public boolean canCalculate(String businessCode) {
        return switch (role) {
            case SYSADMIN -> true;
            case OPERATOR -> hasTask(businessCode);
            case INSTITUTION -> false;
        };
    }

    public void grantTask(String businessCode, LocalDateTime now) {
        if (!hasTask(businessCode)) {
            taskPermissions.add(new TaskPermission(this, businessCode, now));
        }
    }

    public void revokeTask(String businessCode) {
        taskPermissions.removeIf(p -> p.getBusinessCode().equals(businessCode));
    }
}
