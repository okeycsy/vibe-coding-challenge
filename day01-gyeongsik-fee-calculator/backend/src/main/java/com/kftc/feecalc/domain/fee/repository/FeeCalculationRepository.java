package com.kftc.feecalc.domain.fee.repository;

import java.util.List;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import com.kftc.feecalc.domain.fee.entity.FeeCalculation;

public interface FeeCalculationRepository extends JpaRepository<FeeCalculation, Long> {

    @EntityGraph(attributePaths = "business")
    List<FeeCalculation> findAllByOrderByCalculatedAtDesc();

    /** 기관별로 들어 있는 산출 건수: [기관 ID, 산출 건수] (기관 관리의 산출 이력 영향 표시용) */
    @Query("select i.institutionCode, count(distinct i.calculation.id) from FeeCalculationItem i group by i.institutionCode")
    List<Object[]> countCalculationsByInstitution();
}
