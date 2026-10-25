package com.kftc.feecalc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.anyString;
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
import com.kftc.feecalc.domain.fee.ai.FormulaGeneratorService;
import com.kftc.feecalc.domain.fee.ai.LlmClient;
import com.kftc.feecalc.domain.fee.ai.SpecialRuleInterpreter;
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
    void AI가_돌려준_차감_판별을_반영하고_금액은_AI가_아니라_4번_특이사항_규칙으로만_정한다() throws Exception {
        given(llm.chatJson(eq(AiFeePostProcessor.ISSUE_SYSTEM), anyString())).willReturn(om.readTree("""
                {"results":[{"index":0,"deduct":false,"reason":"기관 자체 ATM 장애는 정상 거래"}]}"""));
        CalculationResponse res = calc("cms", List.of("신한 재의뢰 500건"));

        assertThat(res.aiMode()).isEqualTo("AI");
        assertThat(res.aiModel()).isEqualTo("test-model");
        assertThat(res.issues().get(0).applied()).isFalse();
        assertThat(res.issues().get(0).judgement()).isEqualTo("AI 판별(차감 제외): 기관 자체 ATM 장애는 정상 거래");
        assertThat(res.items().get(0).deduction()).isZero();
        // CMS 는 4번 특이사항이 없어 보정 없음
        assertThat(res.items()).allSatisfy(i -> {
            assertThat(i.fee()).isEqualTo(i.beforeSpecialFee());
            assertThat(i.specialRuleApplied()).isFalse();
        });
        // AI 는 이슈 판별에만 한 번 불린다
        org.mockito.Mockito.verify(llm, org.mockito.Mockito.times(1)).chatJson(anyString(), anyString());
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
    void AI가_만든_수식도_구문검사와_시험계산을_거치고_통과하지_못하면_내장_변환기로_만든다() throws Exception {
        String rules = "- 분기 운영비 총액 2억원을 참가기관이 분담\n- 분담률 = 기관별 최종 인정 건수 ÷ 전체 합계";
        given(llm.chatJson(eq(FormulaGeneratorService.SYSTEM), anyString())).willReturn(om.readTree("""
                {"formula":"#totalCount == 0 ? 0 : 200000000.0 * #periodScale * #finalCount / #totalCount",
                 "pattern":"총액 대비 단순 실적 비율","explanation":["총액 2억원 → 200000000.0","분담률 → #finalCount / #totalCount"]}"""));
        mvc.perform(post("/api/v1/skills/FIN_INFO/generate-formula").header("X-Employee-Id", "hong")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(om.writeValueAsString(Map.of("businessRulesText", rules))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.source", is("AI")))
                .andExpect(jsonPath("$.data.model", is("test-model")))
                .andExpect(jsonPath("$.data.detectedPattern", is("총액 대비 단순 실적 비율")))
                .andExpect(jsonPath("$.data.explanation[1]", is("분담률 → #finalCount / #totalCount")))
                .andExpect(jsonPath("$.data.validationPassed", is(true)));

        given(llm.chatJson(eq(FormulaGeneratorService.SYSTEM), anyString())).willReturn(om.readTree("""
                {"formula":"T(java.lang.Runtime).getRuntime().exec('id')","pattern":"공격"}"""));
        mvc.perform(post("/api/v1/skills/FIN_INFO/generate-formula").header("X-Employee-Id", "hong")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(om.writeValueAsString(Map.of("businessRulesText", rules))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.source", is("RULE_FALLBACK")))
                .andExpect(jsonPath("$.data.note", containsString("구문 검사·시험 계산을 통과하지 못해")))
                .andExpect(jsonPath("$.data.generatedFormula", containsString("200000000.0")));
    }

    @Test
    void AI가_4번_특이사항을_보정_동작으로_해석하면_금액은_그_동작대로_코드가_계산한다() throws Exception {
        given(llm.chatJson(eq(SpecialRuleInterpreter.SYSTEM), anyString())).willReturn(om.readTree("""
                {"actions":[{"type":"ROUND","unit":100,"rounding":"UP","target":"NAMED","institutions":["카카오뱅크"],
                             "redistribute":"PERF_DESC","rule":"카카오뱅크는 100원 단위 절상, 차이분은 실적 큰 순 1원씩 절삭"}],
                 "unsupported":["분기 말 일괄 고지한다."]}"""));
        CalculationResponse res = calc("cd", List.of());

        assertThat(res.specialRuleMode()).isEqualTo("AI");
        assertThat(res.specialRuleModel()).isEqualTo("test-model");
        assertThat(res.specialActions()).singleElement().satisfies(a -> {
            assertThat(a.type()).isEqualTo("ROUND");
            assertThat(a.target()).isEqualTo("NAMED");
            assertThat(a.description()).isEqualTo("카카오뱅크 100원 단위 절상 → 차이분은 나머지 기관에 실적 큰 순 1원씩 되돌림");
        });
        assertThat(res.specialUnsupported()).containsExactly("분기 말 일괄 고지한다.");
        CalculationResponse.Item kakao = res.items().stream().filter(i -> i.institutionId().equals("kakao")).findFirst().orElseThrow();
        assertThat(kakao.fee() % 100).isZero();
        assertThat(kakao.specialReason()).startsWith("특이사항 반영: 100원 단위 절상 (+");
        // 차이분을 되돌려 합계 유지, 첫 번째 기관(신한)은 지정 대상이 아님
        assertThat(res.totalFeeAmount()).isEqualTo(res.totalBeforeSpecialFee());
        assertThat(res.items().get(0).specialReason()).doesNotContain("단위 절상");

        // 같은 문장·기관 목록은 다시 묻지 않아 같은 금액이 나온다
        CalculationResponse again = calc("cd", List.of());
        assertThat(again.items()).extracting(CalculationResponse.Item::fee)
                .containsExactlyElementsOf(res.items().stream().map(CalculationResponse.Item::fee).toList());
        org.mockito.Mockito.verify(llm, org.mockito.Mockito.times(1)).chatJson(eq(SpecialRuleInterpreter.SYSTEM), anyString());
    }

    @Test
    void AI_해석이_허용_목록을_벗어나면_규칙_기반_해석으로_같은_구조를_만든다() throws Exception {
        CalculationResponse rule = calculationService.calculate(new CalculationRequest("cd",
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 9, 30), List.of(), null, null, "admin"), false);
        assertThat(rule.specialRuleMode()).isEqualTo("RULE");

        for (String bad : List.of(
                "{\"actions\":[{\"type\":\"ROUND\",\"unit\":10,\"rounding\":\"UP\",\"target\":\"NAMED\",\"institutions\":[\"없는은행\"]}]}",
                "{\"actions\":[{\"type\":\"SET_FEE\",\"amount\":1}]}",
                "{\"actions\":[{\"type\":\"ROUND\",\"unit\":\"10원\",\"rounding\":\"UP\"}]}",
                "{\"actions\":[{\"type\":\"MIN_FEE\",\"amount\":100,\"redistribute\":\"PERF_DESC\"}]}",
                "{\"result\":\"ok\"}")) {
            given(llm.chatJson(eq(SpecialRuleInterpreter.SYSTEM), anyString())).willReturn(om.readTree(bad));
            CalculationResponse res = calc("cd", List.of());
            assertThat(res.specialRuleMode()).as(bad).isEqualTo("RULE_FALLBACK");
            assertThat(res.specialRuleNote()).contains("규칙 기반 해석");
            assertThat(res.specialActions()).singleElement().satisfies(a -> {
                assertThat(a.target()).isEqualTo("FIRST");
                assertThat(a.redistribute()).isEqualTo("PERF_DESC");
            });
            assertThat(res.items()).extracting(CalculationResponse.Item::fee)
                    .containsExactlyElementsOf(rule.items().stream().map(CalculationResponse.Item::fee).toList());
        }
    }
}
