package com.kftc.feecalc.domain.fee.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.expression.Expression;
import org.springframework.expression.ExpressionParser;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.SimpleEvaluationContext;
import org.springframework.stereotype.Service;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;
import com.kftc.feecalc.domain.fee.service.SkillVariables.Bound;
import com.kftc.feecalc.domain.fee.service.SkillVariables.Row;

import lombok.RequiredArgsConstructor;

/**
 * 업무별 skill.md 기반 회비 산출 엔진. 파일 읽기·쓰기는 {@link SkillFileService}가 맡는다.
 * <p>
 * skill.md 는 네 섹션으로 이뤄진다: "## 1. 비즈니스 규칙 요약"(필수, 1차 계산 규칙의 자연어 설명),
 * "## 2. AI 예외 차감 지침"(선택), "## 3. 정산 수식"(필수, ```variables 변수 정의 블록(선택) + ```formula 코드 블록 안의 SpEL 수식.
 * 균등분담분·실적분담분을 따로 쓰려면 ```formula:equal 과 ```formula:perf 블록, 총액 블록은 선택), "## 4. 최종 정산 특이사항"(선택, 자연어 규칙과
 * 그것을 옮긴 ```postprocess 후처리 스크립트. 1차 계산 뒤 {@link PostprocessEngine}이 실행).
 * 수식 변수는 {@link SkillVariables} 가 정한다: AI 가 1번 규칙을 읽고 정의한 변수(실적 입력 input, 상수, 파생값, 합계)와 예약 변수
 * #rawCount(기준 실적) #deductedCount(AI 차감) #finalCount(최종 인정) #totalCount(전체 인정 합계) #institutionCount(참가기관 수)
 * #periodScale(기간 환산 비율). 변수 블록이 없는 예전 문서는 실적 입력 하나(rawCount)로 읽어 금액이 달라지지 않는다.
 * 수식은 {@link SimpleEvaluationContext}(읽기 전용 데이터 바인딩)로 평가한다. 화면에서 수식을 바꿀 수 있으므로
 * T(...) 타입 참조, 생성자, 메서드 호출, 빈 참조를 막아 수식으로 서버 코드를 실행할 수 없게 한다.
 */
@Service
@RequiredArgsConstructor
public class SkillEngineService {

    static final Pattern SUMMARY = Pattern.compile("(?ms)^##\\s*1\\.\\s*비즈니스 규칙 요약[ \\t]*\\R(.*?)(?=^##\\s|\\z)");
    static final Pattern AI_GUIDE = Pattern.compile("(?ms)^##\\s*2\\.\\s*AI 예외 차감 지침[ \\t]*\\R(.*?)(?=^##\\s|\\z)");
    /** "## 3." 제목부터 다음 "## " 제목(보통 "## 4. 최종 정산 특이사항") 직전까지. 수식·변수는 이 범위 안에서만 찾는다 */
    static final Pattern FORMULA_SECTION = Pattern.compile("(?ms)^##\\s*3\\.[^\\n]*\\R(.*?)(?=^##\\s|\\z)");
    static final Pattern FORMULA = Pattern.compile("(?s)```formula(?::(equal|perf))?[ \\t]*\\R(.*?)```");
    static final Pattern VARIABLES = Pattern.compile("(?s)```variables[ \\t]*\\R(.*?)```");
    static final Pattern POSTPROCESS = Pattern.compile("(?s)[ \\t]*```postprocess[ \\t]*\\R(.*?)```[ \\t]*\\R?");
    static final Pattern SPECIAL = Pattern.compile("(?ms)^##\\s*4\\.\\s*최종 정산 특이사항[ \\t]*\\R(.*?)(?=^##\\s|\\z)");
    static final Pattern TITLE = Pattern.compile("(?m)^#\\s+(.+)$");
    static final Pattern CALC_TYPE = Pattern.compile("(?m)^[-*]\\s*산정 유형\\s*:\\s*(.+)$");
    static final Pattern RATE_UNIT = Pattern.compile("(?m)^[-*]\\s*표시 단위\\s*:\\s*(.+)$");

    public static final int MAX_FORMULA_LENGTH = 2_000;
    public static final int MAX_VARIABLES_LENGTH = 6_000;

    private static final ExpressionParser PARSER = new SpelExpressionParser();

    private final SkillFileService fileService;

    /**
     * skill.md 를 섹션별로 나눈 결과. formula 는 회비 총액 수식(분리형이면 "(균등) + (실적)"으로 합친 표시용),
     * equalFormula·perfFormula 는 분리형일 때만, variables 는 3번의 ```variables 변수 정의(블록이 없으면 legacy),
     * postprocess 는 4번의 후처리 스크립트(없으면 ""), specialRulesRaw 는 스크립트 블록을 뺀 4번 자연어 원문
     */
    public record ParsedSkill(String taskCode, String businessId, String title, String calcType, String rateUnit,
                              String summaryText, List<String> summary, String aiGuide, String formula,
                              String equalFormula, String perfFormula, SkillVariables variables, String postprocess,
                              String specialRulesRaw, List<String> specialRules) {

        public boolean hasSpecialRules() {
            return !specialRules.isEmpty();
        }

        public boolean isSplit() {
            return equalFormula != null;
        }

        public boolean hasPostprocess() {
            return postprocess != null && !postprocess.isBlank();
        }

        /** 3번 수식을 아직 안 쓴 초안(빈 ```formula 블록 등)이면 false. 저장은 되지만 산출은 막는다 */
        public boolean hasFormula() {
            return formula != null && !formula.isBlank();
        }
    }

    /** 3번 수식이 비어 있는 기준으로 산출하려 할 때 안내 */
    public static final String FORMULA_MISSING =
            "'## 3. 정산 수식'이 아직 비어 있습니다. [AI 계산식 빌더]나 기준 문서 편집의 수식 생성으로 수식을 만들어 저장한 뒤 산출해 주세요.";

    /** 산출 전에 부른다. 수식 미작성 초안이면 400 */
    public static void requireFormula(ParsedSkill skill) {
        if (!skill.hasFormula()) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, FORMULA_MISSING);
        }
    }

    /** 기관별 수식 입력값 (실적 입력이 하나인 예전 방식). 새 코드는 {@link SkillVariables.Row} 를 쓴다 */
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

    /**
     * 정규식으로 요약·AI 지침·변수·수식·최종 정산 특이사항을 꺼낸다. 요약(1번)이 없으면 400, 2번·4번은 선택.
     * 3번 수식이 비어 있으면(초안) formula 를 ""로 두고 통과시킨다 — 저장해 두고 빌더에서 채울 수 있게. 산출은 {@link #requireFormula}로 막는다.
     * 변수 블록의 문법 오류는 400 (저장 거부)
     */
    public static ParsedSkill parse(String taskCode, String businessId, String markdown) {
        String summaryText = group(SUMMARY, markdown);
        if (summaryText == null || summaryText.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "'## 1. 비즈니스 규칙 요약' 섹션을 찾을 수 없습니다.");
        }
        // "## 3." 섹션이 있으면 그 안의 ```formula·```variables 블록만 (4번 특이사항에 코드 블록이 있어도 수식으로 읽지 않게)
        String section3 = group(FORMULA_SECTION, markdown);
        Formulas f = formulas(section3 != null ? section3 : markdown);
        SkillVariables variables = variables(section3 != null ? section3 : markdown);
        String aiGuide = group(AI_GUIDE, markdown);
        List<String> summary = lines(summaryText);
        String section4 = group(SPECIAL, markdown);
        String postprocess = "";
        String special = "";
        if (section4 != null) {
            Matcher pm = POSTPROCESS.matcher(section4);
            if (pm.find()) {
                postprocess = pm.group(1).strip();
                special = (section4.substring(0, pm.start()) + section4.substring(pm.end())).strip();
            } else {
                special = section4.strip();
            }
        }
        String title = group(TITLE, markdown);
        String calcType = group(CALC_TYPE, markdown);
        String rateUnit = group(RATE_UNIT, markdown);
        return new ParsedSkill(taskCode, businessId,
                title == null ? taskCode : title.strip(),
                calcType == null ? "skill.md 수식" : calcType.strip(),
                rateUnit == null ? "%" : rateUnit.strip(),
                summaryText.strip(), summary, aiGuide == null ? "" : aiGuide.strip(), f.total(), f.equal(), f.perf(), variables,
                postprocess, special, lines(special));
    }

    /** 3번 섹션의 수식 블록들. total 은 수식이 있으면 늘 있고(분리형이면 합친 표시용, 미작성 초안이면 ""), equal·perf 는 분리형일 때만 */
    public record Formulas(String total, String equal, String perf) {
    }

    /**
     * ```formula(총액) · ```formula:equal · ```formula:perf 블록을 읽는다. 블록이 없거나 비어 있으면(분리형은 균등·실적 중 하나라도)
     * 수식 미작성 초안으로 보고 ("", null, null)을 준다. 분리 블록이 한쪽만 있는 것처럼 구조가 틀린 경우만 400
     */
    public static Formulas formulas(String section3) {
        String total = null;
        String equal = null;
        String perf = null;
        Matcher m = FORMULA.matcher(section3);
        while (m.find()) {
            String body = m.group(2).strip();
            if (body.length() > MAX_FORMULA_LENGTH) {
                throw new BusinessException(ErrorCode.INVALID_FORMULA, "수식은 " + MAX_FORMULA_LENGTH + "자 이하로 작성해 주세요.");
            }
            String kind = m.group(1);
            if (kind == null) {
                total = total == null ? body : total;
            } else if (kind.equals("equal")) {
                equal = equal == null ? body : equal;
            } else {
                perf = perf == null ? body : perf;
            }
        }
        if ((equal == null) != (perf == null)) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "```formula:equal(균등분담분)과 ```formula:perf(실적분담분) 블록은 함께 있어야 합니다.");
        }
        if (equal != null ? equal.isBlank() || perf.isBlank() : total == null || total.isBlank()) {
            return new Formulas("", null, null);
        }
        if (total == null || total.isBlank()) {
            total = "(" + equal + ") + (" + perf + ")";
        }
        return new Formulas(total, equal, perf);
    }

    /** 3번 섹션의 ```variables 블록(첫 번째)을 읽는다. 없으면 예전 방식(실적 입력 하나). 문법 오류는 400 */
    public static SkillVariables variables(String section3) {
        Matcher m = VARIABLES.matcher(section3);
        if (!m.find()) {
            return SkillVariables.legacy();
        }
        String body = m.group(1);
        if (body.length() > MAX_VARIABLES_LENGTH) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "변수 정의는 " + MAX_VARIABLES_LENGTH + "자 이하로 작성해 주세요.");
        }
        return SkillVariables.parse(body);
    }

    /** 마크다운 목록 → 글머리표를 뗀 줄 목록 (빈 줄 제외) */
    public static List<String> lines(String text) {
        if (text == null) {
            return List.of();
        }
        return Arrays.stream(text.strip().split("\\R"))
                .map(String::strip)
                .filter(l -> !l.isEmpty())
                .map(l -> l.replaceFirst("^([-*]|\\d+\\.)\\s+", ""))
                .toList();
    }

    /**
     * 저장 전 수식 검증 (실적 입력 하나인 예전 방식). 1) SpEL 구문(괄호·연산자) 2) 정의되지 않은 변수 3) 예시 값으로 시험 계산
     * (허용되지 않는 표현, 0으로 나누기, 음수 등). 문제가 있으면 400 INVALID_FORMULA.
     */
    public static void validateFormula(String formula) {
        validateFormula(formula, SkillVariables.legacy());
    }

    /** 저장 전 수식 검증: 구문 → 정의되지 않은 변수 → 기관 8곳 예시(정상·실적 0)로 시험 계산 */
    public static void validateFormula(String formula, SkillVariables variables) {
        if (formula.length() > MAX_FORMULA_LENGTH) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "수식은 " + MAX_FORMULA_LENGTH + "자 이하로 작성해 주세요.");
        }
        try {
            PARSER.parseExpression(formula);
        } catch (RuntimeException e) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA,
                    ErrorCode.INVALID_FORMULA.getMessage() + " (" + e.getMessage() + ")");
        }
        variables.checkFormula(formula);
        for (boolean zero : new boolean[] {false, true}) {
            Bound b = variables.bind(variables.sampleRows(zero), zero ? SkillVariables.SAMPLE_SCALE_ZERO : SkillVariables.SAMPLE_SCALE_NORMAL);
            for (Map<String, Object> ctx : b.contexts()) {
                evaluate(formula, ctx);
            }
            if (variables.isMixed(formula)) {
                evaluate(formula, variables.zeroContext(b));
            }
        }
    }

    /** 저장 전 검증: 변수 정의 + 수식(총액·균등·실적) 구문·시험 계산 2벌(미작성 초안이면 수식은 건너뜀), 후처리 스크립트 문법 + 시험 실행 */
    public static void validateSkill(ParsedSkill skill) {
        // 수식 미작성 초안은 저장을 허용하고 산출 때 막는다
        if (skill.isSplit()) {
            validateFormula(skill.equalFormula(), skill.variables());
            validateFormula(skill.perfFormula(), skill.variables());
            if (!skill.formula().equals("(" + skill.equalFormula() + ") + (" + skill.perfFormula() + ")")) {
                validateFormula(skill.formula(), skill.variables());
            }
        } else if (skill.hasFormula()) {
            validateFormula(skill.formula(), skill.variables());
        } else if (skill.variables().hasBlock()) {
            // 수식은 비었지만 변수만 있는 초안: 변수끼리는 계산되는지 본다
            skill.variables().bind(skill.variables().sampleRows(false), SkillVariables.SAMPLE_SCALE_NORMAL);
        }
        if (skill.hasFormula()) {
            computeRaw(skill, skill.variables().sampleRows(false), SkillVariables.SAMPLE_SCALE_NORMAL);
            computeRaw(skill, skill.variables().sampleRows(true), SkillVariables.SAMPLE_SCALE_ZERO);
        }
        if (skill.hasPostprocess()) {
            PostprocessEngine.trial(skill.postprocess());
        }
    }

    private static String group(Pattern p, String text) {
        Matcher m = p.matcher(text);
        return m.find() ? m.group(1) : null;
    }

    // ---------- 계산 ----------

    /**
     * 한 기관의 회비(분기 기준, #periodScale = 1). 수식 결과를 원 단위로 반올림한다. 실적 입력이 하나인 기준만 쓸 수 있다.
     * 여러 기관을 함께 산출할 때는 합계가 맞도록 {@link #calculateAll}을 쓴다.
     */
    public long calculate(String code, long rawCount, long deductedCount, long finalCount, long totalCount,
                          int institutionCount) {
        ParsedSkill skill = getSkill(code);
        requireFormula(skill);
        requireSingleInput(skill);
        BigDecimal fee = evaluate(skill.formula(), new Counts(rawCount, deductedCount, finalCount),
                totalCount, institutionCount, 1.0);
        return fee.setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    /**
     * 모든 기관의 회비(후처리 스크립트 없이 원 단위 배분만). 테스트·단순 조회용
     */
    public List<Long> calculateAll(String code, List<Counts> counts, double periodScale) {
        ParsedSkill skill = getSkill(code);
        List<PostprocessEngine.Line> lines = new ArrayList<>();
        RawFees raw = computeRawCounts(skill, counts, periodScale);
        for (int i = 0; i < counts.size(); i++) {
            lines.add(new PostprocessEngine.Line(String.valueOf(i), String.valueOf(i), String.valueOf(i), List.of(),
                    raw.bound().finalCount()[i], raw.equalMicro().get(i), raw.perfMicro().get(i)));
        }
        return PostprocessEngine.run(DEFAULT_POSTPROCESS, lines).items().stream().map(PostprocessEngine.ItemResult::fee).toList();
    }

    /** 후처리 스크립트가 없을 때의 기본 정수화: 회비를 원 단위로 배분하고 균등분담분도 따로 배분 */
    public static final String DEFAULT_POSTPROCESS = "allocate(fee)";

    /**
     * Step 1 원시값(원 미만 포함, 백만분의 1원 단위 정수). equalMicro 는 균등분담분, perfMicro 는 실적분담분,
     * bound 는 변수 계산 결과(기관별 rawCount·차감·finalCount 확정값 포함).
     * 분리형(formula:equal/perf)이면 각 수식을 그대로 계산하고, 단일 수식이면 #institutionCount 와 기관별 변수를 함께 쓸 때
     * 실적이 0 인 가상 기관의 값(기관별 변수 모두 0)을 균등분담분으로 본다(회비보다 크면 회비까지).
     * 프론트 src/utils/skill.js computeRaw 와 같은 규칙이다.
     */
    public record RawFees(List<Long> equalMicro, List<Long> perfMicro, Bound bound) {
    }

    /** 실적 입력이 하나인 예전 방식 입력으로 계산: 기본 건수를 그 하나뿐인 입력 변수에 넣는다 (입력이 여럿인 기준이면 400) */
    public static RawFees computeRawCounts(ParsedSkill skill, List<Counts> counts, double periodScale) {
        requireSingleInput(skill);
        String input = skill.variables().inputs().get(0).name();
        return computeRaw(skill, counts.stream().map(c -> new Row(Map.of(input, c.rawCount()), c.deductedCount())).toList(), periodScale);
    }

    public static RawFees computeRaw(ParsedSkill skill, List<Row> rows, double periodScale) {
        requireFormula(skill);
        SkillVariables vars = skill.variables();
        Bound b = vars.bind(rows, periodScale);
        int n = rows.size();
        List<Long> equal = new ArrayList<>();
        List<Long> perf = new ArrayList<>();
        if (skill.isSplit()) {
            for (int i = 0; i < n; i++) {
                equal.add(toMicro(evaluate(skill.equalFormula(), b.contexts().get(i))));
                perf.add(toMicro(evaluate(skill.perfFormula(), b.contexts().get(i))));
            }
            return new RawFees(equal, perf, b);
        }
        boolean mixed = vars.isMixed(skill.formula());
        long equalMicro = mixed ? toMicro(evaluate(skill.formula(), vars.zeroContext(b))) : 0;
        for (int i = 0; i < n; i++) {
            long fee = toMicro(evaluate(skill.formula(), b.contexts().get(i)));
            long e = Math.min(equalMicro, fee);
            equal.add(e);
            perf.add(fee - e);
        }
        return new RawFees(equal, perf, b);
    }

    /** 실적 입력이 하나뿐인 기준인지 (아니면 실적 항목별 입력이 필요하다) */
    public static void requireSingleInput(ParsedSkill skill) {
        if (!skill.variables().singleInput()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "이 업무는 실적 항목 " + skill.variables().inputs().size() + "개("
                    + skill.variables().inputs().stream().map(SkillVariables.Definition::label).reduce((a, c) -> a + ", " + c).orElse("")
                    + ")를 각각 입력해야 합니다. 실적 엑셀을 올려 항목별 열을 연결한 뒤 산출해 주세요.");
        }
    }

    /** 균등(참가기관 수) + 실적(인정 건수) 혼합형 수식인지 (실적 입력 하나인 예전 방식) */
    public static boolean isMixed(String formula) {
        return SkillVariables.legacy().isMixed(formula);
    }

    /**
     * 원 → 백만분의 1원 정수. 정수부와 원 미만(백만분의 1원 단위로 반올림)을 따로 구해 프론트 skill.js toMicro 와 같은 값이 된다
     */
    static long toMicro(BigDecimal v) {
        BigDecimal floor = v.setScale(0, RoundingMode.FLOOR);
        long frac = v.subtract(floor).movePointRight(6).setScale(0, RoundingMode.HALF_UP).longValueExact();
        return floor.longValueExact() * PostprocessEngine.MICRO + frac;
    }

    /** 수식 한 번 평가 (실적 입력 하나인 예전 방식의 여섯 변수). 결과는 0 이상의 유한한 숫자여야 한다 */
    public static BigDecimal evaluate(String formula, Counts c, long totalCount, int institutionCount,
                                      double periodScale) {
        Map<String, Object> ctx = new LinkedHashMap<>();
        ctx.put(SkillVariables.RAW_COUNT, c.rawCount());
        ctx.put(SkillVariables.DEDUCTED_COUNT, c.deductedCount());
        ctx.put(SkillVariables.FINAL_COUNT, c.finalCount());
        ctx.put(SkillVariables.TOTAL_COUNT, totalCount);
        ctx.put(SkillVariables.INSTITUTION_COUNT, institutionCount);
        ctx.put(SkillVariables.PERIOD_SCALE, periodScale);
        return evaluate(formula, ctx);
    }

    /** 수식 한 번 평가. variables 는 기관별 변수 전부(공통값 포함). 결과는 0 이상의 유한한 숫자여야 한다 */
    public static BigDecimal evaluate(String formula, Map<String, Object> variables) {
        Object value;
        try {
            Expression expression = PARSER.parseExpression(formula);
            value = expression.getValue(SkillVariables.context(variables));
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
