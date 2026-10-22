package com.kftc.feecalc.domain.fee.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.kftc.feecalc.domain.fee.entity.Business;

public interface BusinessRepository extends JpaRepository<Business, String> {

    List<Business> findAllByOrderBySortOrder();
}
