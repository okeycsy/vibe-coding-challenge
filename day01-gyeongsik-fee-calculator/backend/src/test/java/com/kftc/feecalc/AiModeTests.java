package com.kftc.feecalc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kftc.feecalc.domain.fee.ai.AiFeePostProcessor;
import com.kftc.feecalc.domain.fee.ai.FormulaSyncService;
import com.kftc.feecalc.domain.fee.ai.LlmClient;
import com.kftc.feecalc.domain.fee.dto.CalculationRequest;
import com.kftc.feecalc.domain.fee.dto.CalculationResponse;
import com.kftc.feecalc.domain.fee.service.FeeCalculationService;
import com.kftc.feecalc.domain.fee.service.SkillFileService;

/** AI 키가 있을 때: 실제 호출 대신 LlmClient 를 바꿔 끼워 응답 반영·검증·실패 시 규칙 기반 전환을 확인한다 */
@SpringBootTest(properties = "app.skills.dir=${java.io.tmpdir}/feecalc-skills-${random.uuid}")
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class AiModeTests {

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper om;

    @Autowired
    FeeCalculationService calculationService;

    @Autowired
    SkillFileService files;

    @MockBean
    LlmClient llm;

    @BeforeEach
    void setUp() {
        given(llm.enabled()).willReturn(true);
        given(llm.model()).willReturn("test-model");
    }

    private CalculationResponse calc(String business, List<String> issues) {
        return calculationService.calculate(new CalculationRequest(business,
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 9, 30), issues, null, null, "admin"));
    }

    @Test
    void AI가_돌려준_차감_판별과_최종_회비를_반영하고_범위를_벗어난_값은_버린다() throws Exception {
        given(llm.chatJson(eq(AiFeePostProcessor.ISSUE_SYSTEM), anyString())).willReturn(om.readTree("""
                {"results":[{"index":0,"deduct":false,"reason":"기관 자체 ATM 장애는 정상 거래"}]}"""));
        CalculationResponse first = calc("cms", List.of("신한 재의뢰 500건"));
        long shinhanPrimary = first.items().get(0).primaryFee();
        long kbPrimary = first.items().get(1).primaryFee();

        given(llm.chatJson(eq(AiFeePostProcessor.FEE_SYSTEM), contains("1차 산출회비"))).willReturn(om.readTree("""
                {"items":[{"institutionId":"shinhan","finalFee":%d,"adjustReason":"규칙 반영: 10원 단위 절상 (+6원)"},
                          {"institutionId":"kb","finalFee":%d,"adjustReason":"엉뚱한 값"}]}"""
                .formatted(shinhanPrimary + 6, kbPrimary * 5)));
        CalculationResponse res = calc("cms", List.of("신한 재의뢰 500건"));

        assertThat(res.aiMode()).isEqualTo("AI");
        assertThat(res.aiModel()).isEqualTo("test-model");
        assertThat(res.issues().get(0).applied()).isFalse();
        assertThat(res.issues().get(0).judgement()).isEqualTo("AI 판별(차감 제외): 기관 자체 ATM 장애는 정상 거래");
        CalculationResponse.Item shinhan = res.items().get(0);
        assertThat(shinhan.deduction()).isZero();
        assertThat(shinhan.fee()).isEqualTo(shinhan.primaryFee() + 6);
        assertThat(shinhan.aiAdjustReason()).isEqualTo("규칙 반영: 10원 단위 절상 (+6원)");
        // 1차 금액의 5배는 허용 범위 밖 → 1차 금액 유지
        assertThat(res.items().get(1).fee()).isEqualTo(res.items().get(1).primaryFee());
        assertThat(res.items().get(1).aiAdjustReason()).isNull();
        assertThat(res.aiNote()).contains("허용 범위를 벗어난 1개 기관");
    }

    @Test
    void AI_호출이_실패하면_규칙_기반으로_이어서_산출한다() {
        given(llm.chatJson(anyString(), anyString())).willThrow(new LlmClient.LlmException("AI 호출에 실패했습니다 (Timeout)."));
        CalculationResponse res = calc("fininfo", List.of("농협 테스트 전문 1,000건"));
        assertThat(res.aiMode()).isEqualTo("RULE_FALLBACK");
        assertThat(res.aiNote()).contains("규칙 기반 적용");
        assertThat(res.issues().get(0).applied()).isTrue();
        CalculationResponse.Item nh = res.items().stream().filter(i -> i.institutionId().equals("nh")).findFirst().orElseThrow();
        assertThat(nh.fee() % 10).isZero();
        assertThat(res.totalFeeAmount()).isEqualTo(120_000_000L);
    }

    @Test
    void AI가_만든_수식도_구문검사와_시험계산을_거치고_통과하지_못하면_규칙_기반으로_만든다() throws Exception {
        String content = files.read("FIN_INFO").replace("총액 1억 2,000만원", "총액 2억원");
        given(llm.chatJson(eq(FormulaSyncService.SYSTEM), anyString())).willReturn(om.readTree("""
                {"formula":"#totalCount == 0 ? 0 : 200000000.0 * #periodScale * #finalCount / #totalCount","explanation":"총액 2억원 분담"}"""));
        mvc.perform(post("/api/v1/skills/sync-formula").header("X-Employee-Id", "hong").contentType(MediaType.APPLICATION_JSON)
                        .content(om.writeValueAsString(Map.of("taskCode", "FIN_INFO", "content", content))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.source", is("AI")))
                .andExpect(jsonPath("$.data.model", is("test-model")))
                .andExpect(jsonPath("$.data.explanation", is("총액 2억원 분담")));

        given(llm.chatJson(eq(FormulaSyncService.SYSTEM), anyString())).willReturn(om.readTree("""
                {"formula":"T(java.lang.Runtime).getRuntime().exec('id')","explanation":"공격"}"""));
        mvc.perform(post("/api/v1/skills/sync-formula").header("X-Employee-Id", "hong").contentType(MediaType.APPLICATION_JSON)
                        .content(om.writeValueAsString(Map.of("taskCode", "FIN_INFO", "content", content))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.source", is("RULE_FALLBACK")))
                .andExpect(jsonPath("$.data.note", containsString("구문 검사·시험 계산을 통과하지 못해")))
                .andExpect(jsonPath("$.data.formula", containsString("200000000.0")));
    }
}
