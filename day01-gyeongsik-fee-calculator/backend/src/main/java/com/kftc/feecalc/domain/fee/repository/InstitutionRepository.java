package com.kftc.feecalc.domain.fee.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.kftc.feecalc.domain.fee.entity.Institution;

public interface InstitutionRepository extends JpaRepository<Institution, String> {

    List<Institution> findAllByOrderBySortOrder();
}
