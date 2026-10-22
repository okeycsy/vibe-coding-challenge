package com.kftc.feecalc.domain.reconcile.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.kftc.feecalc.domain.reconcile.entity.ReconcileRecord;

public interface ReconcileRecordRepository extends JpaRepository<ReconcileRecord, Long> {

    List<ReconcileRecord> findByCalculationIdOrderById(Long calculationId);

    List<ReconcileRecord> findByInstitutionCodeOrderByIdDesc(String institutionCode);

    List<ReconcileRecord> findAllByOrderByCalculationIdDescIdAsc();
}
