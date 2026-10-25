package com.kftc.feecalc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kftc.feecalc.domain.fee.ai.RuleBasedFormulaGenerator;
import com.kftc.feecalc.domain.fee.dto.CalculationRequest;
import com.kftc.feecalc.domain.fee.dto.CalculationResponse;
import com.kftc.feecalc.domain.fee.service.FeeCalculationService;
import com.kftc.feecalc.domain.fee.service.SkillEngineService;
import com.kftc.feecalc.domain.fee.service.SkillEngineService.Counts;
import com.kftc.feecalc.domain.fee.service.SkillFileService;
import com.kftc.feecalc.domain.fee.service.PostprocessEngine;
import com.kftc.feecalc.domain.fee.service.PostprocessEngine.ItemResult;
import com.kftc.feecalc.domain.fee.service.PostprocessEngine.Line;
import com.kftc.feecalc.domain.fee.service.PostprocessScript;
import com.kftc.feecalc.domain.fee.service.SpecialRuleConverter;

/** AI 키가 없을 때(규칙 기반) 2단계 정산 파이프라인(수식 → 4번 특이사항)과 1번 규칙 기반 수식 자동 생성 */
@SpringBootTest(properties = {"app.skills.dir=${java.io.tmpdir}/feecalc-skills-${random.uuid}", "ai.api-key="})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class AiPipelineTests {

    private static final String H = "X-Employee-Id";

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper om;

    @Autowired
    FeeCalculationService calculationService;

    @Autowired
    SkillEngineService engine;

    @Autowired
    SkillFileService files;

    private ResultActions generate(String who, String code, String rules) throws Exception {
        return mvc.perform(post("/api/v1/skills/" + code + "/generate-formula").header(H, who)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("businessRulesText", rules))));
    }

    private static CalculationResponse.Item item(CalculationResponse res, String id) {
        return res.items().stream().filter(i -> i.institutionId().equals(id)).findFirst().orElseThrow();
    }

    @Test
    void 지침에서_차감하지_않는다고_한_이슈는_차감하지_않는다() {
        CalculationResponse res = calculationService.calculate(new CalculationRequest("cd",
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 9, 30),
                List.of("농협 공동망 장애로 재처리 800건 차감", "신한은행 자체 ATM 장애로 고객이 다시 시도한 300건"),
                null, null, "admin"));
        assertThat(res.aiMode()).isEqualTo("RULE");
        assertThat(res.issues()).extracting(CalculationResponse.Issue::applied).containsExactly(true, false);
        assertThat(res.issues().get(1).judgement()).startsWith("지침상 차감 제외: 기관 자체 ATM 장애");
        CalculationResponse.Item shinhan = res.items().stream().filter(i -> i.institutionId().equals("shinhan")).findFirst().orElseThrow();
        assertThat(shinhan.deduction()).isZero();
        CalculationResponse.Item nh = res.items().stream().filter(i -> i.institutionId().equals("nh")).findFirst().orElseThrow();
        assertThat(nh.deduction()).isEqualTo(800);
    }

    /** 대상 기관 절상 → 나머지 기관을 실적 내림차순(동률이면 기관코드)으로 1원씩 절삭했는지 */
    private static void assertRaisedAndShared(CalculationResponse res, String targetId) {
        CalculationResponse.Item target = item(res, targetId);
        assertThat(target.fee() % 10).isZero();
        assertThat(target.fee()).isGreaterThanOrEqualTo(target.beforeSpecialFee()).isLessThan(target.beforeSpecialFee() + 10);
        long up = target.fee() - target.beforeSpecialFee();
        assertThat(target.specialAdjustment()).isEqualTo(up);
        List<CalculationResponse.Item> others = res.items().stream().filter(i -> !i.institutionId().equals(targetId))
                .sorted((a, b) -> a.finalCount() != b.finalCount() ? Long.compare(b.finalCount(), a.finalCount())
                        : a.code().compareTo(b.code()))
                .toList();
        if (up > 0) {
            assertThat(target.specialRuleApplied()).isTrue();
            assertThat(target.specialReason()).isEqualTo("특이사항 반영: 10원 단위 절상 (+" + up + "원)");
        }
        for (int k = 0; k < others.size(); k++) {
            CalculationResponse.Item o = others.get(k);
            long expected = up / others.size() + (k < up % others.size() ? 1 : 0);
            assertThat(o.beforeSpecialFee() - o.fee()).as(o.name()).isEqualTo(expected);
            assertThat(o.specialAdjustment()).isEqualTo(-expected);
            if (expected > 0) {
                assertThat(o.specialReason()).isEqualTo("특이사항 반영: 절상 차이분 실적순 절삭 (-" + expected + "원)");
            } else {
                assertThat(o.specialReason()).isNull();
                assertThat(o.specialRuleApplied()).isFalse();
            }
        }
        // 합계는 1원도 달라지지 않는다
        assertThat(res.totalFeeAmount()).isEqualTo(res.totalBeforeSpecialFee());
    }

    @Test
    void 금거정은_4번_특이사항의_농협_10원_절상과_차이분_실적순_절삭을_반영한다() {
        CalculationResponse res = calculationService.calculate(new CalculationRequest("fininfo",
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 9, 30), List.of(), null, null, "admin"));
        assertThat(res.specialRules()).contains("NH농협은행은 회비를 10원 단위로 절상");
        assertRaisedAndShared(res, "nh");
        assertThat(res.totalFeeAmount()).isEqualTo(120_000_000L);
        // 혼합형이 아니면 균등분담분 0, 실적분담분 = 회비
        assertThat(res.items()).allSatisfy(i -> {
            assertThat(i.equalFee()).isZero();
            assertThat(i.perfFee()).isEqualTo(i.fee());
        });
    }

    @Test
    void CD공동망은_첫_기관을_10원_절상하고_균등분담분과_실적분담분으로_나눈다() {
        // 기관이 적힌 문장이 없으면 첫 번째 기관(신한은행)이 절상 대상
        for (int month = 1; month <= 10; month += 3) {
            LocalDate from = LocalDate.of(2026, month, 1);
            CalculationResponse res = calculationService.calculate(new CalculationRequest("cd",
                    from, from.plusMonths(3).minusDays(1), List.of(), null, null, "admin"));
            assertThat(res.items().get(0).institutionId()).isEqualTo("shinhan");
            assertRaisedAndShared(res, "shinhan");
            assertThat(res.totalFeeAmount()).isEqualTo(300_000_000L);
            assertThat(res.totalEqualFee()).isEqualTo(90_000_000L);
            assertThat(res.items()).allSatisfy(i -> {
                assertThat(i.equalFee()).isEqualTo(90_000_000L / res.items().size());
                assertThat(i.equalFee() + i.perfFee()).isEqualTo(i.fee());
            });
        }
    }

    private static Line line(String id, String code, String name, List<String> aliases, long count, long perfWon) {
        return new Line(id, code, name, aliases, count, 0, perfWon * PostprocessEngine.MICRO);
    }

    @Test
    void 후처리_스크립트_단위() {
        List<Line> lines = List.of(
                line("nh", "B011", "NH농협은행", List.of("농협", "NH"), 100, 512_344),
                line("a", "B001", "가은행", List.of(), 300, 600_000),
                line("b", "B002", "나은행", List.of(), 200, 287_656));
        PostprocessEngine.Result res = PostprocessEngine.run("""
                allocate(fee)
                roundUp(fee, 10, "NH농협은행")
                spreadDiff(perf, others, countDesc)
                min(fee, 300000)
                assert fee("NH농협은행") % 10 == 0
                assert sum(fee) == before
                """, lines);
        assertThat(res.items()).extracting(ItemResult::fee).containsExactly(512_350L, 599_997L, 300_000L);
        assertThat(res.items()).extracting(ItemResult::adjustment).containsExactly(6L, -3L, 12_344L);
        assertThat(res.items().get(0).reason()).isEqualTo("특이사항 반영: 10원 단위 절상 (+6원)");
        assertThat(res.items().get(2).reason()).isEqualTo("특이사항 반영: 절상 차이분 실적순 절삭 (-3원), 최저 회비 300,000원 적용 (+12,347원)");
        // 최저 회비로 늘어난 금액은 되돌리지 않아 합계가 늘고, 그 검증은 실패로 표시된다 (산출은 된다)
        assertThat(res.checks()).extracting(PostprocessEngine.Check::passed).containsExactly(true, false);
        // 절상 앞에 최저 회비를 두면 그 증액분도 함께 되돌린다 (spreadDiff 는 마지막 spreadDiff 이후 생긴 차이분을 모두 되돌린다)
        PostprocessEngine.Result acc = PostprocessEngine.run("allocate(fee)\nmin(fee, 300000)\nroundUp(fee, 10, \"NH농협은행\")\nspreadDiff(perf, others, countDesc)", lines);
        assertThat(acc.items()).extracting(ItemResult::fee).containsExactly(512_350L, 593_825L, 293_825L);

        // 기관명이 없으면 첫 번째 기관, 실적 동률이면 기관코드 순
        List<Line> tie = List.of(
                line("x", "B009", "첫은행", List.of(), 10, 1_001),
                line("y", "B005", "둘은행", List.of(), 50, 2_000),
                line("z", "B003", "셋은행", List.of(), 50, 3_000));
        String builtin = """
                allocate(fee)
                roundUp(fee, 10, first)
                spreadDiff(perf, others, countDesc)
                assert sum(fee) == before
                assert all(fee >= 0)
                """;
        PostprocessEngine.Result t = PostprocessEngine.run(builtin, tie);
        assertThat(t.items()).extracting(ItemResult::fee).containsExactly(1_010L, 1_996L, 2_995L);
        assertThat(t.allPassed()).isTrue();

        // 10원 미만 절사: 모든 기관, 합계는 줄어든다. 기본 스크립트(allocate)만이면 보정 없음
        assertThat(PostprocessEngine.run("allocate(fee)\nroundDown(fee, 10)", tie).items()).extracting(ItemResult::fee)
                .containsExactly(1_000L, 2_000L, 3_000L);
        assertThat(PostprocessEngine.run("allocate(fee)\nroundDown(fee, 100)", tie).items().get(0).reason())
                .isEqualTo("특이사항 반영: 100원 단위 절사 (-1원)");
        assertThat(PostprocessEngine.run(SkillEngineService.DEFAULT_POSTPROCESS, tie).items()).allSatisfy(r -> assertThat(r.applied()).isFalse());
        assertThat(SpecialRuleConverter.parseAmount("1억 2,000만원")).isEqualTo(120_000_000L);

        // 문법 검사: 모르는 함수·범위 밖 단위·없는 구성요소는 행 번호와 함께 거부
        for (String bad : List.of("exec(fee)", "roundUp(fee, 0)", "roundUp(total, 10)", "fixSum(equal, 25%, over=random)",
                "allocate(fee)\nassert sum(fee) => 1", "min(fee, -5)")) {
            assertThatThrownBy(() -> PostprocessScript.parse(bad)).as(bad).hasMessageContaining("후처리 스크립트");
        }
        // 정수화 전 fixSum 은 실행 오류 (저장 시험 실행에서 걸린다)
        assertThatThrownBy(() -> PostprocessEngine.trial("fixSum(equal, 25%, over=perfDesc, under=perfAsc)"))
                .hasMessageContaining("정수로 만든 뒤");
    }

    @Test
    void 균등25_실적75_분리_수식과_우체국_10원_절상_스크립트를_그대로_산출한다() {
        String md = """
                # CD공동망 회비 산정 기준 (CD_NET)

                ## 1. 비즈니스 규칙 요약
                - 총액 1억원, 25% 균등, 75% 실적 비례

                ## 2. AI 예외 차감 지침
                - 장애는 차감

                ## 3. 정산 수식
                ```formula:equal
                #institutionCount == 0 ? 0 : 100000000.0 * #periodScale * 0.25 / #institutionCount
                ```
                ```formula:perf
                #totalCount == 0 ? 0 : 100000000.0 * #periodScale * 0.75 * #finalCount / #totalCount
                ```

                ## 4. 최종 정산 특이사항
                - 균등분담회비·실적분담회비는 소수점 첫째 자리에서 반올림
                - 균등분담회비 합계가 총액의 25%와 다르면 실적분담회비 큰 기관부터 1원씩 보정
                - 우체국은 10원 단위로 절상하고 증액분은 실적분담회비에 가산
                - 증액분만큼 다른 기관의 실적분담회비를 실적분담회비가 큰 순서대로 1원씩 차감 (동률이면 기관코드 오름차순)

                ```postprocess
                roundHalf(equal)
                roundHalf(perf)
                fixSum(equal, 25%, over=perfDesc, under=perfAsc)
                fixSum(perf, 75%, over=perfDesc, under=perfAsc)
                roundUp(fee, 10, "우체국", addTo=perf)
                spreadDiff(perf, others, perfDesc)
                assert sum(equal) == 25%
                assert fee("우체국") % 10 == 0
                assert all(fee >= 0)
                assert sum(fee) == before
                ```
                """;
        SkillEngineService.ParsedSkill skill = SkillEngineService.parse("CD_NET", "cd", md);
        assertThat(skill.isSplit()).isTrue();
        assertThat(skill.equalFormula()).contains("0.25");
        assertThat(skill.formula()).startsWith("(").contains(") + (");
        assertThat(skill.specialRules()).hasSize(4);
        assertThat(skill.specialRulesRaw()).doesNotContain("postprocess");
        assertThat(skill.postprocess()).startsWith("roundHalf(equal)").hasLineCount(10);
        SkillEngineService.validateSkill(skill);

        long[] counts = {1_234_567, 876_543, 555_555, 333_333, 111_111, 77_777, 7};
        String[] names = {"국민은행", "신한은행", "우리은행", "하나은행", "NH농협은행", "우체국", "토스뱅크"};
        String[] codes = {"004", "088", "020", "081", "011", "071", "092"};
        List<Counts> cs = new java.util.ArrayList<>();
        List<Line> lines = new java.util.ArrayList<>();
        for (int i = 0; i < counts.length; i++) {
            cs.add(new Counts(counts[i], 0, counts[i]));
        }
        SkillEngineService.RawFees raw = SkillEngineService.computeRaw(skill, cs, 1.0);
        for (int i = 0; i < counts.length; i++) {
            lines.add(new Line(codes[i], codes[i], names[i], List.of(), counts[i], raw.equalMicro().get(i), raw.perfMicro().get(i)));
        }
        PostprocessEngine.Result res = PostprocessEngine.run(skill.postprocess(), lines);
        // 균등 25,000,000 / 7 = 3,571,428.57 → 반올림 3,571,429 × 7 = 25,000,003 → 실적 큰 3곳(국민·신한·우리) -1원
        assertThat(res.items().stream().mapToLong(ItemResult::equalFee).sum()).isEqualTo(25_000_000L);
        assertThat(res.items()).extracting(ItemResult::equalFee)
                .containsExactly(3_571_428L, 3_571_428L, 3_571_428L, 3_571_429L, 3_571_429L, 3_571_429L, 3_571_429L);
        ItemResult post = res.items().get(5);
        assertThat(post.fee() % 10).isZero();
        assertThat(post.fee()).isEqualTo(5_400_680L); // 1,829,248 + 3,571,429 = 5,400,677 → 절상 +3
        assertThat(post.reason()).isEqualTo("특이사항 반영: 10원 단위 절상 (+3원)");
        // 증액분 3원은 실적분담분이 큰 국민·신한·우리에서 1원씩
        assertThat(res.items()).extracting(ItemResult::perfFee).containsExactly(29_035_945L, 20_615_531L, 13_066_171L, 7_839_703L, 2_613_234L, 1_829_251L, 165L);
        assertThat(res.items().stream().mapToLong(ItemResult::fee).sum()).isEqualTo(100_000_000L);
        assertThat(res.items()).allSatisfy(r -> assertThat(r.equalFee() + r.perfFee()).isEqualTo(r.fee()));
        assertThat(res.allPassed()).as(res.checks().toString()).isTrue();
        // 보정 전 금액은 정수화(반올림) 직후 값: 합계 보정·절상·차감만 보정액으로 남는다
        assertThat(res.items().stream().mapToLong(ItemResult::beforeSpecialFee).sum()).isEqualTo(100_000_003L);
    }

    @Test
    void 내장_변환기는_4번_문장을_스크립트로_바꾸고_못_바꾼_문장은_따로_남긴다() {
        List<SpecialRuleConverter.Institution> insts = List.of(
                new SpecialRuleConverter.Institution("NH농협은행", List.of("농협", "NH")),
                new SpecialRuleConverter.Institution("가은행", List.of()));
        SpecialRuleConverter.Converted c = SpecialRuleConverter.convert("""
                - 최고 회비 1억원
                - 농협은 10원 단위로 절상한다.
                - 절상 차이분은 실적이 작은 순서대로 1원씩 절삭한다.
                - 분기 말 일괄 고지한다.
                """, insts);
        assertThat(c.script()).isEqualTo("""
                allocate(fee)
                max(fee, 100000000)
                roundUp(fee, 10, "NH농협은행")
                spreadDiff(perf, others, countAsc)
                assert fee("NH농협은행") % 10 == 0
                assert sum(fee) == before
                assert all(fee >= 0)""");
        assertThat(c.unsupported()).containsExactly("분기 말 일괄 고지한다.");
        assertThat(c.steps()).hasSize(5);
        PostprocessEngine.trial(c.script());

        // 균등 25% · 실적 75% + 지정 기관 10원 절상 (실적분담회비 순서) 문장
        SpecialRuleConverter.Converted john = SpecialRuleConverter.convert("""
                - 균등분담회비·실적분담회비는 소수점 첫째 자리에서 반올림한다.
                - 균등분담회비 합계가 총액의 25%와 다르면 실적분담회비가 큰 기관부터 1원씩 보정한다.
                - NH농협은행은 회비를 10원 단위로 절상하고 증액분은 실적분담회비에 가산한다.
                - 증액분만큼 다른 기관의 실적분담회비를 실적분담회비가 큰 순서대로 1원씩 차감한다. 동률이면 기관코드 오름차순.
                - [최종 검증] 회비 총액은 변하지 않아야 한다.
                """, insts);
        assertThat(john.script()).isEqualTo("""
                roundHalf(equal)
                roundHalf(perf)
                fixSum(equal, 25%, over=perfDesc, under=perfAsc)
                fixSum(perf, 75%, over=perfDesc, under=perfAsc)
                roundUp(fee, 10, "NH농협은행")
                spreadDiff(perf, others, perfDesc)
                assert sum(equal) == 25%
                assert fee("NH농협은행") % 10 == 0
                assert sum(fee) == before
                assert all(fee >= 0)""");
        assertThat(john.unsupported()).isEmpty();

        // 기본 3개 업무의 4번 문장은 내장 변환기로 바꿔도 skill.md 의 스크립트와 같은 금액이 나온다
        for (String code : List.of("CD_NET", "INTERBANK", "FIN_INFO")) {
            SkillEngineService.ParsedSkill skill = engine.getSkill(code);
            List<Line> sample = PostprocessEngine.sampleLines();
            String auto = SpecialRuleConverter.convert(skill.specialRulesRaw(),
                    sample.stream().map(l -> new SpecialRuleConverter.Institution(l.name(), l.aliases())).toList()).script();
            assertThat(PostprocessEngine.run(auto, sample).items()).extracting(ItemResult::fee)
                    .as(code).containsExactlyElementsOf(PostprocessEngine.run(skill.postprocess(), sample).items().stream().map(ItemResult::fee).toList());
        }

        // 스크립트 없이 자연어만 있으면 산출 때 내장 변환기로 바꿔 실행한다(AUTO_RULE), 4번이 없으면 기본 배분(DEFAULT)
        String md = files.read("CD_NET");
        String noScript = md.substring(0, md.indexOf("```postprocess"));
        assertThat(FeeCalculationService.scriptOf(SkillEngineService.parse("CD_NET", "cd", noScript), PostprocessEngine.sampleLines()).source())
                .isEqualTo("AUTO_RULE");
        assertThat(FeeCalculationService.scriptOf(SkillEngineService.parse("CD_NET", "cd", md.substring(0, md.indexOf("## 4."))), List.of()))
                .isEqualTo(new FeeCalculationService.Script("allocate(fee)", "DEFAULT"));
        // 스크립트가 틀리면 저장이 거부된다
        files.save("CD_NET", md, "admin");
        assertThatThrownBy(() -> files.save("CD_NET", md.replace("roundUp(fee, 10, first)", "roundUp(fee, 10, frist)"), "admin"))
                .hasMessageContaining("후처리 스크립트 2행");
    }

    @Test
    void 내장_변환기는_다섯_업무의_1번_규칙으로_3번_수식을_글자_그대로_다시_만든다() {
        List<Counts> samples = List.of(new Counts(0, 0, 0), new Counts(500, 0, 500), new Counts(800_000, 0, 800_000),
                new Counts(2_500_000, 0, 2_500_000), new Counts(4_000_000, 0, 4_000_000), new Counts(9_000_000, 0, 9_000_000));
        Map<String, String> patterns = Map.of("OPEN_BANKING", "구간별 차등 단가 (3구간 누진)", "FIN_INFO", "총액 대비 단순 실적 비율",
                "CMS", "기본료 + 건당 단가", "CD_NET", "균등 30% + 실적비례 70% 혼합분담", "INTERBANK", "건당 단가 + 최저·최고 한도");
        for (String code : patterns.keySet()) {
            SkillEngineService.ParsedSkill s = engine.getSkill(code);
            RuleBasedFormulaGenerator.Generated g = RuleBasedFormulaGenerator.generate(s.summaryText()).orElseThrow();
            assertThat(g.pattern()).as(code).isEqualTo(patterns.get(code));
            assertThat(g.formula()).as(code).isEqualTo(s.formula());
            assertThat(g.steps()).isNotEmpty();
            SkillEngineService.validateFormula(g.formula());
            for (Counts c : samples) {
                for (double scale : List.of(1.0, 0.5)) {
                    assertThat(SkillEngineService.evaluate(g.formula(), c, 20_000_000, 8, scale))
                            .isEqualByComparingTo(SkillEngineService.evaluate(s.formula(), c, 20_000_000, 8, scale));
                }
            }
        }
        // 실적 비율을 따로 적은 혼합형
        RuleBasedFormulaGenerator.Generated mixed = RuleBasedFormulaGenerator.generate(
                "- 총액 2억원 중 40%는 기관 수로 균등 분담\n- 60%는 실적 비례").orElseThrow();
        assertThat(mixed.formula()).isEqualTo("200000000.0 * #periodScale * ((#institutionCount == 0 ? 0 : 0.4 / #institutionCount)"
                + " + (#totalCount == 0 ? 0 : 0.6 * #finalCount / #totalCount))");
        // 혼합형은 분리 수식도 함께 만들고, 둘의 합은 총액 수식과 같다
        assertThat(mixed.equalFormula()).isEqualTo("#institutionCount == 0 ? 0 : 200000000.0 * #periodScale * 0.4 / #institutionCount");
        assertThat(mixed.perfFormula()).isEqualTo("#totalCount == 0 ? 0 : 200000000.0 * #periodScale * 0.6 * #finalCount / #totalCount");
        Counts c = new Counts(900_000, 0, 900_000);
        assertThat(SkillEngineService.evaluate(mixed.equalFormula(), c, 9_000_000, 8, 1.0)
                .add(SkillEngineService.evaluate(mixed.perfFormula(), c, 9_000_000, 8, 1.0)))
                .isEqualByComparingTo(SkillEngineService.evaluate(mixed.formula(), c, 9_000_000, 8, 1.0));
        assertThat(RuleBasedFormulaGenerator.generate("- 건당 단가 12원").orElseThrow().equalFormula()).isNull();
    }

    @Test
    void 일번_규칙_텍스트로_삼번_수식을_만들어_주고_저장은_하지_않는다() throws Exception {
        String original = files.read("CD_NET");
        String rules = engine.getSkill("CD_NET").summaryText().replace("3억원", "4억원");
        generate("admin", "CD_NET", rules)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.source", is("RULE")))
                .andExpect(jsonPath("$.data.detectedPattern", is("균등 30% + 실적비례 70% 혼합분담")))
                .andExpect(jsonPath("$.data.generatedFormula", containsString("400000000.0 * #periodScale")))
                .andExpect(jsonPath("$.data.equalFormula", containsString("0.3 / #institutionCount")))
                .andExpect(jsonPath("$.data.perfFormula", containsString("0.7 * #finalCount / #totalCount")))
                .andExpect(jsonPath("$.data.explanation[0]", containsString("4억원")))
                .andExpect(jsonPath("$.data.validationPassed", is(true)))
                // 4억 × (0.3/8 + 0.7 × 90만/900만) = 4,300만, 실적 0 · 반 분기 = 4억 × 0.5 × 0.3/8 = 750만
                .andExpect(jsonPath("$.data.sampleResultNormal", is(43_000_000)))
                .andExpect(jsonPath("$.data.sampleResultZero", is(7_500_000)));
        assertThat(files.read("CD_NET")).isEqualTo(original);

        // 권한: 저장과 같다 (kimms 는 CMS·타행환만)
        generate("kimms", "CD_NET", rules).andExpect(status().isForbidden());
        generate("kimms", "CMS", engine.getSkill("CMS").summaryText())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.sampleResultZero", is(0)));
        // 알아듣지 못하는 규칙, 빈 규칙
        generate("admin", "FIN_INFO", "- 담당자가 정한다")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("수식을 직접 작성해 주세요")));
        generate("admin", "FIN_INFO", " ").andExpect(status().isBadRequest());
    }

    @Test
    void AI_상태는_키_없이_규칙_기반으로_알린다() throws Exception {
        mvc.perform(get("/api/v1/ai/status"))
                .andExpect(jsonPath("$.data.enabled", is(false)))
                .andExpect(jsonPath("$.data.mode", is("RULE")));
    }
}
