package com.kftc.feecalc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;
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

    private ResultActions createTask(String who, Map<String, String> body) throws Exception {
        return mvc.perform(post("/api/v1/tasks").header(H, who).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body)));
    }

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

    @Test
    void 관리자는_업무를_추가하면_제목만_있는_md_파일이_하나_생긴다() throws Exception {
        mvc.perform(get("/api/v1/tasks").header(H, "admin"))
                .andExpect(jsonPath("$.data", hasSize(5)))
                .andExpect(jsonPath("$.data[0].fileName", is("OPEN_BANKING.md")))
                .andExpect(jsonPath("$.data[0].ready", is(true)))
                .andExpect(jsonPath("$.data[0].memberCount", is(1)));

        createTask("admin", Map.of("taskCode", "giro_pay", "name", "지로", "fileName", "giro-payment"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.taskCode", is("GIRO_PAY")))
                .andExpect(jsonPath("$.data.fileName", is("giro-payment.md")))
                .andExpect(jsonPath("$.data.builtIn", is(false)))
                .andExpect(jsonPath("$.data.ready", is(false)))
                .andExpect(jsonPath("$.data.createdBy", is("admin")));
        assertThat(Files.readString(files.directory().resolve("giro-payment.md"))).isEqualTo("# 지로 회비 산정 기준 (GIRO_PAY)\n");
        assertThat(Files.readString(files.directory().resolve("tasks.json"))).contains("giro-payment.md");

        // skill.md 관리 화면에도 보이고, 섹션이 비어 있어도 열린다
        mvc.perform(get("/api/v1/skills").header(H, "admin")).andExpect(jsonPath("$.data", hasSize(6)));
        mvc.perform(get("/api/v1/skills/GIRO_PAY").header(H, "admin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.content", is("# 지로 회비 산정 기준 (GIRO_PAY)\n")))
                .andExpect(jsonPath("$.data.parseError", containsString("비즈니스 규칙 요약")));
        // 섹션을 채워 저장하면 산출에 쓸 수 있다
        String filled = files.read("CMS").replace("# CMS 회비 산정 기준 (CMS)", "# 지로 회비 산정 기준 (GIRO_PAY)");
        save("admin", "GIRO_PAY", filled).andExpect(status().isOk());
        assertThat(engine.calculate("GIRO_PAY", 1000, 0, 1000, 0, 1)).isEqualTo(908_000L);
        assertThat(Files.readString(files.directory().resolve("giro-payment.md"))).isEqualTo(filled);
    }

    @Test
    void 업무_추가는_관리자만_하고_코드_이름_파일은_겹칠_수_없다() throws Exception {
        createTask("hong", Map.of("taskCode", "GIRO", "name", "지로")).andExpect(status().isForbidden());
        createTask("admin", Map.of("taskCode", "GIRO", "name", "지로")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.fileName", is("GIRO.md")));
        // 같은 파일(대소문자 무관)·같은 코드·같은 이름
        createTask("admin", Map.of("taskCode", "GIRO2", "name", "지로2", "fileName", "giro.MD"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("한 파일은 한 업무에만")));
        createTask("admin", Map.of("taskCode", "GIRO", "name", "다른 이름")).andExpect(status().isConflict());
        createTask("admin", Map.of("taskCode", "CMS2", "name", "CMS")).andExpect(status().isConflict());
        createTask("admin", Map.of("taskCode", "NEW_ONE", "name", "새 업무", "fileName", "OPEN_BANKING.md"))
                .andExpect(status().isConflict());
        // 경로 조작·형식 오류
        for (String bad : List.of("../evil", "a/b", "..", "x.txt", ".hidden", "tasks.json")) {
            createTask("admin", Map.of("taskCode", "BAD_FILE", "name", "잘못된 파일", "fileName", bad))
                    .andExpect(status().isBadRequest());
        }
        createTask("admin", Map.of("taskCode", "1ABC", "name", "숫자 시작")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/tasks")).andExpect(jsonPath("$.data", hasSize(6)));
    }

    @Test
    void 업무를_삭제하면_md_파일과_업무_권한도_지워진다() throws Exception {
        mvc.perform(delete("/api/v1/tasks/CMS").header(H, "hong")).andExpect(status().isForbidden());
        mvc.perform(delete("/api/v1/tasks/CMS").header(H, "admin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message", is("CMS 업무와 CMS.md 파일을 삭제했습니다.")));
        assertThat(files.directory().resolve("CMS.md")).doesNotExist();
        mvc.perform(get("/api/v1/tasks")).andExpect(jsonPath("$.data", hasSize(4)));
        mvc.perform(get("/api/v1/skills/CMS").header(H, "admin")).andExpect(status().isNotFound());
        // kimms 의 CMS 권한도 사라진다
        mvc.perform(get("/api/users/kimms")).andExpect(jsonPath("$.data.tasks", hasSize(1)));
        mvc.perform(delete("/api/v1/tasks/CMS").header(H, "admin")).andExpect(status().isNotFound());

        // 지운 파일명으로 다시 추가할 수 있다
        createTask("admin", Map.of("taskCode", "CMS_NEW", "name", "CMS 신규", "fileName", "CMS"))
                .andExpect(status().isCreated());
    }
}
