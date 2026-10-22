package com.kftc.feecalc.domain.fee.service;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;

/** 산출 기간(From~To). 프론트엔드 utils/period.js 와 같은 규칙이다. */
public record Period(LocalDate from, LocalDate to) {

    /** 분기 기준 값(실적·총액)을 환산할 때 쓰는 분기 일수 */
    public static final int QUARTER_DAYS = 91;

    public static Period of(LocalDate from, LocalDate to) {
        if (from.isAfter(to)) {
            throw new BusinessException(ErrorCode.INVALID_PERIOD, "시작일(From)이 종료일(To)보다 늦습니다.");
        }
        return new Period(from, to);
    }

    public long days() {
        return ChronoUnit.DAYS.between(from, to) + 1;
    }

    /** 정확히 한 분기면 분기 번호(1~4), 아니면 0 */
    public int quarter() {
        boolean quarterStart = from.getDayOfMonth() == 1 && (from.getMonthValue() - 1) % 3 == 0;
        if (quarterStart && to.equals(from.plusMonths(3).minusDays(1))) {
            return (from.getMonthValue() - 1) / 3 + 1;
        }
        return 0;
    }

    /** 정확히 한 분기면 1, 아니면 일수 ÷ 91 */
    public double scale() {
        return quarter() > 0 ? 1.0 : (double) days() / QUARTER_DAYS;
    }

    public String label() {
        int q = quarter();
        return q > 0
                ? from.getYear() + "년 " + q + "분기 (" + from + " ~ " + to + ")"
                : from + " ~ " + to + " (" + days() + "일)";
    }

    /** 파일 이름용: 20260701-20260930 */
    public String tag() {
        return from.toString().replace("-", "") + "-" + to.toString().replace("-", "");
    }
}
