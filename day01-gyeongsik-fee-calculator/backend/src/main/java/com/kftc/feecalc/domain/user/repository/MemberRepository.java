package com.kftc.feecalc.domain.user.repository;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.kftc.feecalc.domain.user.entity.Member;

public interface MemberRepository extends JpaRepository<Member, Long> {

    Optional<Member> findByLoginId(String loginId);

    List<Member> findByLockedAtIsNotNullOrderByLockedAtDesc();
}
