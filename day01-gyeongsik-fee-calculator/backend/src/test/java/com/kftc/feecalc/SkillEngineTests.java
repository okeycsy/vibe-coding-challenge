package com.kftc.feecalc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.startsWith;
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
import org.springframework.test.web.servlet.ResultActions;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.domain.fee.dto.CalculationRequest;
import com.kftc.feecalc.domain.fee.dto.CalculationResponse;
import com.kftc.feecalc.domain.fee.service.FeeCalculationService;
import com.kftc.feecalc.domain.fee.service.SkillEngineService;
import com.kftc.feecalc.domain.fee.service.SkillEngineService.Counts;
import com.kftc.feecalc.domain.fee.service.SkillFileService;

@SpringBootTest(properties = "app.skills.dir=${java.io.tmpdir}/feecalc-skills-${random.uuid}")
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class SkillEngineTests {

    private static final String H = "X-Employee-Id";

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper om;

    @Autowired
    SkillEngineService engine;

    @Autowired
    SkillFileService files;

    @Autowired
    FeeCalculationService calculationService;

    private ResultActions save(String who, String code, String content) throws Exception {
        return mvc.perform(put("/api/v1/skills/" + code).header(H, who).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("content", content))));
    }

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
            assertThatThrownBy(() -> SkillEngineService.evaluate(attack, c, 1, 1, 1.0))
                    .isInstanceOf(BusinessException.class);
        }
    }

    @Test
    void 일반담당자는_승인된_업무만_조회_수정할_수_있다() throws Exception {
        // hong: 오픈뱅킹·금거정 승인
        mvc.perform(get("/api/v1/skills").header(H, "hong"))
                .andExpect(jsonPath("$.data", hasSize(5)))
                .andExpect(jsonPath("$.data[0].accessible", is(true)))
                .andExpect(jsonPath("$.data[2].taskCode", is("CMS")))
                .andExpect(jsonPath("$.data[2].accessible", is(false)));
        mvc.perform(get("/api/v1/skills/OPEN_BANKING").header(H, "hong"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.taskName", is("오픈뱅킹")))
                .andExpect(jsonPath("$.data.content", startsWith("# 오픈뱅킹")))
                .andExpect(jsonPath("$.data.formula", containsString("#finalCount")));
        mvc.perform(get("/api/v1/skills/CMS").header(H, "hong"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.success", is(false)))
                .andExpect(jsonPath("$.message", is("해당 업무의 회비분담기준(skill.md) 접근 권한이 없습니다.")));
        save("hong", "CMS", files.read("CMS")).andExpect(status().isForbidden());
        // 참가기관, 사번 없음
        mvc.perform(get("/api/v1/skills/CMS").header(H, "shinhan")).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/skills/CMS")).andExpect(status().isUnauthorized());

        // 권한 신청 → 관리자 승인 → 접근 가능
        mvc.perform(post("/api/users/hong/task-requests").contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("businessCode", "cms", "reason", "테스트"))));
        mvc.perform(post("/api/task-requests/3/approve")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/skills/CMS").header(H, "hong")).andExpect(status().isOk());
        // 관리자는 전체
        mvc.perform(get("/api/v1/skills/INTERBANK").header(H, "admin")).andExpect(status().isOk());
    }

    @Test
    void 저장하면_파일이_바뀌고_다음_산출에_바로_반영된다() throws Exception {
        String content = files.read("OPEN_BANKING").replace("1000000) * 20", "1000000) * 25");
        save("hong", "OPEN_BANKING", content)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message", is("오픈뱅킹 회비분담기준(skill.md)이 성공적으로 저장 및 반영되었습니다.")))
                .andExpect(jsonPath("$.data.modified", is(true)))
                .andExpect(jsonPath("$.data.updatedBy", is("hong")));
        assertThat(files.read("OPEN_BANKING")).contains("1000000) * 25");
        assertThat(engine.calculate("OPEN_BANKING", 800_000, 0, 800_000, 0, 1)).isEqualTo(20_000_000L);

        // v1 산출 API: 권한 있는 사번만
        Map<String, Object> body = Map.of("businessId", "OPEN_BANKING", "from", "2026-07-01", "to", "2026-09-30");
        mvc.perform(post("/api/v1/fees/calculate").header(H, "hong").contentType(MediaType.APPLICATION_JSON)
                        .content(om.writeValueAsString(body)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.skillCode", is("OPEN_BANKING")))
                .andExpect(jsonPath("$.data.formula", containsString("* 25")))
                .andExpect(jsonPath("$.data.items", hasSize(8)));
        mvc.perform(post("/api/v1/fees/calculate").header(H, "kimms").contentType(MediaType.APPLICATION_JSON)
                        .content(om.writeValueAsString(body)))
                .andExpect(status().isForbidden());

        // 초기 기준 복원은 관리자만
        mvc.perform(post("/api/v1/skills/OPEN_BANKING/reset").header(H, "hong")).andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/skills/OPEN_BANKING/reset").header(H, "admin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.modified", is(false)));
    }

    @Test
    void 수식_구문오류나_섹션이_없으면_저장하지_않는다() throws Exception {
        String original = files.read("FIN_INFO");
        save("admin", "FIN_INFO", original.replaceAll("(?s)```formula.*?```", "```formula\n(#finalCount * 2\n```"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", startsWith("수식(formula) 구문 오류가 발견되었습니다.")));
        for (String bad : List.of(
                original.replaceAll("(?s)```formula.*?```", "```formula\nT(java.lang.System).exit(0)\n```"),
                original.replaceAll("(?s)```formula.*?```", "```formula\n#finalCount / 0.0\n```"),
                original.replace("## 1. 비즈니스 규칙 요약", "## 요약"))) {
            save("admin", "FIN_INFO", bad).andExpect(status().isBadRequest());
        }
        assertThat(files.read("FIN_INFO")).isEqualTo(original);
    }

    @Test
    void 경로_조작이나_없는_업무코드는_거부한다() throws Exception {
        for (String code : List.of("..%2F..%2Fetc%2Fpasswd", "OPEN_BANKING.md", "FOO")) {
            mvc.perform(get("/api/v1/skills/" + code).header(H, "admin"))
                    .andExpect(result -> assertThat(result.getResponse().getStatus()).isIn(400, 404));
        }
        assertThatThrownBy(() -> files.resolveTaskCode("../OPEN_BANKING")).isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> files.resolveTaskCode("OPEN_BANKING/../../x")).isInstanceOf(BusinessException.class);
    }

    @Test
    void 기존_산출API도_skill_md_수식을_쓴다() {
        CalculationResponse res = calculationService.calculate(new CalculationRequest("cms",
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 9, 30), List.of(), null, null, null));
        assertThat(res.skillCode()).isEqualTo("CMS");
        assertThat(res.items().get(0).fee()).isEqualTo(900_000 + res.items().get(0).finalCount() * 8);
    }
}
