package com.kftc.feecalc.domain.fee.dto;

import java.time.LocalDateTime;
import java.util.List;

import com.kftc.feecalc.domain.fee.entity.Institution;

/**
 * 기관 관리 목록 한 줄. 사용 현황(산출 이력·대사·테스트 결과·연결 회원 수)을 함께 준다.
 * deletable: 어디에도 쓰이지 않아 완전히 지울 수 있는지 (아니면 사용 중지만 가능)
 */
public record InstitutionAdminResponse(String id, String name, String code, List<String> aliases, String type,
                                       String typeLabel, boolean active, boolean uploadOnly, int sortOrder,
                                       long calculationCount, long reconcileCount, long testCount, long memberCount,
                                       boolean deletable, LocalDateTime updatedAt, String updatedBy) {

    public record Usage(long calculations, long reconciles, long tests, long members) {

        public static final Usage NONE = new Usage(0, 0, 0, 0);

        boolean unused() {
            return calculations == 0 && reconciles == 0 && tests == 0 && members == 0;
        }
    }

    public static InstitutionAdminResponse of(Institution i, Usage u) {
        return new InstitutionAdminResponse(i.getCode(), i.getName(), i.getBankCode(), List.copyOf(i.getAliases()),
                i.getType().name(), i.getType().getLabel(), i.isActive(), i.getVolumeWeight() <= 0, i.getSortOrder(),
                u.calculations(), u.reconciles(), u.tests(), u.members(), u.unused(), i.getUpdatedAt(),
                i.getUpdatedBy());
    }
}
