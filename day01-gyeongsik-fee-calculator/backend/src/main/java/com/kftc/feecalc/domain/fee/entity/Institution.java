package com.kftc.feecalc.domain.fee.entity;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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

    /** 시연용 실적 생성 가중치. 0 이면 업로드한 실적 파일에 있을 때만 산출 대상 (기관 관리에서 추가한 기관도 0) */
    private double volumeWeight;

    private int sortOrder;

    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private InstitutionType type;

    /**
     * 사용 여부. 비활성 기관은 엑셀 매칭·AI 이슈 인식·산출에서 빠진다.
     * 지난 산출 이력은 산출 당시 기관명·코드를 따로 저장해 두므로 그대로 남는다.
     */
    private boolean active = true;

    private LocalDateTime updatedAt;
    private String updatedBy;

    @Builder
    private Institution(String code, String name, String bankCode, List<String> aliases, double volumeWeight,
                        int sortOrder, InstitutionType type, String updatedBy, LocalDateTime updatedAt) {
        this.code = code;
        this.name = name;
        this.bankCode = bankCode;
        this.volumeWeight = volumeWeight;
        this.sortOrder = sortOrder;
        this.type = type == null ? InstitutionType.guess(name) : type;
        this.updatedBy = updatedBy;
        this.updatedAt = updatedAt;
        if (aliases != null) {
            this.aliases.addAll(aliases);
        }
    }

    /** 기관 관리: 이름·기관코드·구분·별칭 수정 (내부 ID 는 산출 이력·회원 소속이 가리키는 값이라 바꾸지 않는다) */
    public void update(String name, String bankCode, InstitutionType type, List<String> aliases, String by,
                       LocalDateTime now) {
        this.name = name;
        this.bankCode = bankCode;
        this.type = type;
        this.aliases.clear();
        this.aliases.addAll(aliases);
        touch(by, now);
    }

    public void changeActive(boolean active, String by, LocalDateTime now) {
        this.active = active;
        touch(by, now);
    }

    private void touch(String by, LocalDateTime now) {
        this.updatedBy = by;
        this.updatedAt = now;
    }

    /** 이름 또는 별칭 중 문장에 들어 있는 첫 번째 값 */
    public String findMatchedAlias(String text) {
        if (text.contains(name)) {
            return name;
        }
        return aliases.stream().filter(text::contains).findFirst().orElse(null);
    }
}
