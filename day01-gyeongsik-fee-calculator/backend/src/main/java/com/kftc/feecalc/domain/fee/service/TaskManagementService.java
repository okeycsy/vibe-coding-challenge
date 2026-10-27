package com.kftc.feecalc.domain.fee.service;

import java.time.LocalDateTime;
import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.domain.fee.dto.TaskResponse;
import com.kftc.feecalc.domain.fee.service.SkillFileService.TaskEntry;
import com.kftc.feecalc.domain.user.entity.Member;
import com.kftc.feecalc.domain.user.entity.TaskRequestStatus;
import com.kftc.feecalc.domain.user.repository.MemberRepository;
import com.kftc.feecalc.domain.user.repository.TaskRequestRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 업무 관리(시스템관리자): 업무 조회·추가·삭제. 업무 1개 = md 파일 1개이며 파일 I/O 는 {@link SkillFileService}가 맡는다.
 * 업무를 지우면 그 업무의 산출 권한과 승인 대기 중인 권한 신청도 함께 정리한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class TaskManagementService {

    private final SkillFileService fileService;
    private final SkillAccessControlService accessControl;
    private final MemberRepository memberRepository;
    private final TaskRequestRepository taskRequestRepository;

    public List<TaskResponse> list() {
        List<Member> members = memberRepository.findAll();
        return fileService.tasks().stream().map(t -> response(t, members)).toList();
    }

    @Transactional
    public TaskResponse create(String employeeId, String taskCode, String name, String fileName) {
        accessControl.checkAdmin(employeeId);
        TaskEntry entry = fileService.create(taskCode, name, fileName, employeeId.trim());
        return response(entry, List.of());
    }

    @Transactional
    public TaskEntry delete(String employeeId, String taskCode) {
        accessControl.checkAdmin(employeeId);
        String code = fileService.resolveTaskCode(taskCode);
        String businessId = fileService.businessIdOf(code);
        TaskEntry removed = fileService.delete(code, employeeId.trim());
        memberRepository.findAll().forEach(m -> m.revokeTask(businessId));
        LocalDateTime now = LocalDateTime.now();
        taskRequestRepository.findByStatusOrderByRequestedAtDesc(TaskRequestStatus.PENDING).stream()
                .filter(r -> r.getBusinessCode().equals(businessId))
                .forEach(r -> r.reject(now));
        return removed;
    }

    private TaskResponse response(TaskEntry t, List<Member> members) {
        boolean ready;
        try {
            // 수식 미작성 초안도 저장은 되지만 산출 기준으로는 아직 작성 필요
            ready = SkillEngineService.parse(t.taskCode(), t.businessId(), fileService.read(t.taskCode())).hasFormula();
        } catch (BusinessException e) {
            ready = false;
        }
        long memberCount = members.stream().filter(m -> m.hasTask(t.businessId())).count();
        return TaskResponse.of(t, fileService.meta(t.taskCode()), ready, memberCount);
    }
}
