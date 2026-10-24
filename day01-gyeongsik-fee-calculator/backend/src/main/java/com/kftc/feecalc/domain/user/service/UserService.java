package com.kftc.feecalc.domain.user.service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;
import com.kftc.feecalc.domain.fee.repository.BusinessRepository;
import com.kftc.feecalc.domain.user.dto.MemberResponse;
import com.kftc.feecalc.domain.user.dto.PasswordChangeRequest;
import com.kftc.feecalc.domain.user.dto.ProfileUpdateRequest;
import com.kftc.feecalc.domain.user.dto.TaskRequestCreateRequest;
import com.kftc.feecalc.domain.user.dto.TaskRequestResponse;
import com.kftc.feecalc.domain.user.entity.Member;
import com.kftc.feecalc.domain.user.entity.MemberRole;
import com.kftc.feecalc.domain.user.entity.MemberStatus;
import com.kftc.feecalc.domain.user.entity.TaskRequest;
import com.kftc.feecalc.domain.user.entity.TaskRequestStatus;
import com.kftc.feecalc.domain.user.repository.MemberRepository;
import com.kftc.feecalc.domain.user.repository.TaskRequestRepository;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserService {

    private final MemberRepository memberRepository;
    private final TaskRequestRepository taskRequestRepository;
    private final BusinessRepository businessRepository;
    private final PasswordEncoder passwordEncoder;

    public Member getMember(String loginId) {
        return memberRepository.findByLoginId(loginId)
                .orElseThrow(() -> new BusinessException(ErrorCode.MEMBER_NOT_FOUND));
    }

    // ---------- 회원 조회·수정 ----------

    /** 관리자 회원 목록. status: 정상/승인대기/반려(또는 ACTIVE/PENDING/REJECTED), keyword: 이름·ID·소속 */
    public List<MemberResponse> getMembers(String status, String keyword) {
        MemberStatus statusFilter = parseStatus(status);
        String kw = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);
        return memberRepository.findAll().stream()
                .filter(m -> statusFilter == null || m.getStatus() == statusFilter)
                .filter(m -> kw.isEmpty()
                        || m.getLoginId().toLowerCase(Locale.ROOT).contains(kw)
                        || m.getName().contains(kw)
                        || m.getOrg().contains(kw))
                .map(MemberResponse::from)
                .toList();
    }

    public MemberResponse getMemberInfo(String loginId) {
        return MemberResponse.from(getMember(loginId));
    }

    @Transactional
    public MemberResponse updateProfile(String loginId, ProfileUpdateRequest req) {
        Member member = getMember(loginId);
        member.updateProfile(req.dept(), req.email(), req.extension());
        return MemberResponse.from(member);
    }

    @Transactional
    public void changePassword(String loginId, PasswordChangeRequest req) {
        Member member = getMember(loginId);
        if (!passwordEncoder.matches(req.currentPassword(), member.getPasswordHash())) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "현재 비밀번호가 일치하지 않습니다.");
        }
        member.changePassword(passwordEncoder.encode(req.newPassword()));
    }

    @Transactional
    public MemberResponse approveSignUp(String loginId) {
        Member member = getMember(loginId);
        requirePending(member);
        member.approve();
        return MemberResponse.from(member);
    }

    @Transactional
    public MemberResponse rejectSignUp(String loginId) {
        Member member = getMember(loginId);
        requirePending(member);
        member.reject();
        return MemberResponse.from(member);
    }

    // ---------- 담당 업무 권한(RBAC) ----------

    public List<String> getTasks(String loginId) {
        Member member = getMember(loginId);
        if (member.getRole() == MemberRole.SYSADMIN) {
            return businessRepository.findAllByOrderBySortOrder().stream().map(b -> b.getCode()).toList();
        }
        return MemberResponse.from(member).tasks();
    }

    /** 산출 API에서 호출: 해당 업무를 산출할 수 있는지 확인 */
    public void checkCalculatePermission(String loginId, String businessCode) {
        if (!getMember(loginId).canCalculate(businessCode)) {
            throw new BusinessException(ErrorCode.NO_TASK_PERMISSION);
        }
    }

    /** 회비 기준(skill.md) 수정 API에서 호출: 시스템관리자만 수정할 수 있다 */
    public void checkSysadmin(String loginId) {
        if (loginId == null || loginId.isBlank() || getMember(loginId).getRole() != MemberRole.SYSADMIN) {
            throw new BusinessException(ErrorCode.ADMIN_ONLY);
        }
    }

    @Transactional
    public TaskRequestResponse requestTask(String loginId, TaskRequestCreateRequest req) {
        Member member = getMember(loginId);
        requireBusiness(req.businessCode());
        if (member.getRole() != MemberRole.OPERATOR) {
            throw new BusinessException(ErrorCode.INVALID_STATE, "업무 권한 신청은 일반 사용자만 할 수 있습니다.");
        }
        if (member.hasTask(req.businessCode())) {
            throw new BusinessException(ErrorCode.ALREADY_GRANTED);
        }
        if (taskRequestRepository.existsByMemberAndBusinessCodeAndStatus(member, req.businessCode(), TaskRequestStatus.PENDING)) {
            throw new BusinessException(ErrorCode.DUPLICATE_TASK_REQUEST);
        }
        TaskRequest saved = taskRequestRepository.save(
                new TaskRequest(member, req.businessCode(), req.reason(), LocalDateTime.now()));
        return TaskRequestResponse.from(saved);
    }

    public List<TaskRequestResponse> getMyTaskRequests(String loginId) {
        return taskRequestRepository.findByMemberOrderByRequestedAtDesc(getMember(loginId)).stream()
                .map(TaskRequestResponse::from).toList();
    }

    /** 관리자: 권한 신청 목록. status 가 비어 있으면 전체 */
    public List<TaskRequestResponse> getTaskRequests(String status) {
        List<TaskRequest> list = (status == null || status.isBlank())
                ? taskRequestRepository.findAllByOrderByRequestedAtDesc()
                : taskRequestRepository.findByStatusOrderByRequestedAtDesc(TaskRequestStatus.valueOf(status.toUpperCase(Locale.ROOT)));
        return list.stream().map(TaskRequestResponse::from).toList();
    }

    @Transactional
    public TaskRequestResponse approveTaskRequest(Long requestId) {
        TaskRequest request = getTaskRequest(requestId);
        request.approve(LocalDateTime.now());
        return TaskRequestResponse.from(request);
    }

    @Transactional
    public TaskRequestResponse rejectTaskRequest(Long requestId) {
        TaskRequest request = getTaskRequest(requestId);
        request.reject(LocalDateTime.now());
        return TaskRequestResponse.from(request);
    }

    /** 관리자: 신청 없이 직접 부여 */
    @Transactional
    public MemberResponse grantTask(String loginId, String businessCode) {
        Member member = getMember(loginId);
        requireBusiness(businessCode);
        if (member.getRole() != MemberRole.OPERATOR) {
            throw new BusinessException(ErrorCode.INVALID_STATE, "업무 권한은 일반 사용자에게만 부여합니다.");
        }
        member.grantTask(businessCode, LocalDateTime.now());
        return MemberResponse.from(member);
    }

    @Transactional
    public MemberResponse revokeTask(String loginId, String businessCode) {
        Member member = getMember(loginId);
        member.revokeTask(businessCode);
        return MemberResponse.from(member);
    }

    private TaskRequest getTaskRequest(Long id) {
        return taskRequestRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ErrorCode.TASK_REQUEST_NOT_FOUND));
    }

    private void requireBusiness(String businessCode) {
        if (!businessRepository.existsById(businessCode)) {
            throw new BusinessException(ErrorCode.BUSINESS_NOT_FOUND);
        }
    }

    private void requirePending(Member member) {
        if (member.getStatus() != MemberStatus.PENDING) {
            throw new BusinessException(ErrorCode.INVALID_STATE, "가입 승인 대기 중인 회원만 처리할 수 있습니다.");
        }
    }

    private MemberStatus parseStatus(String status) {
        if (status == null || status.isBlank()) {
            return null;
        }
        for (MemberStatus s : MemberStatus.values()) {
            if (s.name().equalsIgnoreCase(status) || s.getLabel().equals(status)) {
                return s;
            }
        }
        throw new BusinessException(ErrorCode.INVALID_INPUT, "알 수 없는 회원 상태입니다: " + status);
    }
}
