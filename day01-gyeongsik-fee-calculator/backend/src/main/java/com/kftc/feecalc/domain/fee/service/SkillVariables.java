package com.kftc.feecalc.domain.fee.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.expression.EvaluationContext;
import org.springframework.expression.ExpressionParser;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.SimpleEvaluationContext;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;

/**
 * "## 3. 정산 수식"의 ```variables 블록: AI(또는 담당자)가 1번 규칙을 읽고 스스로 정한 변수 정의.
 * 수식(formula)은 예약 변수뿐 아니라 여기서 정의한 변수도 쓴다. 프론트 src/utils/skill.js 의 parseVariables·bindVariables 와 같은 규칙이다.
 * <pre>
 * # 주석 (줄 맨 앞 #)
 * withdrawCount = input("출금이체 건수")      ← 실적 엑셀의 열을 연결하는 기관별 입력값 (건수)
 * depositCount  = input("입금이체 건수")
 * rawCount      = #withdrawCount + #depositCount   ← 기준 실적 (입력이 2개 이상이면 꼭 정의, 1개면 그 입력이 자동으로 rawCount)
 * totalFee      = 300000000                          ← 상수
 * unitPrice     = #totalFee * 0.7 / #totalCount      ← 파생값(SpEL). 기관별 변수를 쓰면 기관별 값, 아니면 공통값
 * weighted      = sum(#withdrawCount)                ← 전체 기관 합계
 * </pre>
 * 예약 변수(정의할 수 없음): #deductedCount AI 차감 건수, #finalCount = rawCount − deductedCount(0 이상),
 * #totalCount = 전체 기관 finalCount 합계, #institutionCount 참가기관 수, #periodScale 기간 환산 비율.
 * 블록이 없으면 예전 문서와 같이 실적 입력 하나(rawCount = "기본 건수")만 있는 것으로 본다(금액 불변).
 */
public final class SkillVariables {

    public static final String RAW_COUNT = "rawCount";
    public static final String DEDUCTED_COUNT = "deductedCount";
    public static final String FINAL_COUNT = "finalCount";
    public static final String TOTAL_COUNT = "totalCount";
    public static final String INSTITUTION_COUNT = "institutionCount";
    public static final String PERIOD_SCALE = "periodScale";
    public static final String DEFAULT_INPUT_LABEL = "기본 건수";

    /** 블록에서 정의할 수 없는 예약 변수 (rawCount 는 정의할 수 있다) */
    public static final List<String> RESERVED = List.of(DEDUCTED_COUNT, FINAL_COUNT, TOTAL_COUNT, INSTITUTION_COUNT, PERIOD_SCALE);
    /** 기관별 값인 예약 변수 */
    static final Set<String> RESERVED_PER_INSTITUTION = Set.of(RAW_COUNT, DEDUCTED_COUNT, FINAL_COUNT);

    public static final int MAX_LINES = 30;
    public static final int MAX_LINE_LENGTH = 300;
    public static final int MAX_INPUTS = 10;
    public static final int MAX_LABEL_LENGTH = 100;

    static final Pattern NAME = Pattern.compile("^[a-z][A-Za-z0-9]{0,39}$");
    static final Pattern LINE = Pattern.compile("^([^\\s=]+)\\s*=\\s*(.+?)\\s*$");
    static final Pattern INPUT = Pattern.compile("^input\\(\\s*(?:\"([^\"]*)\"|'([^']*)')\\s*\\)$");
    static final Pattern SUM = Pattern.compile("^sum\\(\\s*#?([A-Za-z_][A-Za-z0-9_]*)\\s*\\)$");
    static final Pattern NUMBER = Pattern.compile("^-?\\d+(\\.\\d+)?$");
    /** 수식 안의 #변수 참조 */
    static final Pattern REF = Pattern.compile("#([A-Za-z_][A-Za-z0-9_]*)");

    private static final ExpressionParser PARSER = new SpelExpressionParser();

    public enum Kind {
        /** 실적 엑셀 열을 연결하는 기관별 입력 건수 */
        INPUT,
        /** 전체 기관 합계 */
        SUM,
        /** 상수 */
        NUMBER,
        /** SpEL 파생값 */
        EXPR
    }

    /**
     * 변수 한 줄. label 은 INPUT 의 설명(엑셀 열과 맞출 때 쓴다), expr 는 SUM 의 대상 변수명 / NUMBER 의 숫자 / EXPR 의 SpEL,
     * perInstitution 은 기관마다 값이 다른지, line 은 블록 안 줄 번호(1부터, 자동 보충된 줄은 0)
     */
    public record Definition(String name, Kind kind, String label, String expr, boolean perInstitution, int line) {

        /** 블록에 적는 한 줄 */
        public String text() {
            return switch (kind) {
                case INPUT -> name + " = input(\"" + label + "\")";
                case SUM -> name + " = sum(#" + expr + ")";
                default -> name + " = " + expr;
            };
        }
    }

    /** 기관별 입력값(실적 항목)과 AI 차감 건수 */
    public record Row(Map<String, Long> inputs, long deductedCount) {

        public static Row of(long rawCount, long deductedCount) {
            return new Row(Map.of(RAW_COUNT, rawCount), deductedCount);
        }
    }

    /**
     * 변수를 모두 계산한 결과. contexts 는 기관별 수식 변수(공통 변수 포함), rawCount·deducted·finalCount 는 기관별 확정 건수
     * (deducted 는 rawCount 를 넘지 않게 줄인 차감), totalCount 는 finalCount 합계
     */
    public record Bound(List<Map<String, Object>> contexts, Map<String, Object> globals, long[] rawCount, long[] deducted,
                        long[] finalCount, long totalCount) {

        public int size() {
            return contexts.size();
        }
    }

    private static final SkillVariables LEGACY = new SkillVariables("", List.of(
            new Definition(RAW_COUNT, Kind.INPUT, DEFAULT_INPUT_LABEL, null, true, 0)), false);

    private final String text;
    private final List<Definition> definitions;
    private final boolean hasBlock;
    private final int rawIndex;

    private SkillVariables(String text, List<Definition> definitions, boolean hasBlock) {
        this.text = text;
        this.definitions = List.copyOf(definitions);
        this.hasBlock = hasBlock;
        int idx = -1;
        for (int i = 0; i < definitions.size(); i++) {
            if (definitions.get(i).name().equals(RAW_COUNT)) {
                idx = i;
            }
        }
        this.rawIndex = idx;
    }

    /** 블록이 없는 예전 문서: 입력 하나(rawCount = 기본 건수) */
    public static SkillVariables legacy() {
        return LEGACY;
    }

    /** 블록 원문 */
    public String text() {
        return text;
    }

    /** ```variables 블록이 문서에 있는지 */
    public boolean hasBlock() {
        return hasBlock;
    }

    /** 정의 순서 그대로 (자동 보충한 rawCount 포함) */
    public List<Definition> definitions() {
        return definitions;
    }

    /** 실적 엑셀 열을 연결해야 하는 입력 변수들 (정의 순서) */
    public List<Definition> inputs() {
        return definitions.stream().filter(d -> d.kind() == Kind.INPUT).toList();
    }

    public boolean singleInput() {
        return inputs().size() == 1;
    }

    /** 수식에서 쓸 수 있는 모든 변수 이름 (정의 + 예약) */
    public List<String> names() {
        List<String> names = new ArrayList<>();
        definitions.forEach(d -> names.add(d.name()));
        RESERVED.forEach(r -> {
            if (!names.contains(r)) {
                names.add(r);
            }
        });
        return names;
    }

    /** 기관마다 값이 다른 변수 이름 */
    public Set<String> perInstitutionNames() {
        Set<String> names = new LinkedHashSet<>(RESERVED_PER_INSTITUTION);
        definitions.stream().filter(Definition::perInstitution).forEach(d -> names.add(d.name()));
        return names;
    }

    // ---------- 파싱 ----------

    /**
     * 블록 본문을 해석한다. 문법·순서·이름 규칙에 어긋나면 400 INVALID_FORMULA "변수 정의 N행: …".
     * null 이면 블록이 없는 것(legacy), 빈 블록은 입력 하나만 자동 보충한다
     */
    public static SkillVariables parse(String block) {
        if (block == null) {
            return LEGACY;
        }
        String normalized = block.replace("\r\n", "\n").strip();
        List<Definition> defs = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        String[] rows = normalized.isEmpty() ? new String[0] : normalized.split("\n");
        int count = 0;
        for (int i = 0; i < rows.length; i++) {
            String row = rows[i].strip();
            int no = i + 1;
            if (row.isEmpty() || row.startsWith("#") || row.startsWith("//")) {
                continue;
            }
            if (++count > MAX_LINES) {
                throw error(no, "변수는 " + MAX_LINES + "개 이하로 정의해 주세요.");
            }
            if (row.length() > MAX_LINE_LENGTH) {
                throw error(no, "한 줄은 " + MAX_LINE_LENGTH + "자 이하로 적어 주세요.");
            }
            Matcher m = LINE.matcher(row);
            if (!m.matches()) {
                throw error(no, "'이름 = 값' 형식이 아닙니다: " + row);
            }
            String name = m.group(1);
            String value = m.group(2);
            if (!NAME.matcher(name).matches()) {
                throw error(no, "변수 이름은 영문 소문자로 시작하는 영문·숫자(camelCase) 40자 이하여야 합니다: " + name);
            }
            if (RESERVED.contains(name)) {
                throw error(no, "'" + name + "'은(는) 엔진이 정하는 예약 변수라 정의할 수 없습니다.");
            }
            if (!seen.add(name)) {
                throw error(no, "변수 '" + name + "'이(가) 두 번 정의됐습니다.");
            }
            Matcher in = INPUT.matcher(value);
            Matcher sum = SUM.matcher(value);
            if (in.matches()) {
                String label = (in.group(1) != null ? in.group(1) : in.group(2)).strip();
                if (label.isEmpty()) {
                    throw error(no, "input(\"설명\")의 설명을 적어 주세요 (엑셀 열을 찾는 데 씁니다).");
                }
                if (label.length() > MAX_LABEL_LENGTH) {
                    throw error(no, "input 설명은 " + MAX_LABEL_LENGTH + "자 이하로 적어 주세요.");
                }
                defs.add(new Definition(name, Kind.INPUT, label, null, true, no));
            } else if (sum.matches()) {
                String src = sum.group(1);
                Definition source = find(defs, src);
                if (source == null && !RESERVED.contains(src) && !src.equals(RAW_COUNT)) {
                    throw error(no, "sum(#" + src + ")의 대상 변수가 앞에서 정의되지 않았습니다.");
                }
                boolean perInst = source != null ? source.perInstitution() : RESERVED_PER_INSTITUTION.contains(src);
                if (!perInst) {
                    throw error(no, "sum()은 기관별 값(input 또는 기관별 수식)만 합칠 수 있습니다: #" + src);
                }
                if (name.equals(RAW_COUNT)) {
                    throw error(no, "rawCount 는 기관별 값이어야 합니다 (input 또는 input 을 쓰는 수식).");
                }
                defs.add(new Definition(name, Kind.SUM, null, src, false, no));
            } else if (NUMBER.matcher(value).matches()) {
                if (name.equals(RAW_COUNT)) {
                    throw error(no, "rawCount 는 기관별 값이어야 합니다 (input 또는 input 을 쓰는 수식).");
                }
                defs.add(new Definition(name, Kind.NUMBER, null, value, false, no));
            } else {
                try {
                    PARSER.parseExpression(value);
                } catch (RuntimeException e) {
                    throw error(no, "수식 구문 오류: " + e.getMessage());
                }
                boolean perInst = false;
                for (String ref : referenced(value)) {
                    Definition source = find(defs, ref);
                    if (ref.equals(name)) {
                        throw error(no, "변수 '" + name + "'이(가) 자기 자신을 참조합니다.");
                    }
                    if (source == null && !RESERVED.contains(ref) && !ref.equals(RAW_COUNT)) {
                        throw error(no, "#" + ref + " 은(는) 앞에서 정의되지 않은 변수입니다 (변수는 위에서 아래 순서로 정의합니다).");
                    }
                    if (source != null ? source.perInstitution() : RESERVED_PER_INSTITUTION.contains(ref)) {
                        perInst = true;
                    }
                }
                if (name.equals(RAW_COUNT) && !perInst) {
                    throw error(no, "rawCount 는 기관별 값이어야 합니다 (input 또는 input 을 쓰는 수식).");
                }
                defs.add(new Definition(name, Kind.EXPR, null, value, perInst, no));
            }
        }
        long inputs = defs.stream().filter(d -> d.kind() == Kind.INPUT).count();
        if (inputs > MAX_INPUTS) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "변수 정의: 실적 입력(input)은 " + MAX_INPUTS + "개 이하여야 합니다.");
        }
        boolean hasRaw = defs.stream().anyMatch(d -> d.name().equals(RAW_COUNT));
        if (!hasRaw) {
            if (inputs == 0) {
                defs.add(0, new Definition(RAW_COUNT, Kind.INPUT, DEFAULT_INPUT_LABEL, null, true, 0));
            } else if (inputs == 1) {
                Definition only = defs.stream().filter(d -> d.kind() == Kind.INPUT).findFirst().orElseThrow();
                defs.add(defs.indexOf(only) + 1, new Definition(RAW_COUNT, Kind.EXPR, null, "#" + only.name(), true, 0));
            } else {
                throw new BusinessException(ErrorCode.INVALID_FORMULA, "변수 정의: 실적 입력(input)이 2개 이상이면 기준 실적 rawCount 를 정의해 주세요"
                        + " (예: rawCount = #" + defs.stream().filter(d -> d.kind() == Kind.INPUT).map(Definition::name).toList().get(0)
                        + " + #" + defs.stream().filter(d -> d.kind() == Kind.INPUT).map(Definition::name).toList().get(1) + ").");
            }
        }
        // rawCount 보다 앞줄에서는 차감·인정 건수·합계를 쓸 수 없다
        int rawAt = -1;
        for (int i = 0; i < defs.size(); i++) {
            Definition d = defs.get(i);
            if (d.name().equals(RAW_COUNT)) {
                rawAt = i;
                for (String ref : referenced(d.expr() == null ? "" : d.expr())) {
                    if (ref.equals(DEDUCTED_COUNT) || ref.equals(FINAL_COUNT) || ref.equals(TOTAL_COUNT)) {
                        throw error(d.line(), "rawCount 정의에는 #" + ref + " 을(를) 쓸 수 없습니다 (차감은 rawCount 가 정해진 뒤 계산합니다).");
                    }
                }
                continue;
            }
            if (rawAt >= 0) {
                continue;
            }
            String src = d.kind() == Kind.SUM ? "#" + d.expr() : d.kind() == Kind.EXPR ? d.expr() : "";
            for (String ref : referenced(src)) {
                if (RESERVED_PER_INSTITUTION.contains(ref) || ref.equals(TOTAL_COUNT)) {
                    throw error(d.line(), "#" + ref + " 은(는) rawCount 를 정의한 줄보다 뒤에서만 쓸 수 있습니다.");
                }
            }
        }
        return new SkillVariables(normalized, defs, true);
    }

    private static Definition find(List<Definition> defs, String name) {
        for (Definition d : defs) {
            if (d.name().equals(name)) {
                return d;
            }
        }
        return null;
    }

    private static BusinessException error(int line, String message) {
        return new BusinessException(ErrorCode.INVALID_FORMULA, "변수 정의 " + (line > 0 ? line + "행: " : "") + message);
    }

    /** 수식·변수 식 안에서 참조한 변수 이름 (등장 순서, 중복 없이) */
    public static Set<String> referenced(String expression) {
        Set<String> names = new LinkedHashSet<>();
        if (expression == null) {
            return names;
        }
        Matcher m = REF.matcher(expression);
        while (m.find()) {
            names.add(m.group(1));
        }
        return names;
    }

    /** 수식이 정의되지 않은 변수를 쓰면 400 */
    public void checkFormula(String formula) {
        List<String> allowed = names();
        List<String> unknown = referenced(formula).stream().filter(r -> !allowed.contains(r)).map(r -> "#" + r).toList();
        if (!unknown.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "수식에 정의되지 않은 변수가 있습니다: " + String.join(", ", unknown)
                    + " (쓸 수 있는 변수: " + allowed.stream().map(n -> "#" + n).reduce((a, b) -> a + ", " + b).orElse("") + ")");
        }
    }

    /** 균등(참가기관 수) + 실적(기관별 값) 혼합형 수식인지 */
    public boolean isMixed(String formula) {
        Set<String> refs = referenced(formula);
        if (!refs.contains(INSTITUTION_COUNT)) {
            return false;
        }
        Set<String> perInst = perInstitutionNames();
        return refs.stream().anyMatch(perInst::contains);
    }

    // ---------- 계산 ----------

    /**
     * 모든 기관의 변수를 정의 순서대로 계산한다. 입력에 없는 실적 항목은 0, 음수는 0 으로 본다.
     * rawCount 줄을 지나면 deductedCount(rawCount 를 넘지 않게)·finalCount 를 넣고, 모든 기관의 finalCount 가 나오면 totalCount 를 넣는다
     */
    public Bound bind(List<Row> rows, double periodScale) {
        int n = rows.size();
        Map<String, Object> globals = new LinkedHashMap<>();
        globals.put(INSTITUTION_COUNT, n);
        globals.put(PERIOD_SCALE, periodScale);
        List<Map<String, Object>> contexts = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            contexts.add(new LinkedHashMap<>());
        }
        long[] raw = new long[n];
        long[] deducted = new long[n];
        long[] fin = new long[n];
        long total = 0;
        for (int d = 0; d < definitions.size(); d++) {
            Definition def = definitions.get(d);
            switch (def.kind()) {
                case INPUT -> {
                    for (int i = 0; i < n; i++) {
                        Long v = rows.get(i).inputs() == null ? null : rows.get(i).inputs().get(def.name());
                        contexts.get(i).put(def.name(), v == null ? 0L : Math.max(0L, v));
                    }
                }
                case NUMBER -> globals.put(def.name(), number(def.expr()));
                case SUM -> {
                    boolean integral = true;
                    BigDecimal sum = BigDecimal.ZERO;
                    for (int i = 0; i < n; i++) {
                        Object v = contexts.get(i).get(def.expr());
                        Number num = v instanceof Number x ? x : 0L;
                        if (!(num instanceof Long || num instanceof Integer)) {
                            integral = false;
                        }
                        sum = sum.add(toDecimal(num));
                    }
                    globals.put(def.name(), integral ? (Object) sum.longValueExact() : (Object) sum.doubleValue());
                }
                case EXPR -> {
                    if (def.perInstitution()) {
                        for (int i = 0; i < n; i++) {
                            contexts.get(i).put(def.name(), evaluateRaw(def, merge(globals, contexts.get(i))));
                        }
                    } else {
                        globals.put(def.name(), evaluateRaw(def, globals));
                    }
                }
            }
            if (d == rawIndex) {
                for (int i = 0; i < n; i++) {
                    raw[i] = toCount(contexts.get(i).get(RAW_COUNT));
                    deducted[i] = Math.min(Math.max(0, rows.get(i).deductedCount()), raw[i]);
                    fin[i] = raw[i] - deducted[i];
                    total += fin[i];
                    contexts.get(i).put(RAW_COUNT, raw[i]);
                    contexts.get(i).put(DEDUCTED_COUNT, deducted[i]);
                    contexts.get(i).put(FINAL_COUNT, fin[i]);
                }
                globals.put(TOTAL_COUNT, total);
            }
        }
        for (int i = 0; i < n; i++) {
            Map<String, Object> ctx = merge(globals, contexts.get(i));
            contexts.set(i, ctx);
        }
        return new Bound(contexts, globals, raw, deducted, fin, total);
    }

    /**
     * 실적이 0 인 가상의 기관 변수(기관별 값은 모두 0, 공통값은 실제 계산값): 혼합형 단일 수식에서 균등분담분을 구할 때 쓴다
     */
    public Map<String, Object> zeroContext(Bound bound) {
        Map<String, Object> ctx = new LinkedHashMap<>();
        for (Definition def : definitions) {
            if (!def.perInstitution()) {
                continue;
            }
            if (def.kind() == Kind.INPUT) {
                ctx.put(def.name(), 0L);
            } else {
                ctx.put(def.name(), evaluateRaw(def, merge(bound.globals(), ctx)));
            }
            if (def.name().equals(RAW_COUNT)) {
                ctx.put(RAW_COUNT, 0L);
                ctx.put(DEDUCTED_COUNT, 0L);
                ctx.put(FINAL_COUNT, 0L);
            }
        }
        return merge(bound.globals(), ctx);
    }

    private static Map<String, Object> merge(Map<String, Object> globals, Map<String, Object> local) {
        Map<String, Object> ctx = new LinkedHashMap<>(globals);
        ctx.putAll(local);
        return ctx;
    }

    private static Object evaluateRaw(Definition def, Map<String, Object> ctx) {
        Object value;
        try {
            value = PARSER.parseExpression(def.expr()).getValue(context(ctx));
        } catch (RuntimeException e) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "변수 '" + def.name() + "'을(를) 계산할 수 없습니다: " + e.getMessage());
        }
        if (!(value instanceof Number num)) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "변수 '" + def.name() + "'의 값이 숫자가 아닙니다: " + value);
        }
        double d = num.doubleValue();
        if (Double.isNaN(d) || Double.isInfinite(d)) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "변수 '" + def.name() + "'의 값이 숫자가 아닙니다(0으로 나누기 등).");
        }
        return num instanceof Long || num instanceof Integer || num instanceof Short || num instanceof Byte ? (Object) num.longValue()
                : num instanceof BigDecimal bd ? (Object) bd : (Object) d;
    }

    /** 수식 평가 환경: 읽기 전용 데이터 바인딩(타입 참조·생성자·메서드·빈 참조 불가) */
    public static EvaluationContext context(Map<String, Object> variables) {
        EvaluationContext ctx = SimpleEvaluationContext.forReadOnlyDataBinding().build();
        variables.forEach(ctx::setVariable);
        return ctx;
    }

    private static long toCount(Object v) {
        if (!(v instanceof Number num)) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "rawCount 값이 숫자가 아닙니다: " + v);
        }
        BigDecimal d = toDecimal(num).setScale(0, RoundingMode.HALF_UP);
        if (d.signum() < 0) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "rawCount 값이 음수입니다: " + d);
        }
        if (d.compareTo(BigDecimal.valueOf(Long.MAX_VALUE)) > 0) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "rawCount 값이 너무 큽니다: " + d);
        }
        return d.longValueExact();
    }

    private static BigDecimal toDecimal(Number n) {
        return n instanceof BigDecimal bd ? bd : n instanceof Double || n instanceof Float ? BigDecimal.valueOf(n.doubleValue())
                : BigDecimal.valueOf(n.longValue());
    }

    private static Object number(String text) {
        return text.contains(".") ? (Object) Double.parseDouble(text) : (Object) Long.parseLong(text);
    }

    // ---------- 시험 계산용 예시 ----------

    /** 기관 8곳 예시 기본 실적. 첫 기관은 차감 10만 건 → 최종 90만 건, 전체 최종 900만 건 (예전 저장 검증 예시 값과 같다) */
    public static final long[] SAMPLE_RAW = {1_000_000, 1_200_000, 1_200_000, 1_200_000, 1_200_000, 1_100_000, 1_100_000, 1_100_000};
    public static final long[] SAMPLE_DEDUCTED = {100_000, 0, 0, 0, 0, 0, 0, 0};
    /** 예시 기간 환산 비율: 정상 = 한 분기, 실적 0 = 반 분기 */
    public static final double SAMPLE_SCALE_NORMAL = 1.0;
    public static final double SAMPLE_SCALE_ZERO = 0.5;

    /**
     * 시험 계산용 기관 8곳의 입력. 입력이 하나면 기본 실적 그대로, 여러 개면 기본 실적을 1:2:3… 비율로 나눠 넣는다
     * (rawCount = 입력 합이면 기본 실적과 거의 같다). zero 면 모두 0
     */
    public List<Row> sampleRows(boolean zero) {
        List<Definition> ins = inputs();
        int m = ins.size();
        int weightSum = m * (m + 1) / 2;
        List<Row> rows = new ArrayList<>();
        for (int i = 0; i < SAMPLE_RAW.length; i++) {
            Map<String, Long> inputs = new LinkedHashMap<>();
            for (int k = 0; k < m; k++) {
                long v = zero ? 0 : m == 1 ? SAMPLE_RAW[i] : Math.round((double) SAMPLE_RAW[i] * (k + 1) / weightSum);
                inputs.put(ins.get(k).name(), v);
            }
            rows.add(new Row(inputs, zero ? 0 : SAMPLE_DEDUCTED[i]));
        }
        return rows;
    }
}
