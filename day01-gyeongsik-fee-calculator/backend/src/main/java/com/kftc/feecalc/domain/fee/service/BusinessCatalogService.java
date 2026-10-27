package com.kftc.feecalc.domain.fee.service;

import java.util.List;
import java.util.Locale;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;
import com.kftc.feecalc.domain.fee.entity.Business;
import com.kftc.feecalc.domain.fee.entity.CalcMethod;
import com.kftc.feecalc.domain.fee.repository.BusinessRepository;
import com.kftc.feecalc.domain.fee.service.SkillFileService.TaskEntry;

import lombok.RequiredArgsConstructor;

/**
 * 산출 대상 업무 = 업무 관리의 업무 목록(tasks.json). 기본 5개 업무는 시연 데이터(business 테이블)에 있고,
 * 업무 관리에서 새로 추가한 업무는 처음 쓰일 때(산출·권한 부여) business 행을 만든다.
 * 새 업무는 시연용 실적이 없어(baseVolume 0) 업로드한 실적으로만 산출한다.
 */
@Service
@RequiredArgsConstructor
public class BusinessCatalogService {

    private final BusinessRepository businessRepository;
    private final SkillFileService fileService;

    /** 업무 관리 목록에 있는 업무 ID 전체 (시스템관리자의 산출 가능 업무) */
    public List<String> businessIds() {
        return fileService.tasks().stream().map(TaskEntry::businessId).toList();
    }

    /** 업무 관리 목록에 있는 업무인지 (business 테이블에 없어도 새로 추가한 업무면 true) */
    public boolean exists(String businessId) {
        return businessRepository.existsById(businessId)
                || fileService.tasks().stream().anyMatch(t -> t.businessId().equals(businessId));
    }

    /** 업무 ID 로 business 행을 찾고, 업무 관리에서 추가한 업무라 아직 없으면 만든다 */
    @Transactional
    public Business require(String businessId) {
        return businessRepository.findById(businessId).orElseGet(() -> {
            TaskEntry task = fileService.tasks().stream()
                    .filter(t -> t.businessId().equals(businessId))
                    .findFirst()
                    .orElseThrow(() -> new BusinessException(ErrorCode.BUSINESS_NOT_FOUND));
            return businessRepository.save(Business.builder()
                    .code(task.businessId())
                    .name(task.name())
                    .method(methodOf(task))
                    .baseVolume(0)
                    .revenueAccount("회비수입-" + task.name())
                    .sortOrder(100 + (int) businessRepository.count())
                    .summary(List.of())
                    .build());
        });
    }

    /** 산출 방식 표시용: skill.md 산정 유형에 '단가'가 있으면 건당 단가, 아니면 총액 분담 */
    private CalcMethod methodOf(TaskEntry task) {
        try {
            String calcType = SkillEngineService.parse(task.taskCode(), task.businessId(), fileService.read(task.taskCode()))
                    .calcType();
            return calcType != null && calcType.toLowerCase(Locale.ROOT).contains("단가") ? CalcMethod.UNIT : CalcMethod.RATIO;
        } catch (BusinessException e) {
            return CalcMethod.RATIO;
        }
    }
}
