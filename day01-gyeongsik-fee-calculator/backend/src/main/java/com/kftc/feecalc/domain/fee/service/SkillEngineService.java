package com.kftc.feecalc.domain.fee.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.expression.EvaluationContext;
import org.springframework.expression.Expression;
import org.springframework.expression.ExpressionParser;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.SimpleEvaluationContext;
import org.springframework.stereotype.Service;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;

import lombok.RequiredArgsConstructor;

/**
 * 업무별 skill.md 기반 회비 산출 엔진. 파일 읽기·쓰기는 {@link SkillFileService}가 맡는다.
 * <p>
 * skill.md 는 세 섹션으로 이뤄진다: "## 1. 비즈니스 규칙 요약"(화면 요약 박스), "## 2. AI 예외 차감 지침",
 * "## 3. 정산 수식"(```formula 코드 블록 안의 SpEL 수식). 수식에는 아래 변수를 쓴다.
 * <ul>
 *   <li>#rawCount 기본 건수, #deductedCount AI 차감 건수, #finalCount 최종 인정 건수</li>
 *   <li>#totalCount 전체 기관 인정 건수 합계, #institutionCount 참가기관 수, #periodScale 기간 환산 비율(분기 = 1)</li>
 * </ul>
 * 수식은 {@link SimpleEvaluationContext}(읽기 전용 데이터 바인딩)로 평가한다. 화면에서 수식을 바꿀 수 있으므로
 * T(...) 타입 참조, 생성자, 메서드 호출, 빈 참조를 막아 수식으로 서버 코드를 실행할 수 없게 한다.
 */
@Service
@RequiredArgsConstructor
public class SkillEngineService {

    static final Pattern SUMMARY = Pattern.compile("(?ms)^##\\s*1\\.\\s*비즈니스 규칙 요약[ \\t]*\\R(.*?)(?=^##\\s|\\z)");
    static final Pattern AI_GUIDE = Pattern.compile("(?ms)^##\\s*2\\.\\s*AI 예외 차감 지침[ \\t]*\\R(.*?)(?=^##\\s|\\z)");
    static final Pattern FORMULA = Pattern.compile("(?s)```formula[ \\t]*\\R(.*?)```");
    static final Pattern TITLE = Pattern.compile("(?m)^#\\s+(.+)$");
    static final Pattern CALC_TYPE = Pattern.compile("(?m)^[-*]\\s*산정 유형\\s*:\\s*(.+)$");
    static final Pattern RATE_UNIT = Pattern.compile("(?m)^[-*]\\s*표시 단위\\s*:\\s*(.+)$");

    public static final int MAX_FORMULA_LENGTH = 2_000;

    private static final ExpressionParser PARSER = new SpelExpressionParser();

    private final SkillFileService fileService;

    /** skill.md 를 섹션별로 나눈 결과 */
    public record ParsedSkill(String taskCode, String businessId, String title, String calcType, String rateUnit,
                              String summaryText, List<String> summary, String aiGuide, String formula) {
    }

    /** 기관별 수식 입력값 */
    public record Counts(long rawCount, long deductedCount, long finalCount) {
    }

    // ---------- 조회 ----------

    /** 업무 코드(OPEN_BANKING) 또는 업무 ID(openbanking)로 현재 skill.md 를 읽어 해석한다 */
    public ParsedSkill getSkill(String code) {
        String taskCode = fileService.resolveTaskCode(code);
        return parse(taskCode, fileService.businessIdOf(taskCode), fileService.read(taskCode));
    }

    public String businessIdOf(String code) {
        return fileService.businessIdOf(fileService.resolveTaskCode(code));
    }

    // ---------- 파싱·검증 ----------

    /** 정규식으로 요약·AI 지침·수식을 꺼낸다. 요약과 수식이 없으면 400 */
    public static ParsedSkill parse(String taskCode, String businessId, String markdown) {
        String summaryText = group(SUMMARY, markdown);
        if (summaryText == null || summaryText.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "'## 1. 비즈니스 규칙 요약' 섹션을 찾을 수 없습니다.");
        }
        String formula = group(FORMULA, markdown);
        if (formula == null || formula.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "'## 3. 정산 수식'의 ```formula 코드 블록을 찾을 수 없습니다.");
        }
        formula = formula.strip();
        if (formula.length() > MAX_FORMULA_LENGTH) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "수식은 " + MAX_FORMULA_LENGTH + "자 이하로 작성해 주세요.");
        }
        String aiGuide = group(AI_GUIDE, markdown);
        List<String> summary = Arrays.stream(summaryText.strip().split("\\R"))
                .map(String::strip)
                .filter(l -> !l.isEmpty())
                .map(l -> l.replaceFirst("^([-*]|\\d+\\.)\\s+", ""))
                .toList();
        String title = group(TITLE, markdown);
        String calcType = group(CALC_TYPE, markdown);
        String rateUnit = group(RATE_UNIT, markdown);
        return new ParsedSkill(taskCode, businessId,
                title == null ? taskCode : title.strip(),
                calcType == null ? "skill.md 수식" : calcType.strip(),
                rateUnit == null ? "%" : rateUnit.strip(),
                summaryText.strip(), summary, aiGuide == null ? "" : aiGuide.strip(), formula);
    }

    /**
     * 저장 전 수식 검증. 1) SpEL 구문(괄호·연산자) 2) 예시 값으로 시험 계산(허용되지 않는 표현, 0으로 나누기, 음수 등).
     * 문제가 있으면 400 INVALID_FORMULA.
     */
    public static void validateFormula(String formula) {
        try {
            PARSER.parseExpression(formula);
        } catch (RuntimeException e) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA,
                    ErrorCode.INVALID_FORMULA.getMessage() + " (" + e.getMessage() + ")");
        }
        evaluate(formula, new Counts(1_000_000, 100_000, 900_000), 9_000_000, 8, 1.0);
        evaluate(formula, new Counts(0, 0, 0), 0, 8, 0.5);
    }

    private static String group(Pattern p, String text) {
        Matcher m = p.matcher(text);
        return m.find() ? m.group(1) : null;
    }

    // ---------- 계산 ----------

    /**
     * 한 기관의 회비(분기 기준, #periodScale = 1). 수식 결과를 원 단위로 반올림한다.
     * 여러 기관을 함께 산출할 때는 합계가 맞도록 {@link #calculateAll}을 쓴다.
     */
    public long calculate(String code, long rawCount, long deductedCount, long finalCount, long totalCount,
                          int institutionCount) {
        BigDecimal fee = evaluate(getSkill(code).formula(), new Counts(rawCount, deductedCount, finalCount),
                totalCount, institutionCount, 1.0);
        return fee.setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    /**
     * 모든 기관의 회비. 기관별 수식 결과의 원 미만을 버린 뒤, (결과 합계를 반올림한 값 - 버린 합계)만큼
     * 원 미만이 큰 기관부터 1원씩 더한다. 정수 결과(건당 단가 등)는 그대로이고, 총액 분담은 합계 = 총액이 된다.
     */
    public List<Long> calculateAll(String code, List<Counts> counts, double periodScale) {
        String formula = getSkill(code).formula();
        long total = counts.stream().mapToLong(Counts::finalCount).sum();
        List<BigDecimal> raw = counts.stream()
                .map(c -> evaluate(formula, c, total, counts.size(), periodScale))
                .toList();
        return allocate(raw);
    }

    static List<Long> allocate(List<BigDecimal> raw) {
        long[] fees = new long[raw.size()];
        BigDecimal sum = BigDecimal.ZERO;
        long floorSum = 0;
        List<Integer> order = new ArrayList<>();
        for (int i = 0; i < raw.size(); i++) {
            fees[i] = raw.get(i).setScale(0, RoundingMode.FLOOR).longValueExact();
            floorSum += fees[i];
            sum = sum.add(raw.get(i));
            order.add(i);
        }
        long left = sum.setScale(0, RoundingMode.HALF_UP).longValueExact() - floorSum;
        order.sort(Comparator.<Integer, BigDecimal>comparing(i -> raw.get(i).subtract(BigDecimal.valueOf(fees[i])))
                .reversed().thenComparing(i -> i));
        for (int k = 0; k < left && k < order.size(); k++) {
            fees[order.get(k)]++;
        }
        return Arrays.stream(fees).boxed().toList();
    }

    /** 수식 한 번 평가. 결과는 0 이상의 유한한 숫자여야 한다 */
    public static BigDecimal evaluate(String formula, Counts c, long totalCount, int institutionCount,
                                      double periodScale) {
        EvaluationContext ctx = SimpleEvaluationContext.forReadOnlyDataBinding().build();
        ctx.setVariable("rawCount", c.rawCount());
        ctx.setVariable("deductedCount", c.deductedCount());
        ctx.setVariable("finalCount", c.finalCount());
        ctx.setVariable("totalCount", totalCount);
        ctx.setVariable("institutionCount", institutionCount);
        ctx.setVariable("periodScale", periodScale);
        Object value;
        try {
            Expression expression = PARSER.parseExpression(formula);
            value = expression.getValue(ctx);
        } catch (RuntimeException e) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "정산 수식을 계산할 수 없습니다: " + e.getMessage());
        }
        if (!(value instanceof Number n)) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "정산 수식 결과가 숫자가 아닙니다: " + value);
        }
        double d = n.doubleValue();
        if (Double.isNaN(d) || Double.isInfinite(d)) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "정산 수식 결과가 숫자가 아닙니다(0으로 나누기 등).");
        }
        BigDecimal result = n instanceof BigDecimal bd ? bd : (n instanceof Double || n instanceof Float)
                ? BigDecimal.valueOf(d) : BigDecimal.valueOf(n.longValue());
        if (result.signum() < 0) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "정산 수식 결과가 음수입니다: " + result);
        }
        return result;
    }
}
