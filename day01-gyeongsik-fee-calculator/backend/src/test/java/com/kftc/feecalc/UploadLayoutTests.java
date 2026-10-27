package com.kftc.feecalc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.ByteArrayOutputStream;
import java.time.LocalDate;

import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kftc.feecalc.domain.fee.ai.LlmClient;
import com.kftc.feecalc.domain.fee.upload.UploadDate;

/** 자유 형식 실적 엑셀: 구조 판별(AI·규칙 기반), 날짜(년월 이상) 읽기, 산출 기간 밖 행 제외 (모두 가짜 데이터) */
@SpringBootTest(properties = "app.skills.dir=${java.io.tmpdir}/feecalc-skills-${random.uuid}")
@AutoConfigureMockMvc
// AI 판별 기억(서버 메모리)이 다른 테스트에 남지 않도록
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class UploadLayoutTests {

    static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper om;

    @MockBean
    LlmClient llm;

    @Test
    void 날짜는_년월_이상이면_여러_형식을_읽는다() {
        assertThat(UploadDate.parse("2026-07").key()).isEqualTo("2026-07");
        assertThat(UploadDate.parse("2026.7").key()).isEqualTo("2026-07");
        assertThat(UploadDate.parse("2026년 7월").key()).isEqualTo("2026-07");
        assertThat(UploadDate.parse(202607.0).key()).isEqualTo("2026-07");
        assertThat(UploadDate.parse("2026-07-15 00:00:00").key()).isEqualTo("2026-07-15");
        assertThat(UploadDate.parse("2026년 7월 15일").unit()).isEqualTo(UploadDate.Unit.DAY);
        assertThat(UploadDate.parse(LocalDate.of(2026, 8, 31)).key()).isEqualTo("2026-08-31");
        assertThat(UploadDate.parse("2026 Q3").key()).isEqualTo("2026년 3분기");
        assertThat(UploadDate.parse("2026")).isNull();
        assertThat(UploadDate.parse("2026-13")).isNull();
        assertThat(UploadDate.parse("2026-02-30")).isNull();
        assertThat(UploadDate.find("2026년 3분기 실적 (예시)").key()).isEqualTo("2026년 3분기");
        // 월 단위는 기간과 겹치는 달을 넣는다
        assertThat(UploadDate.parse("2026-07").overlaps(LocalDate.of(2026, 7, 15), LocalDate.of(2026, 9, 30))).isTrue();
        assertThat(UploadDate.parse("2026-06").overlaps(LocalDate.of(2026, 7, 1), LocalDate.of(2026, 9, 30))).isFalse();
    }

    /** 오픈뱅킹 API 처리건수 형식: 기준월 | 기관명 | API 종류별 건수 5열, 월별 행 */
    private byte[] apiStyle() throws Exception {
        String[] months = {"2026-06", "2026-07", "2026-08", "2026-09", "2026-10"};
        Object[][] header = {{"기준월", "기관명", "거래내역조회", "계좌실명조회", "잔액조회", "출금이체", "입금이체"}};
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet s = wb.createSheet("월별_API_원본");
            write(s.createRow(0), header[0]);
            int r = 1;
            for (String m : months) {
                write(s.createRow(r++), new Object[] {m, "신한은행", 100, 10, 1, 0, 0});
                write(s.createRow(r++), new Object[] {m, "KB국민은행", 200, 20, 2, 0, 0});
                write(s.createRow(r++), new Object[] {m, "가짜페이", 5, 5, 5, 5, 5});
            }
            write(s.createRow(r), new Object[] {"미정", "신한은행", 999, 0, 0, 0, 0});
            wb.write(out);
            return out.toByteArray();
        }
    }

    private void write(Row row, Object[] values) {
        for (int c = 0; c < values.length; c++) {
            if (values[c] instanceof Integer n) {
                row.createCell(c).setCellValue(n);
            } else {
                row.createCell(c).setCellValue(values[c].toString());
            }
        }
    }

    private ResultActions upload(byte[] xlsx, String from, String to) throws Exception {
        return mvc.perform(multipart("/api/fee/uploads").file(new MockMultipartFile("file", "api.xlsx", XLSX, xlsx))
                .param("from", from).param("to", to));
    }

    @Test
    void 규칙_기반으로_날짜_기관_수치열을_찾고_기간_밖_행은_뺀다() throws Exception {
        given(llm.enabled()).willReturn(false);
        upload(apiStyle(), "2026-07-01", "2026-09-30")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.analysis.mode", is("RULE")))
                .andExpect(jsonPath("$.data.layout.dateSource", is("COLUMN")))
                .andExpect(jsonPath("$.data.layout.dateHeader", is("기준월")))
                .andExpect(jsonPath("$.data.layout.institutionHeader", is("기관명")))
                .andExpect(jsonPath("$.data.layout.dateUnit", is("MONTH")))
                .andExpect(jsonPath("$.data.columns", hasSize(5)))
                .andExpect(jsonPath("$.data.columns[4].use", is(true)))
                // 7~9월 3개월, 열 5개 합: 신한 (100+10+1)*3
                .andExpect(jsonPath("$.data.counts", hasSize(2)))
                .andExpect(jsonPath("$.data.counts[0].institutionId", is("shinhan")))
                .andExpect(jsonPath("$.data.counts[0].baseCount", is(333)))
                .andExpect(jsonPath("$.data.values[0].values[0]", is(300)))
                .andExpect(jsonPath("$.data.rowCount", is(6)))
                .andExpect(jsonPath("$.data.includedDates", hasSize(3)))
                .andExpect(jsonPath("$.data.excluded", hasSize(2)))
                .andExpect(jsonPath("$.data.excluded[0].date", is("2026-06")))
                .andExpect(jsonPath("$.data.excluded[0].rows", is(3)))
                .andExpect(jsonPath("$.data.excluded[1].date", is("2026-10")))
                .andExpect(jsonPath("$.data.unreadableRows", is(1)))
                .andExpect(jsonPath("$.data.unreadableSamples[0]", is("미정")))
                .andExpect(jsonPath("$.data.unmatched", hasSize(1)))
                .andExpect(jsonPath("$.data.unmatched[0]", is("가짜페이")));
    }

    @Test
    void AI가_판별한_구조로_읽고_실적_열도_AI가_고른다() throws Exception {
        given(llm.enabled()).willReturn(true);
        given(llm.model()).willReturn("test-model");
        given(llm.chatJson(anyString(), anyString())).willReturn(om.readTree("""
                {"sheet":0,"headerRow":0,"institutionColumn":1,"codeColumn":-1,"dateSource":"COLUMN","dateColumn":0,
                 "valueColumns":[{"column":2,"kind":"COUNT","use":true},{"column":5,"kind":"COUNT","use":true},
                                 {"column":6,"kind":"COUNT","use":false}],
                 "reason":"기준월·기관명 열과 API 종류별 건수 열"}"""));
        upload(apiStyle(), "2026-07-01", "2026-09-30")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.analysis.mode", is("AI")))
                .andExpect(jsonPath("$.data.analysis.model", is("test-model")))
                .andExpect(jsonPath("$.data.analysis.reason", containsString("기준월")))
                .andExpect(jsonPath("$.data.columns", hasSize(3)))
                .andExpect(jsonPath("$.data.columns[0].header", is("거래내역조회")))
                .andExpect(jsonPath("$.data.columns[2].use", is(false)))
                .andExpect(jsonPath("$.data.counts[0].baseCount", is(300)))
                .andExpect(jsonPath("$.data.excluded", hasSize(2)));
    }

    @Test
    void AI_판별이_틀리거나_실패하면_규칙_기반으로_읽고_원인을_알려_준다() throws Exception {
        given(llm.enabled()).willReturn(true);
        // 날짜 열을 기관명 열로 잘못 짚은 답 → 검증 탈락
        given(llm.chatJson(anyString(), anyString())).willReturn(om.readTree("""
                {"sheet":0,"headerRow":0,"institutionColumn":1,"dateSource":"COLUMN","dateColumn":2,"valueColumns":[]}"""));
        upload(apiStyle(), "2026-07-01", "2026-09-30")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.analysis.mode", is("RULE_FALLBACK")))
                .andExpect(jsonPath("$.data.analysis.note", containsString("날짜 열")))
                .andExpect(jsonPath("$.data.counts[0].baseCount", is(333)));

        given(llm.chatJson(anyString(), anyString())).willThrow(new LlmClient.LlmException("AI 호출 실패 HTTP 401"));
        // 실패·검증 탈락한 판별은 기억하지 않아 같은 파일도 다시 AI 에 묻는다
        upload(apiStyle(), "2026-07-01", "2026-09-30")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.analysis.mode", is("RULE_FALLBACK")))
                .andExpect(jsonPath("$.data.analysis.note", containsString("HTTP 401")));
    }

    @Test
    void 가로형_표는_날짜_머리글로_읽고_금액열은_기본으로_빼고_날짜가_없으면_거부한다() throws Exception {
        given(llm.enabled()).willReturn(false);
        byte[] wide;
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet s = wb.createSheet("가로형");
            write(s.createRow(0), new Object[] {"금융회사", "2026년 6월", "2026년 7월", "2026년 8월"});
            write(s.createRow(1), new Object[] {"신한은행", 7, 10, 20});
            write(s.createRow(2), new Object[] {"합계", 7, 10, 20});
            wb.write(out);
            wide = out.toByteArray();
        }
        upload(wide, "2026-07-01", "2026-09-30")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.layout.dateSource", is("HEADER")))
                .andExpect(jsonPath("$.data.counts[0].baseCount", is(30)))
                .andExpect(jsonPath("$.data.excluded[0].date", is("2026-06")))
                .andExpect(jsonPath("$.data.excluded[0].values[0]", is(7)));

        // 날짜 서식 칸 + 금액 열: 건수 열이 있으면 금액 열은 실적에 넣지 않는다
        byte[] amounts;
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet s = wb.createSheet("일별");
            CellStyle date = wb.createCellStyle();
            date.setDataFormat(wb.getCreationHelper().createDataFormat().getFormat("yyyy-mm-dd"));
            write(s.createRow(0), new Object[] {"거래일", "참가기관", "처리건수", "수수료금액(원)"});
            Row row = s.createRow(1);
            row.createCell(0).setCellValue(LocalDate.of(2026, 9, 30));
            row.getCell(0).setCellStyle(date);
            row.createCell(1).setCellValue("KB국민은행");
            row.createCell(2).setCellValue(40);
            row.createCell(3).setCellValue(4000);
            row = s.createRow(2);
            row.createCell(0).setCellValue(LocalDate.of(2026, 10, 1));
            row.getCell(0).setCellStyle(date);
            row.createCell(1).setCellValue("KB국민은행");
            row.createCell(2).setCellValue(1);
            row.createCell(3).setCellValue(100);
            wb.write(out);
            amounts = out.toByteArray();
        }
        upload(amounts, "2026-07-01", "2026-09-30")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.layout.dateUnit", is("DAY")))
                .andExpect(jsonPath("$.data.columns[1].kind", is("AMOUNT")))
                .andExpect(jsonPath("$.data.columns[1].use", is(false)))
                .andExpect(jsonPath("$.data.counts[0].baseCount", is(40)))
                .andExpect(jsonPath("$.data.values[0].values[1]", is(4000)))
                .andExpect(jsonPath("$.data.excluded[0].date", is("2026-10-01")));

        byte[] noDate;
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet s = wb.createSheet("실적");
            write(s.createRow(0), new Object[] {"기관명", "건수"});
            write(s.createRow(1), new Object[] {"신한은행", 10});
            wb.write(out);
            noDate = out.toByteArray();
        }
        upload(noDate, "2026-07-01", "2026-09-30")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("날짜")));
    }
}
