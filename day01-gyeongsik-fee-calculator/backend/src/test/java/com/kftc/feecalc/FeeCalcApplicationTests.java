package com.kftc.feecalc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.ByteArrayOutputStream;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kftc.feecalc.domain.fee.dto.CalculationRequest;
import com.kftc.feecalc.domain.fee.dto.CalculationResponse;
import com.kftc.feecalc.domain.fee.service.FeeCalculationService;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class FeeCalcApplicationTests {

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper om;

    @Autowired
    FeeCalculationService feeCalculationService;

    private String json(Object o) throws Exception {
        return om.writeValueAsString(o);
    }

    @Test
    void 로그인_성공시_회원정보를_돌려준다() throws Exception {
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("id", "hong", "password", "kftc1234!!"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.data.role", is("operator")))
                .andExpect(jsonPath("$.data.tasks", hasSize(2)));
    }

    @Test
    void 비밀번호_5회_오류면_잠기고_잠금초기화후_로그인된다() throws Exception {
        String wrong = json(Map.of("id", "kimms", "password", "x"));
        for (int i = 1; i <= 4; i++) {
            mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(wrong))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.data.remainingAttempts", is(5 - i)));
        }
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(wrong))
                .andExpect(status().isLocked())
                .andExpect(jsonPath("$.data.locked", is(true)));
        // 잠긴 뒤에는 맞는 비밀번호도 거부
        String right = json(Map.of("id", "kimms", "password", "kftc1234!!"));
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(right))
                .andExpect(status().isLocked());

        mvc.perform(get("/api/auth/locks")).andExpect(jsonPath("$.data", hasSize(3)));
        mvc.perform(delete("/api/auth/locks/kimms")).andExpect(status().isOk());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(right))
                .andExpect(status().isOk());
    }

    @Test
    void 승인대기_계정은_로그인할_수_없다() throws Exception {
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("id", "hana01", "password", "kftc1234!!"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.success", is(false)));
    }

    @Test
    void 시연용_실적은_프론트엔드_Mock과_같은_값이다() {
        CalculationResponse res = feeCalculationService.calculate(new CalculationRequest("openbanking",
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 9, 30), List.of(), null, null, null));
        // 프론트 getBaseCounts('openbanking', '2026-07-01', '2026-09-30') 결과
        assertThat(res.items().stream().map(CalculationResponse.Item::baseCount))
                .containsExactly(5156170L, 5408290L, 4823200L, 4413980L, 4068090L, 2862850L, 3023350L, 2051200L);

        CalculationResponse partial = feeCalculationService.calculate(new CalculationRequest("fininfo",
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 8, 15), List.of(), null, null, null));
        assertThat(partial.items().get(0).baseCount()).isEqualTo(398900L);
    }

    @Test
    void AI이슈를_차감하고_총액분담은_합계가_총액과_같다() {
        CalculationResponse res = feeCalculationService.calculate(new CalculationRequest("cd",
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 8, 15),
                List.of("농협 6월 12일 재처리분 800건 차감해 줘.", "기관 없는 문장 100건"), null, null, "admin"));
        CalculationResponse.Item nh = res.items().stream().filter(i -> i.institutionId().equals("nh")).findFirst().orElseThrow();
        assertThat(nh.deduction()).isEqualTo(800);
        assertThat(nh.finalCount()).isEqualTo(nh.baseCount() - 800);
        assertThat(res.issues()).extracting(CalculationResponse.Issue::applied).containsExactly(true, false);
        // 46일 ÷ 91일 환산 총액을 원 단위까지 정확히 나눈다
        assertThat(res.totalFee()).isEqualTo(Math.round(300_000_000L * 46 / 91.0));
        assertThat(res.totalFeeAmount()).isEqualTo(res.totalFee());
    }

    @Test
    void 업무권한이_없으면_산출할_수_없다() throws Exception {
        Map<String, Object> body = Map.of("businessId", "cms", "from", "2026-07-01", "to", "2026-09-30",
                "requestedBy", "hong");
        mvc.perform(post("/api/fee/calculations").contentType(MediaType.APPLICATION_JSON).content(json(body)))
                .andExpect(status().isForbidden());

        // 신청 → 관리자 승인 → 산출 가능
        mvc.perform(post("/api/users/hong/task-requests").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("businessCode", "cms", "reason", "테스트"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.status", is("승인 대기중")));
        mvc.perform(post("/api/task-requests/3/approve")).andExpect(status().isOk());
        mvc.perform(post("/api/fee/calculations").contentType(MediaType.APPLICATION_JSON).content(json(body)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.items", hasSize(8)));
    }

    @Test
    void 산출하면_대사내역이_생기고_송부하면_확인중이_된다() throws Exception {
        // 기동 시 시연 산출 1건(id=1)이 있다
        mvc.perform(get("/api/reconcile/records").param("calculationId", "1"))
                .andExpect(jsonPath("$.data", hasSize(8)))
                .andExpect(jsonPath("$.data[0].status", is("대기")));
        mvc.perform(post("/api/reconcile/calculations/1/send"))
                .andExpect(jsonPath("$.data[0].status", is("확인중")));
        mvc.perform(get("/api/reconcile/summary"))
                .andExpect(jsonPath("$.data.reconcile.checking", is(8)))
                .andExpect(jsonPath("$.data.tests.total", is(7)));
    }

    @Test
    void 실적_엑셀을_업로드하면_기관별_건수를_읽는다() throws Exception {
        byte[] xlsx;
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet s = wb.createSheet("실적");
            Object[][] rows = {{"기관명", "건수"}, {"신한은행", 1000}, {"B004", 2000}, {"신한", 500}, {"없는은행", 3}, {"합계", 3503}};
            for (int r = 0; r < rows.length; r++) {
                Row row = s.createRow(r);
                row.createCell(0).setCellValue(rows[r][0].toString());
                if (rows[r][1] instanceof Integer n) {
                    row.createCell(1).setCellValue(n);
                } else {
                    row.createCell(1).setCellValue(rows[r][1].toString());
                }
            }
            wb.write(out);
            xlsx = out.toByteArray();
        }
        mvc.perform(multipart("/api/fee/uploads").file(new MockMultipartFile("file", "실적.xlsx",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.counts", hasSize(2)))
                .andExpect(jsonPath("$.data.counts[0].baseCount", is(1500)))
                .andExpect(jsonPath("$.data.unmatched[0]", is("없는은행")));
    }

    @Test
    void 산출결과_엑셀을_내려받는다() throws Exception {
        mvc.perform(get("/api/fee/calculations/1/excel/reconcile"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION, org.hamcrest.Matchers.containsString("attachment")));
        mvc.perform(get("/api/fee/calculations/1/excel/revenue")).andExpect(status().isOk());
    }

    @Test
    void 프론트_개발서버_CORS를_허용한다() throws Exception {
        mvc.perform(options("/api/fee/businesses")
                        .header(HttpHeaders.ORIGIN, "http://localhost:5173")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:5173"));
        mvc.perform(options("/api/fee/businesses")
                        .header(HttpHeaders.ORIGIN, "http://evil.example.com")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                .andExpect(status().isForbidden());
    }

    @Test
    void Vercel_공개주소_CORS와_헬스체크() throws Exception {
        mvc.perform(options("/api/auth/login")
                        .header(HttpHeaders.ORIGIN, "https://vibe-coding-challenge-nine.vercel.app")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN,
                        "https://vibe-coding-challenge-nine.vercel.app"));
        mvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)));
    }
}
