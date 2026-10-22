package com.kftc.feecalc.domain.user.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import com.kftc.feecalc.domain.user.entity.Member;
import com.kftc.feecalc.domain.user.entity.TaskPermission;

/** 회원 정보. role/status 는 프론트엔드에서 쓰는 값(operator, 정상 …)과 맞춘다. */
public record MemberResponse(
        String id,
        String name,
        String role,
        String roleLabel,
        String side,
        String home,
        String institutionId,
        String org,
        String dept,
        String empNo,
        String email,
        String extension,
        String status,
        LocalDate joinedAt,
        boolean locked,
        int failCount,
        LocalDateTime lockedAt,
        List<String> tasks) {

    public static MemberResponse from(Member m) {
        return new MemberResponse(
                m.getLoginId(), m.getName(),
                m.getRole().getCode(), m.getRole().getLabel(), m.getRole().getSide(), m.getRole().getHome(),
                m.getInstitutionCode(), m.getOrg(), m.getDept(), m.getEmpNo(), m.getEmail(), m.getExtension(),
                m.getStatus().getLabel(), m.getJoinedAt(),
                m.isLocked(), m.getFailCount(), m.getLockedAt(),
                m.getTaskPermissions().stream().map(TaskPermission::getBusinessCode).toList());
    }
}
