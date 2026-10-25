package com.kftc.feecalc.domain.fee.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.kftc.feecalc.domain.fee.entity.Institution;

public interface InstitutionRepository extends JpaRepository<Institution, String> {

    /** 기관 관리 화면용: 비활성 기관 포함 */
    List<Institution> findAllByOrderBySortOrder();

    /** 엑셀 매칭·AI 이슈 인식·산출에 쓰는 사용 중인 기관 */
    List<Institution> findByActiveTrueOrderBySortOrder();
}
