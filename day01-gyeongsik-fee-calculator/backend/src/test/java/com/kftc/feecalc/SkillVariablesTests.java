package com.kftc.feecalc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.domain.fee.service.SkillEngineService;
import com.kftc.feecalc.domain.fee.service.SkillEngineService.Counts;
import com.kftc.feecalc.domain.fee.service.SkillEngineService.ParsedSkill;
import com.kftc.feecalc.domain.fee.service.SkillEngineService.RawFees;
import com.kftc.feecalc.domain.fee.service.SkillVariables;
import com.kftc.feecalc.domain.fee.service.SkillVariables.Bound;
import com.kftc.feecalc.domain.fee.service.SkillVariables.Definition;
import com.kftc.feecalc.domain.fee.service.SkillVariables.Kind;
import com.kftc.feecalc.domain.fee.service.SkillVariables.Row;

/** "## 3. 정산 수식"의 ```variables 변수 정의: 파싱·순서 규칙·계산·예전 문서(블록 없음)와의 금액 동일성 (Spring 없이) */
class SkillVariablesTests {

    private static final String[] BUILT_IN = {"OPEN_BANKING", "FIN_INFO", "CMS", "CD_NET", "INTERBANK"};

    private static String builtIn(String code) throws IOException {
        return Files.readString(Path.of("src/main/resources/skills/" + code + ".md"));
    }

    private static String md(String variables, String formula) {
        return """
                # 예시 회비 산정 기준 (EX)

                - 업무명: 예시
                - 산정 유형: 예시
                - 표시 단위: 원/건

                ## 1. 비즈니스 규칙 요약
                - 출금이체·입금이체 건을 실적으로 인정

                ## 3. 정산 수식
                """ + (variables == null ? "" : "```variables\n" + variables + "\n```\n\n") + "```formula\n" + formula + "\n```\n";
    }

    @Test
    void 블록이_없으면_실적_입력_하나_rawCount로_읽는다() {
        SkillVariables v = SkillVariables.legacy();
        assertThat(v.hasBlock()).isFalse();
        assertThat(v.inputs()).extracting(Definition::name, Definition::label).containsExactly(org.assertj.core.groups.Tuple.tuple("rawCount", "기본 건수"));
        assertThat(v.names()).containsExactly("rawCount", "deductedCount", "finalCount", "totalCount", "institutionCount", "periodScale");
        Bound b = v.bind(List.of(Row.of(1_000, 100), Row.of(2_000, 5_000)), 0.5);
        assertThat(b.rawCount()).containsExactly(1_000, 2_000);
        // 차감은 기준 실적을 넘지 않는다
        assertThat(b.deducted()).containsExactly(100, 2_000);
        assertThat(b.finalCount()).containsExactly(900, 0);
        assertThat(b.totalCount()).isEqualTo(900);
        assertThat(b.contexts().get(0)).containsEntry("finalCount", 900L).containsEntry("totalCount", 900L)
                .containsEntry("institutionCount", 2).containsEntry("periodScale", 0.5);
    }

    @Test
    void 입력_여러_개와_파생_변수_상수_합계를_순서대로_정의한다() {
        SkillVariables v = SkillVariables.parse("""
                # 실적 항목
                withdrawCount = input("출금이체 건수")
                depositCount = input('입금이체 건수')
                rawCount = #withdrawCount + #depositCount
                totalFee = 300000000
                rate = 0.7
                weighted = #finalCount * 2
                weightedTotal = sum(#weighted)
                share = #totalCount == 0 ? 0 : #totalFee * #rate / #totalCount
                """);
        assertThat(v.hasBlock()).isTrue();
        assertThat(v.inputs()).extracting(Definition::name).containsExactly("withdrawCount", "depositCount");
        assertThat(v.definitions()).extracting(Definition::name)
                .containsExactly("withdrawCount", "depositCount", "rawCount", "totalFee", "rate", "weighted", "weightedTotal", "share");
        assertThat(v.definitions()).extracting(Definition::kind)
                .containsExactly(Kind.INPUT, Kind.INPUT, Kind.EXPR, Kind.NUMBER, Kind.NUMBER, Kind.EXPR, Kind.SUM, Kind.EXPR);
        assertThat(v.definitions()).extracting(Definition::perInstitution)
                .containsExactly(true, true, true, false, false, true, false, false);
        assertThat(v.perInstitutionNames()).contains("rawCount", "deductedCount", "finalCount", "withdrawCount", "depositCount", "weighted")
                .doesNotContain("totalFee", "weightedTotal", "share");
        assertThat(v.definitions().get(0).text()).isEqualTo("withdrawCount = input(\"출금이체 건수\")");
        assertThat(v.definitions().get(6).text()).isEqualTo("weightedTotal = sum(#weighted)");

        Bound b = v.bind(List.of(
                new Row(Map.of("withdrawCount", 100L, "depositCount", 50L), 30),
                new Row(Map.of("withdrawCount", 200L), 0),
                new Row(Map.of("depositCount", -7L), 0)), 1.0);
        assertThat(b.rawCount()).containsExactly(150, 200, 0);
        assertThat(b.finalCount()).containsExactly(120, 200, 0);
        assertThat(b.totalCount()).isEqualTo(320);
        assertThat(b.contexts().get(0)).containsEntry("weighted", 240L).containsEntry("weightedTotal", 640L).containsEntry("totalFee", 300000000L);
        assertThat(((Number) b.contexts().get(1).get("share")).doubleValue()).isCloseTo(300000000.0 * 0.7 / 320, org.assertj.core.data.Offset.offset(1e-6));
        // 실적 0 가상 기관: 기관별 값은 0, 공통값(합계·총건수)은 실제 값
        Map<String, Object> zero = v.zeroContext(b);
        assertThat(zero).containsEntry("withdrawCount", 0L).containsEntry("finalCount", 0L).containsEntry("weighted", 0L)
                .containsEntry("weightedTotal", 640L).containsEntry("totalCount", 320L);
    }

    @Test
    void 입력이_하나면_rawCount가_자동으로_그_입력이고_없으면_기본_건수_입력을_보충한다() {
        SkillVariables one = SkillVariables.parse("apiCalls = input(\"API 호출 건수\")\nunitPrice = 12");
        assertThat(one.definitions()).extracting(Definition::name).containsExactly("apiCalls", "rawCount", "unitPrice");
        assertThat(one.definitions().get(1).expr()).isEqualTo("#apiCalls");
        assertThat(one.definitions().get(1).line()).isZero();
        assertThat(one.singleInput()).isTrue();
        Bound b = one.bind(List.of(new Row(Map.of("apiCalls", 77L), 7)), 1.0);
        assertThat(b.rawCount()[0]).isEqualTo(77);
        assertThat(b.finalCount()[0]).isEqualTo(70);

        SkillVariables none = SkillVariables.parse("unitPrice = 12\n");
        assertThat(none.inputs()).extracting(Definition::name, Definition::label)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("rawCount", "기본 건수"));
        assertThat(SkillVariables.parse("").inputs()).hasSize(1);
        // rawCount 를 input 으로 직접 정의해도 된다
        SkillVariables explicit = SkillVariables.parse("rawCount = input(\"처리 건수\")");
        assertThat(explicit.inputs()).extracting(Definition::label).containsExactly("처리 건수");
    }

    @Test
    void 이름_순서_예약어_규칙을_어기면_행_번호와_함께_거부한다() {
        Map<String, String> bad = new java.util.LinkedHashMap<>();
        bad.put("a = input(\"x\")\nb = input(\"y\")", "rawCount 를 정의해 주세요");
        bad.put("finalCount = 3", "예약 변수");
        bad.put("periodScale = input(\"기간\")", "예약 변수");
        bad.put("a = 1\na = 2", "두 번 정의");
        bad.put("출금 = input(\"출금\")", "camelCase");
        bad.put("Abc = 1", "camelCase");
        bad.put("a_b = 1", "camelCase");
        bad.put("x = #y + 1\ny = 2", "앞에서 정의되지 않은");
        bad.put("x = #x + 1", "자기 자신");
        bad.put("fee = 100\ntotal = sum(#fee)", "기관별 값");
        bad.put("total = sum(#nothing)", "정의되지 않았");
        bad.put("rawCount = 5", "기관별 값");
        bad.put("rawCount = sum(#deductedCount)", "기관별 값");
        bad.put("x = #finalCount * 2\ny = input(\"y\")\nz = input(\"z\")\nrawCount = #y + #z", "뒤에서만");
        bad.put("y = input(\"y\")\nz = input(\"z\")\nrawCount = #y + #z - #deductedCount", "rawCount 정의에는");
        bad.put("x = (1 + ", "구문 오류");
        bad.put("x", "형식이 아닙니다");
        bad.put("x = input(\"\")", "설명을 적어");
        bad.put(java.util.stream.IntStream.range(0, 31).mapToObj(i -> "x" + i + " = 1").reduce((a, c) -> a + "\n" + c).orElseThrow(), "30개 이하");
        for (Map.Entry<String, String> e : bad.entrySet()) {
            assertThatThrownBy(() -> SkillVariables.parse(e.getKey())).as(e.getKey())
                    .isInstanceOf(BusinessException.class).hasMessageContaining(e.getValue());
        }
        assertThatThrownBy(() -> SkillVariables.parse("x = 1\ny = #x + 2").checkFormula("#y * #unknown"))
                .hasMessageContaining("#unknown").hasMessageContaining("#y");
        // 타입 참조는 구문은 통과해도 계산 때 막힌다
        SkillVariables attack = SkillVariables.parse("x = T(java.lang.Runtime).getRuntime()");
        assertThatThrownBy(() -> attack.bind(List.of(Row.of(1, 0)), 1.0)).hasMessageContaining("변수 'x'");
    }

    @Test
    void 혼합형_판정은_기관별_변수를_쓰는지로_본다() {
        SkillVariables legacy = SkillVariables.legacy();
        assertThat(legacy.isMixed("300000000.0 * (0.3 / #institutionCount + 0.7 * #finalCount / #totalCount)")).isTrue();
        assertThat(legacy.isMixed("#finalCount * 12")).isFalse();
        assertThat(legacy.isMixed("1000000.0 / #institutionCount")).isFalse();
        SkillVariables v = SkillVariables.parse("a = input(\"a\")\nb = input(\"b\")\nrawCount = #a + #b\nw = #a * 2");
        assertThat(v.isMixed("100.0 / #institutionCount + #w")).isTrue();
        assertThat(v.isMixed("100.0 / #institutionCount + #rawCount")).isTrue();
        assertThat(v.isMixed("100.0 / #institutionCount + #totalCount")).isFalse();
    }

    @Test
    void 시험_계산_예시는_기관_8곳이고_입력이_여럿이면_기본_실적을_나눠_넣는다() {
        List<Row> single = SkillVariables.legacy().sampleRows(false);
        assertThat(single).hasSize(8);
        assertThat(single.get(0).inputs()).containsEntry("rawCount", 1_000_000L);
        assertThat(single.get(0).deductedCount()).isEqualTo(100_000);
        Bound b = SkillVariables.legacy().bind(single, 1.0);
        assertThat(b.finalCount()[0]).isEqualTo(900_000);
        assertThat(b.totalCount()).isEqualTo(9_000_000);

        SkillVariables two = SkillVariables.parse("a = input(\"a\")\nb = input(\"b\")\nrawCount = #a + #b");
        List<Row> rows = two.sampleRows(false);
        assertThat(rows.get(0).inputs()).containsEntry("a", 333_333L).containsEntry("b", 666_667L);
        assertThat(two.bind(rows, 1.0).totalCount()).isEqualTo(9_000_000);
        assertThat(two.sampleRows(true)).allSatisfy(r -> {
            assertThat(r.inputs().values()).containsOnly(0L);
            assertThat(r.deductedCount()).isZero();
        });
    }

    @Test
    void 기본_다섯_업무는_블록이_없어도_읽히고_저장_검증을_통과하며_금액이_그대로다() throws IOException {
        for (String code : BUILT_IN) {
            ParsedSkill skill = SkillEngineService.parse(code, code.toLowerCase(), builtIn(code));
            assertThat(skill.variables().hasBlock()).as(code).isFalse();
            assertThat(skill.variables().singleInput()).isTrue();
            SkillEngineService.validateSkill(skill);
            // 같은 문서에 rawCount 입력 하나를 명시한 변수 블록을 넣어도 원시값이 같다
            String withBlock = builtIn(code).replace("```formula", "```variables\nrawCount = input(\"처리 건수\")\n```\n\n```formula");
            ParsedSkill explicit = SkillEngineService.parse(code, code.toLowerCase(), withBlock);
            assertThat(explicit.variables().hasBlock()).isTrue();
            List<Counts> counts = List.of(new Counts(1_234_567, 7, 1_234_560), new Counts(3_600_000, 0, 3_600_000),
                    new Counts(0, 0, 0), new Counts(9_000_000, 100, 8_999_900));
            RawFees a = SkillEngineService.computeRawCounts(skill, counts, 46 / 91.0);
            RawFees b = SkillEngineService.computeRaw(explicit,
                    counts.stream().map(c -> new Row(Map.of("rawCount", c.rawCount()), c.deductedCount())).toList(), 46 / 91.0);
            assertThat(b.equalMicro()).as(code).isEqualTo(a.equalMicro());
            assertThat(b.perfMicro()).as(code).isEqualTo(a.perfMicro());
            assertThat(a.bound().finalCount()).containsExactly(1_234_560, 3_600_000, 0, 8_999_900);
            // 예전 여섯 변수 평가와 변수 엔진 평가가 같다
            for (int i = 0; i < counts.size(); i++) {
                assertThat(SkillEngineService.evaluate(skill.formula(), a.bound().contexts().get(i)))
                        .isEqualByComparingTo(SkillEngineService.evaluate(skill.formula(), counts.get(i), a.bound().totalCount(), 4, 46 / 91.0));
            }
        }
    }

    @Test
    void 실적_항목_두_개를_골라_쓰는_수식을_끝까지_계산한다() {
        ParsedSkill skill = SkillEngineService.parse("EX", "ex", md("""
                withdrawCount = input("출금이체 건수")
                depositCount = input("입금이체 건수")
                inquiryCount = input("조회 건수")
                rawCount = #withdrawCount + #depositCount
                inquiryTotal = sum(#inquiryCount)
                """, "#finalCount * 20 + (#inquiryTotal == 0 ? 0 : 1000000.0 * #inquiryCount / #inquiryTotal)"));
        assertThat(skill.variables().inputs()).extracting(Definition::label).containsExactly("출금이체 건수", "입금이체 건수", "조회 건수");
        SkillEngineService.validateSkill(skill);
        RawFees raw = SkillEngineService.computeRaw(skill, List.of(
                new Row(Map.of("withdrawCount", 1_000L, "depositCount", 500L, "inquiryCount", 10L), 100),
                new Row(Map.of("withdrawCount", 200L, "depositCount", 0L, "inquiryCount", 30L), 0)), 1.0);
        assertThat(raw.bound().rawCount()).containsExactly(1_500, 200);
        assertThat(raw.bound().finalCount()).containsExactly(1_400, 200);
        assertThat(raw.equalMicro()).containsExactly(0L, 0L);
        assertThat(raw.perfMicro()).containsExactly((1_400 * 20 + 250_000) * 1_000_000L, (200 * 20 + 750_000) * 1_000_000L);
        // 실적 입력 하나만 주는 예전 방식으로는 산출할 수 없다
        assertThatThrownBy(() -> SkillEngineService.computeRawCounts(skill, List.of(new Counts(1, 0, 1)), 1.0))
                .hasMessageContaining("실적 항목 3개");
        // 수식이 정의되지 않은 변수를 쓰면 저장 검증 거부
        ParsedSkill undefined = SkillEngineService.parse("EX", "ex", md("a = input(\"a\")", "#a * #price"));
        assertThatThrownBy(() -> SkillEngineService.validateSkill(undefined)).hasMessageContaining("#price");
        // 변수 블록 문법 오류는 파싱 단계에서 거부
        assertThatThrownBy(() -> SkillEngineService.parse("EX", "ex", md("a = input(\"a\")\nb = input(\"b\")", "#a")))
                .isInstanceOf(BusinessException.class).hasMessageContaining("rawCount");
    }

    @Test
    void 혼합형_단일_수식은_기관별_변수가_0인_가상_기관_값을_균등분담분으로_본다() {
        ParsedSkill skill = SkillEngineService.parse("EX", "ex", md("""
                calls = input("호출 건수")
                totalFee = 100000000
                """, "#totalFee * #periodScale * ((#institutionCount == 0 ? 0 : 0.4 / #institutionCount)"
                + " + (#totalCount == 0 ? 0 : 0.6 * #finalCount / #totalCount))"));
        RawFees raw = SkillEngineService.computeRaw(skill, List.of(
                new Row(Map.of("calls", 300L), 0), new Row(Map.of("calls", 100L), 0)), 1.0);
        assertThat(raw.equalMicro()).containsExactly(20_000_000L * 1_000_000, 20_000_000L * 1_000_000);
        assertThat(raw.perfMicro()).containsExactly(45_000_000L * 1_000_000, 15_000_000L * 1_000_000);
    }
}
