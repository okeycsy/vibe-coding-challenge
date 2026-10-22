package com.kftc.feecalc.domain.auth.entity;

import java.time.LocalDateTime;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 접속 이력 (마이페이지 › 보안 설정 및 접속 이력) */
@Entity
@Table(name = "login_history", indexes = @Index(columnList = "loginId"))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class LoginHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 30)
    private String loginId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private LoginResult result;

    @Column(length = 64)
    private String ip;

    private String device;

    private LocalDateTime at;

    public LoginHistory(String loginId, LoginResult result, String ip, String device, LocalDateTime at) {
        this.loginId = loginId;
        this.result = result;
        this.ip = ip;
        this.device = device;
        this.at = at;
    }
}
