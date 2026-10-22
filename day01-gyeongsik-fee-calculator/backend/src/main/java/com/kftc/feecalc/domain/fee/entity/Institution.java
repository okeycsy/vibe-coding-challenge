package com.kftc.feecalc.domain.fee.entity;

import java.util.ArrayList;
import java.util.List;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 참가기관 */
@Entity
@Table(name = "institution")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Institution {

    /** 기관 ID. 프론트엔드 INSTITUTIONS[].id 와 같다 (예: shinhan) */
    @Id
    @Column(length = 30)
    private String code;

    @Column(nullable = false, length = 50)
    private String name;

    /** 금융기관 코드 (예: B088) */
    @Column(length = 10)
    private String bankCode;

    /** AI 이슈 문장에서 기관을 찾을 때 쓰는 별칭 (A~H은행은 시연용 가명) */
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "institution_alias", joinColumns = @JoinColumn(name = "institution_code"))
    @Column(name = "alias", length = 30)
    private List<String> aliases = new ArrayList<>();

    /** 시연용 실적 생성 가중치 */
    private double volumeWeight;

    private int sortOrder;

    @Builder
    private Institution(String code, String name, String bankCode, List<String> aliases, double volumeWeight,
                        int sortOrder) {
        this.code = code;
        this.name = name;
        this.bankCode = bankCode;
        this.volumeWeight = volumeWeight;
        this.sortOrder = sortOrder;
        if (aliases != null) {
            this.aliases.addAll(aliases);
        }
    }

    /** 이름 또는 별칭 중 문장에 들어 있는 첫 번째 값 */
    public String findMatchedAlias(String text) {
        if (text.contains(name)) {
            return name;
        }
        return aliases.stream().filter(text::contains).findFirst().orElse(null);
    }
}
