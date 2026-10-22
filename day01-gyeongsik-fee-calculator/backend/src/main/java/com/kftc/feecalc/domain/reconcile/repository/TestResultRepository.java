package com.kftc.feecalc.domain.reconcile.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.kftc.feecalc.domain.reconcile.entity.TestResult;

public interface TestResultRepository extends JpaRepository<TestResult, Long> {

    List<TestResult> findAllByOrderByTestedAtDesc();

    List<TestResult> findByInstitutionCodeOrderByTestedAtDesc(String institutionCode);
}
