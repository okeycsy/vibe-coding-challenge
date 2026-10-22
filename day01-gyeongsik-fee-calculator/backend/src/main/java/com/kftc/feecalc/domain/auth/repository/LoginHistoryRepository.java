package com.kftc.feecalc.domain.auth.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.kftc.feecalc.domain.auth.entity.LoginHistory;

public interface LoginHistoryRepository extends JpaRepository<LoginHistory, Long> {

    List<LoginHistory> findTop20ByLoginIdOrderByAtDesc(String loginId);
}
