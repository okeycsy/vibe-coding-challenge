package com.kftc.feecalc.domain.auth.service;

import java.time.LocalDateTime;
import java.util.List;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.kftc.feecalc.common.config.AppProperties;
import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;
import com.kftc.feecalc.domain.auth.dto.LockedAccountResponse;
import com.kftc.feecalc.domain.auth.dto.LoginFailure;
import com.kftc.feecalc.domain.auth.dto.LoginHistoryResponse;
import com.kftc.feecalc.domain.auth.dto.LoginRequest;
import com.kftc.feecalc.domain.auth.entity.LoginHistory;
import com.kftc.feecalc.domain.auth.entity.LoginResult;
import com.kftc.feecalc.domain.auth.repository.LoginHistoryRepository;
import com.kftc.feecalc.domain.user.dto.MemberResponse;
import com.kftc.feecalc.domain.user.entity.Member;
import com.kftc.feecalc.domain.user.entity.MemberStatus;
import com.kftc.feecalc.domain.user.repository.MemberRepository;

import lombok.RequiredArgsConstructor;

/**
 * 로그인과 비밀번호 연속 오류 잠금.
 * 실패해도 오류 횟수·이력은 저장해야 하므로 BusinessException 으로는 롤백하지 않는다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AuthService {

    private final MemberRepository memberRepository;
    private final LoginHistoryRepository loginHistoryRepository;
    private final PasswordEncoder passwordEncoder;
    private final AppProperties properties;

    @Transactional(noRollbackFor = BusinessException.class)
    public MemberResponse login(LoginRequest req, String ip, String device) {
        LocalDateTime now = LocalDateTime.now();
        // 없는 아이디도 같은 문구로 응답해 계정 존재 여부를 노출하지 않는다
        Member member = memberRepository.findByLoginId(req.id())
                .orElseThrow(() -> new BusinessException(ErrorCode.LOGIN_FAILED));

        if (member.isLocked()) {
            record(member, LoginResult.LOCKED, ip, device, now);
            throw new BusinessException(ErrorCode.ACCOUNT_LOCKED, ErrorCode.ACCOUNT_LOCKED.getMessage(),
                    new LoginFailure(member.getFailCount(), 0, true));
        }

        if (!passwordEncoder.matches(req.password(), member.getPasswordHash())) {
            int max = properties.auth().maxFailCount();
            int remaining = member.recordLoginFailure(max, now);
            record(member, LoginResult.WRONG_PASSWORD, ip, device, now);
            LoginFailure failure = new LoginFailure(member.getFailCount(), remaining, member.isLocked());
            if (member.isLocked()) {
                throw new BusinessException(ErrorCode.ACCOUNT_LOCKED,
                        "비밀번호를 " + max + "회 잘못 입력해 계정이 잠겼습니다. 관리자에게 잠금 해제를 요청해 주세요.", failure);
            }
            throw new BusinessException(ErrorCode.LOGIN_FAILED,
                    "아이디 또는 비밀번호가 올바르지 않습니다. (" + member.getFailCount() + "/" + max + "회, "
                            + remaining + "회 더 틀리면 잠깁니다)", failure);
        }

        if (member.getStatus() != MemberStatus.ACTIVE) {
            record(member, LoginResult.NOT_APPROVED, ip, device, now);
            throw new BusinessException(member.getStatus() == MemberStatus.PENDING
                    ? ErrorCode.ACCOUNT_PENDING : ErrorCode.ACCOUNT_REJECTED);
        }

        member.resetLoginFailure();
        record(member, LoginResult.SUCCESS, ip, device, now);
        // TODO: 세션 또는 JWT 발급 (현재는 회원 정보만 돌려주고 프론트가 상태로 보관)
        return MemberResponse.from(member);
    }

    @Transactional
    public void logout(String loginId, String ip, String device) {
        memberRepository.findByLoginId(loginId)
                .ifPresent(m -> record(m, LoginResult.LOGOUT, ip, device, LocalDateTime.now()));
    }

    public List<LockedAccountResponse> getLockedAccounts() {
        return memberRepository.findByLockedAtIsNotNullOrderByLockedAtDesc().stream()
                .map(LockedAccountResponse::from).toList();
    }

    /** 잠금 초기화: 관리자 잠금 해제, 로그인 화면의 시연용 초기화 버튼이 함께 쓴다 */
    @Transactional
    public void unlock(String loginId) {
        Member member = memberRepository.findByLoginId(loginId)
                .orElseThrow(() -> new BusinessException(ErrorCode.MEMBER_NOT_FOUND));
        member.resetLoginFailure();
        record(member, LoginResult.UNLOCKED, null, null, LocalDateTime.now());
    }

    /** 관리자 비밀번호 초기화: 기본 비밀번호로 되돌리고 잠금도 푼다 */
    @Transactional
    public void resetPassword(String loginId, String defaultPassword) {
        Member member = memberRepository.findByLoginId(loginId)
                .orElseThrow(() -> new BusinessException(ErrorCode.MEMBER_NOT_FOUND));
        member.changePassword(passwordEncoder.encode(defaultPassword));
        member.resetLoginFailure();
    }

    public List<LoginHistoryResponse> getHistory(String loginId) {
        return loginHistoryRepository.findTop20ByLoginIdOrderByAtDesc(loginId).stream()
                .map(LoginHistoryResponse::from).toList();
    }

    private void record(Member member, LoginResult result, String ip, String device, LocalDateTime at) {
        loginHistoryRepository.save(new LoginHistory(member.getLoginId(), result, ip, device, at));
    }
}
