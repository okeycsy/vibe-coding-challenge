package com.kftc.feecalc.domain.auth.dto;

import java.time.LocalDateTime;

import com.kftc.feecalc.domain.user.entity.Member;

public record LockedAccountResponse(String id, String name, String org, int failCount, LocalDateTime lockedAt) {

    public static LockedAccountResponse from(Member m) {
        return new LockedAccountResponse(m.getLoginId(), m.getName(), m.getOrg(), m.getFailCount(), m.getLockedAt());
    }
}
