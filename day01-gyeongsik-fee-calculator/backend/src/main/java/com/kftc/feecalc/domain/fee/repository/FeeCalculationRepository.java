package com.kftc.feecalc.domain.fee.repository;

import java.util.List;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import com.kftc.feecalc.domain.fee.entity.FeeCalculation;

public interface FeeCalculationRepository extends JpaRepository<FeeCalculation, Long> {

    @EntityGraph(attributePaths = "business")
    List<FeeCalculation> findAllByOrderByCalculatedAtDesc();
}
