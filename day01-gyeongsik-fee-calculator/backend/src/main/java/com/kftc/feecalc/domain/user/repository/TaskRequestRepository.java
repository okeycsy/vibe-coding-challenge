package com.kftc.feecalc.domain.user.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.kftc.feecalc.domain.user.entity.Member;
import com.kftc.feecalc.domain.user.entity.TaskRequest;
import com.kftc.feecalc.domain.user.entity.TaskRequestStatus;

public interface TaskRequestRepository extends JpaRepository<TaskRequest, Long> {

    List<TaskRequest> findAllByOrderByRequestedAtDesc();

    List<TaskRequest> findByStatusOrderByRequestedAtDesc(TaskRequestStatus status);

    List<TaskRequest> findByMemberOrderByRequestedAtDesc(Member member);

    boolean existsByMemberAndBusinessCodeAndStatus(Member member, String businessCode, TaskRequestStatus status);
}
