package com.kftc.feecalc.domain.fee.dto;

import java.util.List;

import com.kftc.feecalc.domain.fee.entity.Institution;

public record InstitutionResponse(String id, String name, String code, List<String> aliases) {

    public static InstitutionResponse from(Institution i) {
        return new InstitutionResponse(i.getCode(), i.getName(), i.getBankCode(), List.copyOf(i.getAliases()));
    }
}
