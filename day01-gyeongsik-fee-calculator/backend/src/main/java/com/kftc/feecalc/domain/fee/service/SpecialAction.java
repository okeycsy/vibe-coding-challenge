package com.kftc.feecalc.domain.fee.service;

import java.util.List;

/**
 * "## 4. 최종 정산 특이사항" 문장 하나를 해석한 보정 동작. AI(또는 규칙 기반 해석기)는 문장을 이 구조로만 바꾸고,
 * 금액은 {@link SpecialRulePostProcessor#execute}가 이 동작대로 계산한다 (프론트 src/utils/specialRules.js 와 같은 실행 규칙).
 * <ul>
 *   <li>MIN_FEE / MAX_FEE: amount 원 미만이면 올리고 / 넘으면 내린다</li>
 *   <li>ROUND: unit 원 단위로 rounding(UP 절상, DOWN 절사, HALF_UP 반올림). redistribute 가 NONE 이 아니면 생긴 차이만큼
 *       대상이 아닌 기관을 최종 인정 실적 순(PERF_DESC 큰 순, PERF_ASC 작은 순, 동률은 기관코드 순)으로 1원씩 되돌려 합계를 유지</li>
 * </ul>
 * 대상(target): ALL 전체, FIRST 첫 번째 기관, NAMED institutions 에 적힌 기관(기관명·기관 ID·기관코드·별칭)
 */
public record SpecialAction(Type type, Long amount, Long unit, Rounding rounding, Target target, List<String> institutions,
                            Redistribute redistribute, String rule) {

    public enum Type { MIN_FEE, MAX_FEE, ROUND }

    public enum Rounding { UP, DOWN, HALF_UP }

    public enum Target { ALL, FIRST, NAMED }

    public enum Redistribute { NONE, PERF_DESC, PERF_ASC }

    public static SpecialAction clamp(boolean min, long amount, Target target, List<String> institutions, String rule) {
        return new SpecialAction(min ? Type.MIN_FEE : Type.MAX_FEE, amount, null, null, target, institutions,
                Redistribute.NONE, rule);
    }

    public static SpecialAction round(long unit, Rounding rounding, Target target, List<String> institutions,
                                      Redistribute redistribute, String rule) {
        return new SpecialAction(Type.ROUND, null, unit, rounding, target, institutions, redistribute, rule);
    }

    /** 사유에 쓰는 이름: 절상 / 절사 / 반올림 */
    public String roundingLabel() {
        return switch (rounding) {
            case UP -> "절상";
            case DOWN -> "절사";
            case HALF_UP -> "반올림";
        };
    }

    /** 화면에 보여 줄 한 줄 설명. 예: "첫 번째 기관 10원 단위 절상 → 차이분은 실적 큰 순 1원씩 되돌림" */
    public String describe() {
        String who = switch (target) {
            case ALL -> "전체 기관";
            case FIRST -> "첫 번째 기관";
            case NAMED -> String.join("·", institutions);
        };
        if (type != Type.ROUND) {
            return String.format("%s %s 회비 %,d원", who, type == Type.MIN_FEE ? "최저" : "최고", amount);
        }
        String text = String.format("%s %,d원 단위 %s", who, unit, roundingLabel());
        return switch (redistribute) {
            case NONE -> text;
            case PERF_DESC -> text + " → 차이분은 나머지 기관에 실적 큰 순 1원씩 되돌림";
            case PERF_ASC -> text + " → 차이분은 나머지 기관에 실적 작은 순 1원씩 되돌림";
        };
    }
}
