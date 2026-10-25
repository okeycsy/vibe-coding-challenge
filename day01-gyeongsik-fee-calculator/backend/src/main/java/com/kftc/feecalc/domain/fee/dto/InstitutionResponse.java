package com.kftc.feecalc.domain.fee.dto;

import java.util.List;

import com.kftc.feecalc.domain.fee.entity.Institution;

/** 기관 조회 (비활성 기관 포함). type: BANK | SECURITIES | INSURANCE | OTHER */
public record InstitutionResponse(String id, String name, String code, List<String> aliases, String type,
                                  boolean active, boolean uploadOnly) {

    public static InstitutionResponse from(Institution i) {
        return new InstitutionResponse(i.getCode(), i.getName(), i.getBankCode(), List.copyOf(i.getAliases()),
                i.getType().name(), i.isActive(), i.getVolumeWeight() <= 0);
    }
}
