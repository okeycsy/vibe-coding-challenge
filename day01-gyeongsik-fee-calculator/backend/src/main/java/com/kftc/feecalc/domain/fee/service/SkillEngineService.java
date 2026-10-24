package com.kftc.feecalc.domain.fee.service;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.expression.EvaluationContext;
import org.springframework.expression.Expression;
import org.springframework.expression.ExpressionParser;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.SimpleEvaluationContext;
import org.springframework.stereotype.Service;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

/**
 * 업무별 skill.md 기반 회비 산출 엔진.
 * <p>
 * skill.md 는 세 섹션으로 이뤄진다: "## 1. 비즈니스 규칙 요약"(화면 요약 박스), "## 2. AI 예외 차감 지침",
 * "## 3. 정산 수식"(```formula 코드 블록 안의 SpEL 수식). 수식에는 아래 변수를 쓴다.
 * <ul>
 *   <li>#rawCount 기본 건수, #deductedCount AI 차감 건수, #finalCount 최종 인정 건수</li>
 *   <li>#totalCount 전체 기관 인정 건수 합계, #institutionCount 참가기관 수, #periodScale 기간 환산 비율(분기 = 1)</li>
 * </ul>
 * 수식은 {@link SimpleEvaluationContext}(읽기 전용 데이터 바인딩)로 평가한다. 화면에서 누구나 수식을 바꿀 수 있으므로
 * T(...) 타입 참조, 생성자, 메서드 호출, 빈 참조를 막아 수식으로 서버 코드를 실행할 수 없게 한다.
 * <p>
 * 원본은 classpath:skills/{TASK_CODE}.md 이고, 화면에서 수정한 내용은 메모리에 두며 app.skills.dir 가 있으면 그 폴더에도 저장한다.
 */
@Slf4j
@Service
public class SkillEngineService {

    /** 업무 코드(skill.md 파일명) ↔ 업무 ID(Business.code, 프론트 BUSINESSES[].id) */
    private static final Map<String, String> TASK_TO_BUSINESS = new LinkedHashMap<>();

    static {
        TASK_TO_BUSINESS.put("OPEN_BANKING", "openbanking");
        TASK_TO_BUSINESS.put("FIN_INFO", "fininfo");
        TASK_TO_BUSINESS.put("CMS", "cms");
        TASK_TO_BUSINESS.put("CD_NET", "cd");
        TASK_TO_BUSINESS.put("INTERBANK", "interbank");
    }

    static final Pattern SUMMARY = Pattern.compile("(?ms)^##\\s*1\\.\\s*비즈니스 규칙 요약[ \\t]*\\R(.*?)(?=^##\\s|\\z)");
    static final Pattern AI_GUIDE = Pattern.compile("(?ms)^##\\s*2\\.\\s*AI 예외 차감 지침[ \\t]*\\R(.*?)(?=^##\\s|\\z)");
    static final Pattern FORMULA = Pattern.compile("(?s)```formula[ \\t]*\\R(.*?)```");
    static final Pattern TITLE = Pattern.compile("(?m)^#\\s+(.+)$");
    static final Pattern CALC_TYPE = Pattern.compile("(?m)^[-*]\\s*산정 유형\\s*:\\s*(.+)$");
    static final Pattern RATE_UNIT = Pattern.compile("(?m)^[-*]\\s*표시 단위\\s*:\\s*(.+)$");

    static final int MAX_MARKDOWN_LENGTH = 20_000;
    static final int MAX_FORMULA_LENGTH = 2_000;

    private final ExpressionParser parser = new SpelExpressionParser();
    private final Map<String, StoredSkill> skills = new ConcurrentHashMap<>();
    private final Path storageDir;

    public SkillEngineService(@Value("${app.skills.dir:}") String storageDir) {
        this.storageDir = storageDir == null || storageDir.isBlank() ? null : Path.of(storageDir);
    }

    /** 수정 이력. 원본(classpath) 그대로면 updatedBy 가 null 이다 */
    public record StoredSkill(String markdown, String updatedBy, LocalDateTime updatedAt) {
    }

    /** skill.md 를 섹션별로 나눈 결과 */
    public record ParsedSkill(String taskCode, String businessId, String title, String calcType, String rateUnit,
                              String summaryText, List<String> summary, String aiGuide, String formula) {
    }

    /** 기관별 수식 입력값 */
    public record Counts(long rawCount, long deductedCount, long finalCount) {
    }

    @PostConstruct
    void load() {
        for (String taskCode : TASK_TO_BUSINESS.keySet()) {
            String markdown = readSaved(taskCode);
            skills.put(taskCode, markdown != null
                    ? new StoredSkill(markdown, "file", null)
                    : new StoredSkill(readDefault(taskCode), null, null));
            parse(taskCode, skills.get(taskCode).markdown()); // 잘못된 파일이면 기동 시 바로 알 수 있게
        }
        log.info("skill.md {}개 적재 (저장 폴더: {})", skills.size(), storageDir == null ? "없음, 메모리" : storageDir);
    }

    // ---------- 조회·수정 ----------

    /** 업무 코드(OPEN_BANKING) 또는 업무 ID(openbanking)를 업무 코드로 바꾼다 */
    public String resolveTaskCode(String code) {
        if (code == null) {
            throw new BusinessException(ErrorCode.BUSINESS_NOT_FOUND);
        }
        String upper = code.trim().toUpperCase();
        if (TASK_TO_BUSINESS.containsKey(upper)) {
            return upper;
        }
        return TASK_TO_BUSINESS.entrySet().stream()
                .filter(e -> e.getValue().equalsIgnoreCase(code.trim()))
                .map(Map.Entry::getKey)
                .findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.BUSINESS_NOT_FOUND, "skill.md 가 없는 업무입니다: " + code));
    }

    public String businessIdOf(String code) {
        return TASK_TO_BUSINESS.get(resolveTaskCode(code));
    }

    public List<String> taskCodes() {
        return List.copyOf(TASK_TO_BUSINESS.keySet());
    }

    public StoredSkill getStored(String code) {
        return skills.get(resolveTaskCode(code));
    }

    public ParsedSkill getSkill(String code) {
        String taskCode = resolveTaskCode(code);
        return parse(taskCode, skills.get(taskCode).markdown());
    }

    public boolean isModified(String code) {
        String taskCode = resolveTaskCode(code);
        return !skills.get(taskCode).markdown().equals(readDefault(taskCode));
    }

    /** 수정한 skill.md 를 검증한 뒤 바로 반영한다 (다음 산출부터 새 수식 적용) */
    public ParsedSkill update(String code, String markdown, String updatedBy) {
        String taskCode = resolveTaskCode(code);
        if (markdown == null || markdown.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "skill.md 내용이 비어 있습니다.");
        }
        if (markdown.length() > MAX_MARKDOWN_LENGTH) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "skill.md 는 " + MAX_MARKDOWN_LENGTH + "자 이하로 작성해 주세요.");
        }
        String normalized = markdown.replace("\r\n", "\n");
        ParsedSkill parsed = parse(taskCode, normalized);
        // 예시 값으로 한 번 계산해 수식 오류를 저장 전에 잡는다
        evaluate(parsed.formula(), new Counts(1_000_000, 100_000, 900_000), 9_000_000, 8, 1.0);
        evaluate(parsed.formula(), new Counts(0, 0, 0), 0, 8, 0.5);

        skills.put(taskCode, new StoredSkill(normalized, updatedBy, LocalDateTime.now()));
        save(taskCode, normalized);
        log.info("skill.md 수정: {} by {}", taskCode, updatedBy);
        return parsed;
    }

    /** 원본(classpath) 내용으로 되돌린다 */
    public ParsedSkill reset(String code, String updatedBy) {
        String taskCode = resolveTaskCode(code);
        String markdown = readDefault(taskCode);
        skills.put(taskCode, new StoredSkill(markdown, null, null));
        if (storageDir != null) {
            try {
                Files.deleteIfExists(storageDir.resolve(taskCode + ".md"));
            } catch (IOException e) {
                log.warn("저장된 skill.md 삭제 실패: {}", taskCode, e);
            }
        }
        log.info("skill.md 원본 복원: {} by {}", taskCode, updatedBy);
        return parse(taskCode, markdown);
    }

    // ---------- 파싱 ----------

    /** 정규식으로 요약·AI 지침·수식을 꺼낸다. 요약과 수식이 없으면 오류 */
    public ParsedSkill parse(String taskCode, String markdown) {
        String summaryText = group(SUMMARY, markdown);
        if (summaryText == null || summaryText.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "'## 1. 비즈니스 규칙 요약' 섹션을 찾을 수 없습니다.");
        }
        String formula = group(FORMULA, markdown);
        if (formula == null || formula.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "'## 3. 정산 수식'의 ```formula 코드 블록을 찾을 수 없습니다.");
        }
        formula = formula.strip();
        if (formula.length() > MAX_FORMULA_LENGTH) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "수식은 " + MAX_FORMULA_LENGTH + "자 이하로 작성해 주세요.");
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
        return new ParsedSkill(taskCode, TASK_TO_BUSINESS.get(taskCode),
                title == null ? taskCode : title.strip(),
                calcType == null ? "skill.md 수식" : calcType.strip(),
                rateUnit == null ? "%" : rateUnit.strip(),
                summaryText.strip(), summary, aiGuide == null ? "" : aiGuide.strip(), formula);
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
    public BigDecimal evaluate(String formula, Counts c, long totalCount, int institutionCount, double periodScale) {
        EvaluationContext ctx = SimpleEvaluationContext.forReadOnlyDataBinding().build();
        ctx.setVariable("rawCount", c.rawCount());
        ctx.setVariable("deductedCount", c.deductedCount());
        ctx.setVariable("finalCount", c.finalCount());
        ctx.setVariable("totalCount", totalCount);
        ctx.setVariable("institutionCount", institutionCount);
        ctx.setVariable("periodScale", periodScale);
        Object value;
        try {
            Expression expression = parser.parseExpression(formula);
            value = expression.getValue(ctx);
        } catch (RuntimeException e) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "정산 수식을 계산할 수 없습니다: " + e.getMessage());
        }
        if (!(value instanceof Number n)) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "정산 수식 결과가 숫자가 아닙니다: " + value);
        }
        double d = n.doubleValue();
        if (Double.isNaN(d) || Double.isInfinite(d)) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "정산 수식 결과가 숫자가 아닙니다(0으로 나누기 등).");
        }
        BigDecimal result = n instanceof BigDecimal bd ? bd : (n instanceof Double || n instanceof Float)
                ? BigDecimal.valueOf(d) : BigDecimal.valueOf(n.longValue());
        if (result.signum() < 0) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "정산 수식 결과가 음수입니다: " + result);
        }
        return result;
    }

    // ---------- 저장 ----------

    private String readDefault(String taskCode) {
        ClassPathResource resource = new ClassPathResource("skills/" + taskCode + ".md");
        try (InputStream in = resource.getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8).replace("\r\n", "\n");
        } catch (IOException e) {
            throw new IllegalStateException("skill.md 원본을 읽을 수 없습니다: " + taskCode, e);
        }
    }

    private String readSaved(String taskCode) {
        if (storageDir == null) {
            return null;
        }
        Path file = storageDir.resolve(taskCode + ".md");
        try {
            return Files.exists(file) ? Files.readString(file, StandardCharsets.UTF_8) : null;
        } catch (IOException e) {
            log.warn("저장된 skill.md 를 읽지 못해 원본을 씁니다: {}", file, e);
            return null;
        }
    }

    private void save(String taskCode, String markdown) {
        if (storageDir == null) {
            return;
        }
        try {
            Files.createDirectories(storageDir);
            Files.writeString(storageDir.resolve(taskCode + ".md"), markdown, StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.warn("skill.md 파일 저장 실패(메모리에는 반영됨): {}", taskCode, e);
        }
    }
}
