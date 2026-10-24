package com.kftc.feecalc.domain.fee.service;

import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;
import com.kftc.feecalc.domain.user.entity.Member;
import com.kftc.feecalc.domain.user.entity.MemberRole;
import com.kftc.feecalc.domain.user.entity.MemberStatus;
import com.kftc.feecalc.domain.user.repository.MemberRepository;

import lombok.RequiredArgsConstructor;

/**
 * skill.md 조회·수정·산출 권한.
 * <ul>
 *   <li>시스템관리자(SYSADMIN): 모든 업무</li>
 *   <li>일반담당자(OPERATOR): 승인된 업무 권한(TaskPermission, 신청 승인 또는 관리자 부여)이 있는 업무만</li>
 *   <li>참가기관(INSTITUTION), 정상 상태가 아닌 회원, 없는 사번: 거부</li>
 * </ul>
 * 아직 로그인 토큰이 없어 사번은 X-Employee-Id 헤더 값을 그대로 믿는다. 토큰(JWT) 도입 시 토큰에서 꺼내도록 바꾼다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class SkillAccessControlService {

    private final MemberRepository memberRepository;
    private final SkillFileService fileService;

    /** 권한이 없으면 403. 통과하면 업무 코드를 돌려준다 */
    public String checkPermission(String employeeId, String taskCode) {
        String code = fileService.resolveTaskCode(taskCode);
        if (!canAccess(member(employeeId), code)) {
            throw new BusinessException(ErrorCode.SKILL_ACCESS_DENIED);
        }
        return code;
    }

    public void checkAdmin(String employeeId) {
        if (member(employeeId).getRole() != MemberRole.SYSADMIN) {
            throw new BusinessException(ErrorCode.ADMIN_ONLY);
        }
    }

    /** 이 사번이 접근할 수 있는 업무 코드 */
    public List<String> accessibleTaskCodes(String employeeId) {
        Member member = member(employeeId);
        return fileService.taskCodes().stream().filter(code -> canAccess(member, code)).toList();
    }

    private boolean canAccess(Member member, String taskCode) {
        return member.getStatus() == MemberStatus.ACTIVE
                && member.canCalculate(SkillFileService.businessIdOf(taskCode));
    }

    private Member member(String employeeId) {
        if (employeeId == null || employeeId.isBlank()) {
            throw new BusinessException(ErrorCode.EMPLOYEE_ID_REQUIRED);
        }
        return memberRepository.findByLoginId(employeeId.trim())
                .orElseThrow(() -> new BusinessException(ErrorCode.SKILL_ACCESS_DENIED));
    }
}
