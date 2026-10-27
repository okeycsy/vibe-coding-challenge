package com.kftc.feecalc;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Map;

import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.fasterxml.jackson.databind.ObjectMapper;

/** 관리자 설정 > 기관 관리 API */
@SpringBootTest(properties = "app.skills.dir=${java.io.tmpdir}/feecalc-skills-${random.uuid}")
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class InstitutionManagementTests {

    private static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper om;

    private ResultActions save(String method, String path, String who, Map<String, Object> body) throws Exception {
        var req = method.equals("POST") ? post(path) : put(path);
        return mvc.perform(req.header("X-Employee-Id", who).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body)));
    }

    private ResultActions upload(Object[][] rows) throws Exception {
        byte[] xlsx;
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet s = wb.createSheet("실적");
            for (int r = 0; r < rows.length; r++) {
                Row row = s.createRow(r);
                row.createCell(0).setCellValue(rows[r][0].toString());
                // 날짜(년월)는 업로드에 꼭 필요하다
                row.createCell(2).setCellValue(r == 0 ? "기준월" : "2026-07");
                if (rows[r][1] instanceof Integer n) {
                    row.createCell(1).setCellValue(n);
                } else {
                    row.createCell(1).setCellValue(rows[r][1].toString());
                }
            }
            wb.write(out);
            xlsx = out.toByteArray();
        }
        return mvc.perform(multipart("/api/fee/uploads").file(new MockMultipartFile("file", "실적.xlsx", XLSX, xlsx)));
    }

    @Test
    void 시스템관리자만_기관_관리_API를_쓸_수_있다() throws Exception {
        mvc.perform(get("/api/v1/institutions")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/institutions").header("X-Employee-Id", "hong")).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/institutions").header("X-Employee-Id", "shinhan")).andExpect(status().isForbidden());
        save("POST", "/api/v1/institutions", "hong", Map.of("name", "새봄은행", "code", "N001"))
                .andExpect(status().isForbidden());

        mvc.perform(get("/api/v1/institutions").header("X-Employee-Id", "admin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data", hasSize(104)))
                .andExpect(jsonPath("$.data[0].id", is("shinhan")))
                .andExpect(jsonPath("$.data[0].typeLabel", is("은행")))
                .andExpect(jsonPath("$.data[0].memberCount", is(1)))
                .andExpect(jsonPath("$.data[0].calculationCount", is(1)))
                .andExpect(jsonPath("$.data[0].deletable", is(false)))
                .andExpect(jsonPath("$.data[33].typeLabel", is("증권")))
                .andExpect(jsonPath("$.data[8].deletable", is(true)));
    }

    @Test
    void 추가한_기관이_바로_엑셀_매칭과_산출에_반영된다() throws Exception {
        Object[][] rows = {{"기관명", "건수"}, {"신한은행", 1000}, {"새봄저축은행", 700}, {"N001", 300}};
        upload(rows).andExpect(jsonPath("$.data.unmatched", hasSize(2)));

        save("POST", "/api/v1/institutions", "admin",
                Map.of("name", "새봄저축은행", "code", "n001", "aliases", List.of("새봄", "I은행", " ")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id", is("n001")))
                .andExpect(jsonPath("$.data.code", is("N001")))
                .andExpect(jsonPath("$.data.type", is("BANK")))
                .andExpect(jsonPath("$.data.aliases", hasSize(2)))
                .andExpect(jsonPath("$.data.uploadOnly", is(true)));

        // 이름·기관코드 두 행이 같은 기관으로 합산된다
        String body = upload(rows)
                .andExpect(jsonPath("$.data.unmatched", hasSize(0)))
                .andExpect(jsonPath("$.data.counts", hasSize(2)))
                .andExpect(jsonPath("$.data.counts[1].institutionId", is("n001")))
                .andExpect(jsonPath("$.data.counts[1].baseCount", is(1000)))
                .andReturn().getResponse().getContentAsString();

        // AI 이슈 문장도 별칭으로 인식해 차감한다
        Map<String, Object> request = Map.of("businessId", "openbanking", "from", "2026-07-01", "to", "2026-09-30",
                "issues", List.of("I은행 9월 장애로 100건 중복 전송"),
                "counts", om.readTree(body).path("data").path("counts"));
        save("POST", "/api/v1/fees/calculate", "admin", request)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.items", hasSize(2)))
                .andExpect(jsonPath("$.data.items[1].name", is("새봄저축은행")))
                .andExpect(jsonPath("$.data.items[1].deduction", is(100)));

        // 업로드 없는 시연용 예시 실적에는 새 기관이 끼지 않는다
        save("POST", "/api/v1/fees/calculate", "admin",
                Map.of("businessId", "cd", "from", "2026-07-01", "to", "2026-09-30"))
                .andExpect(jsonPath("$.data.items", hasSize(8)));

        mvc.perform(get("/api/v1/institutions/match").header("X-Employee-Id", "admin").param("value", "새봄"))
                .andExpect(jsonPath("$.data.excel.id", is("n001")))
                .andExpect(jsonPath("$.data.excel.matchedBy", is("새봄")))
                .andExpect(jsonPath("$.data.issue.id", is("n001")));
    }

    @Test
    void 코드_이름_별칭이_다른_기관과_겹치면_거부한다() throws Exception {
        save("POST", "/api/v1/institutions", "admin", Map.of("name", "새봄은행", "code", "B088"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.data.field", is("code")));
        // 기관코드는 다른 기관의 내부 ID와도 겹치면 안 된다 (엑셀 매칭이 둘 다 같은 값으로 본다)
        save("POST", "/api/v1/institutions", "admin", Map.of("name", "새봄은행", "code", "KB"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.data.field", is("code")));
        save("POST", "/api/v1/institutions", "admin", Map.of("name", "신한은행", "code", "N001"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.data.field", is("name")));
        save("POST", "/api/v1/institutions", "admin", Map.of("name", "새봄은행", "code", "N001", "aliases", List.of("A은행")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.data.field", is("aliases")));
        save("POST", "/api/v1/institutions", "admin", Map.of("name", "새봄 은행", "code", "N001"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.data.field", is("name")));
        save("POST", "/api/v1/institutions", "admin", Map.of("name", "새봄은행", "code", "N-1"))
                .andExpect(status().isBadRequest());
        save("POST", "/api/v1/institutions", "admin", Map.of("id", "shinhan", "name", "새봄은행", "code", "N001"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.data.field", is("id")));

        // 자기 자신의 값은 그대로 두고 저장할 수 있다
        save("PUT", "/api/v1/institutions/shinhan", "admin",
                Map.of("name", "신한은행", "code", "B088", "type", "BANK", "aliases", List.of("신한", "A은행", "SH")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.aliases", hasSize(3)));
    }

    @Test
    void 이름을_바꿔도_지난_산출_이력은_당시_이름으로_남고_회원_소속은_바뀐다() throws Exception {
        save("PUT", "/api/v1/institutions/shinhan", "admin",
                Map.of("name", "신한뱅크", "code", "B088", "aliases", List.of("신한", "A은행")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.updatedBy", is("admin")));
        mvc.perform(get("/api/fee/calculations/1"))
                .andExpect(jsonPath("$.data.items[0].name", is("신한은행")));
        mvc.perform(get("/api/users"))
                .andExpect(jsonPath("$.data[?(@.id == 'shinhan')].org", org.hamcrest.Matchers.contains("신한뱅크")));
        upload(new Object[][] {{"기관명", "건수"}, {"신한뱅크", 10}, {"신한은행", 5}})
                .andExpect(jsonPath("$.data.counts[0].baseCount", is(15))); // '신한은행'은 별칭 '신한'으로 잡힌다
    }

    @Test
    void 사용_중지한_기관은_매칭과_산출에서_빠지고_다시_사용할_수_있다() throws Exception {
        mvc.perform(post("/api/v1/institutions/toss/deactivate").header("X-Employee-Id", "admin"))
                .andExpect(jsonPath("$.data.active", is(false)));
        upload(new Object[][] {{"기관명", "건수"}, {"토스뱅크", 10}, {"신한은행", 5}})
                .andExpect(jsonPath("$.data.counts", hasSize(1)))
                .andExpect(jsonPath("$.data.unmatched[0]", is("토스뱅크")));
        save("POST", "/api/v1/fees/calculate", "admin",
                Map.of("businessId", "cd", "from", "2026-07-01", "to", "2026-09-30"))
                .andExpect(jsonPath("$.data.items", hasSize(7)));
        save("POST", "/api/v1/fees/calculate", "admin", Map.of("businessId", "cd", "from", "2026-07-01",
                "to", "2026-09-30", "counts", List.of(Map.of("institutionId", "toss", "baseCount", 10))))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/institutions/match").header("X-Employee-Id", "admin").param("value", "토스"))
                .andExpect(jsonPath("$.data.excel", nullValue()));
        // 지난 산출 이력의 토스뱅크 행은 그대로
        mvc.perform(get("/api/fee/calculations/1"))
                .andExpect(jsonPath("$.data.items[7].name", is("토스뱅크")));
        // 사용 중지한 기관의 코드도 새 기관에 쓸 수 없다
        save("POST", "/api/v1/institutions", "admin", Map.of("name", "새봄은행", "code", "B092"))
                .andExpect(status().isConflict());

        mvc.perform(post("/api/v1/institutions/toss/activate").header("X-Employee-Id", "admin"))
                .andExpect(jsonPath("$.data.active", is(true)));
        upload(new Object[][] {{"기관명", "건수"}, {"토스뱅크", 10}})
                .andExpect(jsonPath("$.data.counts", hasSize(1)));
    }

    @Test
    void 이력이_있는_기관은_삭제할_수_없고_쓰이지_않은_기관만_삭제한다() throws Exception {
        mvc.perform(delete("/api/v1/institutions/shinhan").header("X-Employee-Id", "admin"))
                .andExpect(status().isConflict());
        mvc.perform(delete("/api/v1/institutions/t001").header("X-Employee-Id", "admin"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/institutions").header("X-Employee-Id", "admin"))
                .andExpect(jsonPath("$.data", hasSize(103)));
        mvc.perform(delete("/api/v1/institutions/t001").header("X-Employee-Id", "admin"))
                .andExpect(status().isNotFound());
    }
}
