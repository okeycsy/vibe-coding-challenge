package com.kftc.feecalc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.domain.fee.dto.CalculationRequest;
import com.kftc.feecalc.domain.fee.dto.CalculationResponse;
import com.kftc.feecalc.domain.fee.service.FeeCalculationService;
import com.kftc.feecalc.domain.fee.service.SkillEngineService;
import com.kftc.feecalc.domain.fee.service.SkillEngineService.Counts;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class SkillEngineTests {

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper om;

    @Autowired
    SkillEngineService engine;

    @Autowired
    FeeCalculationService calculationService;

    private static final LocalDate Q3_FROM = LocalDate.of(2026, 7, 1);
    private static final LocalDate Q3_TO = LocalDate.of(2026, 9, 30);

    @Test
    void 다섯_업무의_요약과_수식을_정규식으로_꺼낸다() {
        for (String code : List.of("OPEN_BANKING", "FIN_INFO", "CMS", "CD_NET", "INTERBANK")) {
            SkillEngineService.ParsedSkill s = engine.getSkill(code);
            assertThat(s.summary()).isNotEmpty();
            assertThat(s.aiGuide()).isNotBlank();
            assertThat(s.formula()).contains("#finalCount");
        }
        assertThat(engine.getSkill("openbanking").taskCode()).isEqualTo("OPEN_BANKING");
        assertThat(engine.getSkill("CD_NET").calcType()).isEqualTo("균등 분담 + 실적 비례 분담");
    }

    @Test
    void 업무마다_다른_수식으로_계산한다() {
        // 구간별 차등 단가: 100만×20 + 200만×15 + 50만×10
        assertThat(engine.calculate("OPEN_BANKING", 3_600_000, 100_000, 3_500_000, 0, 1)).isEqualTo(55_000_000L);
        assertThat(engine.calculate("OPEN_BANKING", 800_000, 0, 800_000, 0, 1)).isEqualTo(16_000_000L);
        // 총액 1.2억 × 25%
        assertThat(engine.calculate("FIN_INFO", 250, 0, 250, 1000, 8)).isEqualTo(30_000_000L);
        // 기본료 90만 + 8원/건, 실적 0건이면 기본료 없음
        assertThat(engine.calculate("CMS", 1000, 0, 1000, 0, 1)).isEqualTo(908_000L);
        assertThat(engine.calculate("CMS", 10, 10, 0, 0, 1)).isZero();
        // 3억 × (30% ÷ 4개 기관 + 70% × 50%)
        assertThat(engine.calculate("CD_NET", 500, 0, 500, 1000, 4)).isEqualTo(127_500_000L);
        // 최저 50만, 최고 1억
        assertThat(engine.calculate("INTERBANK", 100, 0, 100, 0, 1)).isEqualTo(500_000L);
        assertThat(engine.calculate("INTERBANK", 1_000_000, 0, 1_000_000, 0, 1)).isEqualTo(12_000_000L);
        assertThat(engine.calculate("INTERBANK", 9_000_000, 0, 9_000_000, 0, 1)).isEqualTo(100_000_000L);
    }

    @Test
    void 총액분담은_원단위까지_합계가_총액과_같다() {
        List<Long> fees = engine.calculateAll("FIN_INFO",
                List.of(new Counts(1, 0, 1), new Counts(1, 0, 1), new Counts(1, 0, 1)), 1.0);
        assertThat(fees).containsExactly(40_000_000L, 40_000_000L, 40_000_000L);

        List<Long> odd = engine.calculateAll("CD_NET",
                List.of(new Counts(7, 0, 7), new Counts(11, 0, 11), new Counts(13, 0, 13)), 46 / 91.0);
        assertThat(odd.stream().mapToLong(Long::longValue).sum()).isEqualTo(Math.round(300_000_000L * 46 / 91.0));
    }

    @Test
    void 수식에서_자바_타입과_메서드는_쓸_수_없다() {
        Counts c = new Counts(1, 0, 1);
        for (String attack : List.of("T(java.lang.Runtime).getRuntime().exec('id')",
                "new java.io.File('/tmp/x').delete()",
                "#finalCount.getClass().forName('java.lang.Runtime')",
                "@someBean")) {
            assertThatThrownBy(() -> engine.evaluate(attack, c, 1, 1, 1.0)).isInstanceOf(BusinessException.class);
        }
    }

    @Test
    void 산출API는_skill_md_수식을_실행한다() throws Exception {
        Map<String, Object> body = Map.of("businessId", "OPEN_BANKING", "from", "2026-07-01", "to", "2026-09-30");
        mvc.perform(post("/api/v1/fees/calculate").contentType(MediaType.APPLICATION_JSON).content(om.writeValueAsString(body)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.skillCode", is("OPEN_BANKING")))
                .andExpect(jsonPath("$.data.calcType", is("구간별 차등 단가")))
                .andExpect(jsonPath("$.data.items", hasSize(8)))
                // 신한 5,156,170건: 5,000만 + 2,156,170 × 10
                .andExpect(jsonPath("$.data.items[0].fee", is(71_561_700)));
    }

    @Test
    void 관리자가_skill_md를_고치면_바로_반영되고_되돌릴_수_있다() throws Exception {
        String markdown = engine.getStored("CMS").markdown()
                .replace("(#finalCount > 0 ? 900000 * #periodScale : 0) + #finalCount * 8", "#finalCount * 10");

        // 시스템관리자가 아니면 거부
        mvc.perform(put("/api/v1/fees/skill/CMS").contentType(MediaType.APPLICATION_JSON)
                        .content(om.writeValueAsString(Map.of("markdown", markdown, "updatedBy", "hong"))))
                .andExpect(status().isForbidden());

        mvc.perform(put("/api/v1/fees/skill/CMS").contentType(MediaType.APPLICATION_JSON)
                        .content(om.writeValueAsString(Map.of("markdown", markdown, "updatedBy", "admin"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.formula", is("#finalCount * 10")))
                .andExpect(jsonPath("$.data.modified", is(true)));

        CalculationResponse res = calculationService.calculate(
                new CalculationRequest("cms", Q3_FROM, Q3_TO, List.of(), null, null, null));
        assertThat(res.items()).allSatisfy(i -> assertThat(i.fee()).isEqualTo(i.finalCount() * 10));
        assertThat(res.items().get(0).rateLabel()).isEqualTo("10원/건");

        mvc.perform(delete("/api/v1/fees/skill/cms").param("updatedBy", "admin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.modified", is(false)))
                .andExpect(jsonPath("$.data.formula", containsString("900000")));
    }

    @Test
    void 잘못된_수식이나_섹션이_없으면_저장하지_않는다() throws Exception {
        String original = engine.getStored("FIN_INFO").markdown();
        for (String bad : List.of(
                original.replaceAll("(?s)```formula.*?```", "```formula\nT(java.lang.System).exit(0)\n```"),
                original.replaceAll("(?s)```formula.*?```", "```formula\n#finalCount / 0.0\n```"),
                original.replace("## 1. 비즈니스 규칙 요약", "## 요약"))) {
            mvc.perform(put("/api/v1/fees/skill/FIN_INFO").contentType(MediaType.APPLICATION_JSON)
                            .content(om.writeValueAsString(Map.of("markdown", bad, "updatedBy", "admin"))))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(get("/api/v1/fees/skill/FIN_INFO"))
                .andExpect(jsonPath("$.data.markdown", is(original)))
                .andExpect(jsonPath("$.data.summary", hasSize(4)));
    }
}
