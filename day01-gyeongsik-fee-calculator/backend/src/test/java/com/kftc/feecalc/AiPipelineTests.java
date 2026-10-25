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
import com.kftc.feecalc.domain.fee.ai.RuleBasedFeeRules;
import com.kftc.feecalc.domain.fee.ai.RuleBasedFeeRules.Adjustment;
import com.kftc.feecalc.domain.fee.ai.RuleBasedFeeRules.FeeLine;
import com.kftc.feecalc.domain.fee.ai.RuleBasedFormulaGenerator;
import com.kftc.feecalc.domain.fee.dto.CalculationRequest;
import com.kftc.feecalc.domain.fee.dto.CalculationResponse;
import com.kftc.feecalc.domain.fee.service.FeeCalculationService;
import com.kftc.feecalc.domain.fee.service.SkillEngineService;
import com.kftc.feecalc.domain.fee.service.SkillEngineService.Counts;
import com.kftc.feecalc.domain.fee.service.SkillFileService;

/** AI 키가 없을 때(규칙 기반) 2단계 파이프라인과 수식 자동 생성 */
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

    private ResultActions sync(String who, String code, String content) throws Exception {
        return mvc.perform(post("/api/v1/skills/sync-formula").header(H, who).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("taskCode", code, "content", content))));
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

    @Test
    void 비즈니스_규칙의_특정기관_10원_절상과_차이분_실적순_절삭을_반영한다() {
        CalculationResponse res = calculationService.calculate(new CalculationRequest("fininfo",
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 9, 30), List.of(), null, null, "admin"));
        CalculationResponse.Item nh = res.items().stream().filter(i -> i.institutionId().equals("nh")).findFirst().orElseThrow();
        assertThat(nh.fee() % 10).isZero();
        assertThat(nh.fee()).isGreaterThanOrEqualTo(nh.primaryFee()).isLessThan(nh.primaryFee() + 10);
        long up = nh.fee() - nh.primaryFee();
        if (up > 0) {
            assertThat(nh.aiAdjustReason()).isEqualTo("규칙 반영: 10원 단위 절상 (+" + up + "원)");
            // 나머지 7개 기관 중 실적이 큰 순서대로 1원씩
            List<CalculationResponse.Item> others = res.items().stream().filter(i -> !i.institutionId().equals("nh"))
                    .sorted((a, b) -> Long.compare(b.finalCount(), a.finalCount())).toList();
            for (int k = 0; k < others.size(); k++) {
                CalculationResponse.Item o = others.get(k);
                long expected = up / others.size() + (k < up % others.size() ? 1 : 0);
                assertThat(o.primaryFee() - o.fee()).isEqualTo(expected);
                if (expected > 0) {
                    assertThat(o.aiAdjustReason()).isEqualTo("규칙 반영: 절상 차이분 실적순 절삭 (-" + expected + "원)");
                } else {
                    assertThat(o.aiAdjustReason()).isNull();
                }
            }
        }
        // 합계 = 총액 유지
        assertThat(res.totalFeeAmount()).isEqualTo(120_000_000L).isEqualTo(res.totalPrimaryFee());
    }

    @Test
    void 규칙_기반_보정_단위() {
        String summary = """
                - NH농협은행은 회비를 10원 단위로 절상하고, 절상 차이분은 나머지 기관 중 실적이 큰 순서대로 1원씩 절삭
                - 최저 회비 30만원
                """;
        List<FeeLine> lines = List.of(
                new FeeLine("nh", "NH농협은행", List.of("농협", "NH"), 100, 512_344),
                new FeeLine("a", "가은행", List.of(), 300, 600_000),
                new FeeLine("b", "나은행", List.of(), 200, 287_656));
        List<Adjustment> adj = RuleBasedFeeRules.postProcess(summary, lines);
        assertThat(adj).extracting(Adjustment::finalFee).containsExactly(512_350L, 599_997L, 300_000L - 3);
        assertThat(adj.get(0).reason()).isEqualTo("규칙 반영: 10원 단위 절상 (+6원)");
        assertThat(adj.get(2).reason()).isEqualTo("규칙 반영: 최저 회비 300,000원 적용 (+12,344원), 절상 차이분 실적순 절삭 (-3원)");
        assertThat(RuleBasedFeeRules.parseAmount("1억 2,000만원")).isEqualTo(120_000_000L);
    }

    @Test
    void 규칙_기반_수식_생성기는_다섯_업무의_기존_수식과_같은_값을_낸다() {
        List<Counts> samples = List.of(new Counts(0, 0, 0), new Counts(500, 0, 500), new Counts(800_000, 0, 800_000),
                new Counts(2_500_000, 0, 2_500_000), new Counts(4_000_000, 0, 4_000_000), new Counts(9_000_000, 0, 9_000_000));
        for (String code : List.of("OPEN_BANKING", "FIN_INFO", "CMS", "CD_NET", "INTERBANK")) {
            SkillEngineService.ParsedSkill s = engine.getSkill(code);
            String generated = RuleBasedFormulaGenerator.generate(s.summaryText()).orElseThrow().formula();
            SkillEngineService.validateFormula(generated);
            for (Counts c : samples) {
                for (double scale : List.of(1.0, 0.5)) {
                    assertThat(SkillEngineService.evaluate(generated, c, 20_000_000, 8, scale).doubleValue())
                            .as(code + " " + c + " " + scale)
                            .isCloseTo(SkillEngineService.evaluate(s.formula(), c, 20_000_000, 8, scale).doubleValue(),
                                    org.assertj.core.data.Offset.offset(1e-6));
                }
            }
        }
    }

    @Test
    void 일번_규칙을_고치면_삼번_수식을_새로_만들어_주고_저장은_하지_않는다() throws Exception {
        String original = files.read("FIN_INFO");
        String edited = original.replace("총액 1억 2,000만원", "총액 2억원");
        sync("hong", "FIN_INFO", edited)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.source", is("RULE")))
                .andExpect(jsonPath("$.data.formula", is("#totalCount == 0 ? 0 : 200000000.0 * #periodScale * #finalCount / #totalCount")))
                .andExpect(jsonPath("$.data.previousFormula", containsString("120000000.0")))
                .andExpect(jsonPath("$.data.content", containsString("200000000.0 * #periodScale")))
                .andExpect(jsonPath("$.data.content", containsString("총액 2억원")))
                .andExpect(jsonPath("$.data.sampleFee", is(20_000_000)));
        assertThat(files.read("FIN_INFO")).isEqualTo(original);

        // 권한: 저장과 같다 (kimms 는 CMS·타행환만)
        sync("kimms", "FIN_INFO", edited).andExpect(status().isForbidden());
        sync("kimms", "CMS", files.read("CMS")).andExpect(status().isOk());
        // 알아듣지 못하는 규칙
        sync("admin", "FIN_INFO", original.replaceAll("(?s)## 1\\. 비즈니스 규칙 요약.*?## 2", "## 1. 비즈니스 규칙 요약\n\n- 담당자가 정한다\n\n## 2"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("수식을 직접 작성해 주세요")));
    }

    @Test
    void AI_상태는_키_없이_규칙_기반으로_알린다() throws Exception {
        mvc.perform(get("/api/v1/ai/status"))
                .andExpect(jsonPath("$.data.enabled", is(false)))
                .andExpect(jsonPath("$.data.mode", is("RULE")));
    }
}
