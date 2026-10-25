package com.kftc.feecalc;

import static org.assertj.core.api.Assertions.assertThat;
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
import com.kftc.feecalc.domain.fee.service.SpecialRulePostProcessor;
import com.kftc.feecalc.domain.fee.service.SpecialRulePostProcessor.FeeLine;
import com.kftc.feecalc.domain.fee.service.SpecialRulePostProcessor.Result;

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

    @Test
    void 특이사항_후처리_단위() {
        String special = """
                - NH농협은행은 회비를 10원 단위로 절상한다.
                - 절상 차이분은 나머지 기관 중 최종 인정 실적이 큰 순서대로 1원씩 절삭한다.
                - 최저 회비 30만원
                """;
        List<FeeLine> lines = List.of(
                new FeeLine("nh", "B011", "NH농협은행", List.of("농협", "NH"), 100, 512_344),
                new FeeLine("a", "B001", "가은행", List.of(), 300, 600_000),
                new FeeLine("b", "B002", "나은행", List.of(), 200, 287_656));
        List<Result> res = SpecialRulePostProcessor.apply(special, lines);
        assertThat(res).extracting(Result::finalFee).containsExactly(512_350L, 599_997L, 300_000L - 3);
        assertThat(res).extracting(Result::adjustment).containsExactly(6L, -3L, 12_341L);
        assertThat(res.get(0).reason()).isEqualTo("특이사항 반영: 10원 단위 절상 (+6원)");
        assertThat(res.get(2).reason()).isEqualTo("특이사항 반영: 최저 회비 300,000원 적용 (+12,344원), 절상 차이분 실적순 절삭 (-3원)");

        // 기관명이 없으면 첫 번째 기관, 실적 동률이면 기관코드 순
        List<FeeLine> tie = List.of(
                new FeeLine("x", "B009", "첫은행", List.of(), 10, 1_001),
                new FeeLine("y", "B005", "둘은행", List.of(), 50, 2_000),
                new FeeLine("z", "B003", "셋은행", List.of(), 50, 3_000));
        List<Result> t = SpecialRulePostProcessor.apply("""
                - 참가기관 중 1개 기관(첫 번째 기관 또는 지정 기관)은 산출된 회비 총액을 10원 단위로 절상한다.
                - 절상으로 인해 발생한 차이분(초과액)은 최종 인정 실적(#finalCount)이 큰 기관 순서대로 1원씩 절삭하여 분기 총액을 맞춘다.
                """, tie);
        assertThat(t).extracting(Result::finalFee).containsExactly(1_010L, 1_996L, 2_995L);

        // 10원 미만 절사: 모든 기관, 합계는 줄어든다. 특이사항이 없으면 그대로
        assertThat(SpecialRulePostProcessor.apply("- 10원 미만 절사(버림)", tie)).extracting(Result::finalFee)
                .containsExactly(1_000L, 2_000L, 3_000L);
        assertThat(SpecialRulePostProcessor.apply("- 100원 미만 절사", tie).get(0).reason())
                .isEqualTo("특이사항 반영: 100원 단위 절사 (-1원)");
        assertThat(SpecialRulePostProcessor.apply("", tie)).allSatisfy(r -> assertThat(r.applied()).isFalse());
        assertThat(SpecialRulePostProcessor.parseAmount("1억 2,000만원")).isEqualTo(120_000_000L);
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
