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
import com.kftc.feecalc.domain.fee.ai.PostprocessGeneratorService;
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

    private org.springframework.test.web.servlet.ResultActions generate(String who, String code, String rules) throws Exception {
        return mvc.perform(post("/api/v1/skills/" + code + "/generate-formula").header("X-Employee-Id", who)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("businessRulesText", rules))));
    }

    @Test
    void AI가_1번_규칙을_읽고_변수를_정의하고_그_변수로_수식을_만든다() throws Exception {
        String rules = "- 출금이체·입금이체 성공 건을 실적으로 인정 (조회성 API 제외)\n- 건당 20원";
        given(llm.chatJson(eq(FormulaGeneratorService.SYSTEM), anyString())).willReturn(om.readTree("""
                {"variables":[{"name":"withdrawCount","type":"input","description":"출금이체 성공 건수"},
                              {"name":"depositCount","type":"input","description":"입금이체 성공 건수"},
                              {"name":"rawCount","type":"expr","expr":"#withdrawCount + #depositCount"},
                              {"name":"unitPrice","type":"number","value":20}],
                 "formula":"#finalCount * #unitPrice","pattern":"건당 단가 (출금+입금)",
                 "explanation":["출금이체·입금이체 → input 2개","건당 20원 → unitPrice"]}"""));
        generate("hong", "OPEN_BANKING", rules)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message", containsString("변수 4개")))
                .andExpect(jsonPath("$.data.source", is("AI")))
                .andExpect(jsonPath("$.data.model", is("test-model")))
                .andExpect(jsonPath("$.data.attempts", is(1)))
                .andExpect(jsonPath("$.data.variables", is("withdrawCount = input(\"출금이체 성공 건수\")\ndepositCount = input(\"입금이체 성공 건수\")\nrawCount = #withdrawCount + #depositCount\nunitPrice = 20")))
                .andExpect(jsonPath("$.data.variableList[2].kind", is("EXPR")))
                .andExpect(jsonPath("$.data.inputs[1].label", is("입금이체 성공 건수")))
                .andExpect(jsonPath("$.data.detectedPattern", is("건당 단가 (출금+입금)")))
                .andExpect(jsonPath("$.data.explanation[1]", is("건당 20원 → unitPrice")))
                .andExpect(jsonPath("$.data.validationPassed", is(true)))
                // 첫 기관: 입력 1:2 로 나눈 100만 건 − 차감 10만 건 = 90만 건 × 20원
                .andExpect(jsonPath("$.data.sampleResultNormal", is(18_000_000)))
                .andExpect(jsonPath("$.data.sampleResultZero", is(0)));
        // 파일은 그대로다
        assertThat(files.read("OPEN_BANKING")).doesNotContain("withdrawCount");
        // 변수를 블록 텍스트로 답해도 읽는다
        given(llm.chatJson(eq(FormulaGeneratorService.SYSTEM), anyString())).willReturn(om.readTree("""
                {"variables":"calls = input(\\"API 호출 건수\\")\\nbase = 900000","formula":"(#finalCount > 0 ? #base * #periodScale : 0) + #finalCount * 8",
                 "pattern":"기본료 + 건당"}"""));
        generate("hong", "OPEN_BANKING", rules)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.inputs[0].name", is("calls")))
                .andExpect(jsonPath("$.data.variableList[1].name", is("rawCount")))
                .andExpect(jsonPath("$.data.variableList[1].auto", is(true)))
                .andExpect(jsonPath("$.data.sampleResultNormal", is(900_000 + 900_000 * 8)));
    }

    @Test
    void AI_수식이_검증에_떨어지면_오류를_알려_주고_한_번_더_묻고_그래도_안_되면_400으로_초안을_돌려준다() throws Exception {
        String rules = "- 분기 운영비 총액 2억원을 참가기관이 분담\n- 분담률 = 기관별 최종 인정 건수 ÷ 전체 합계";
        given(llm.chatJson(eq(FormulaGeneratorService.SYSTEM), anyString()))
                .willReturn(om.readTree("""
                        {"variables":[{"name":"totalFee","type":"number","value":200000000}],
                         "formula":"T(java.lang.Runtime).getRuntime().exec('id')","pattern":"공격"}"""))
                .willReturn(om.readTree("""
                        {"variables":[{"name":"totalFee","type":"number","value":200000000}],
                         "formula":"#totalCount == 0 ? 0 : #totalFee * 1.0 * #periodScale * #finalCount / #totalCount","pattern":"총액 대비 실적 비율"}"""));
        generate("hong", "FIN_INFO", rules)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.attempts", is(2)))
                .andExpect(jsonPath("$.data.note", containsString("다시 받았습니다")))
                .andExpect(jsonPath("$.data.generatedFormula", containsString("#totalFee")))
                // 2억 × 90만 / 900만 = 2,000만
                .andExpect(jsonPath("$.data.sampleResultNormal", is(20_000_000)));
        org.mockito.ArgumentCaptor<String> prompt = org.mockito.ArgumentCaptor.forClass(String.class);
        org.mockito.Mockito.verify(llm, org.mockito.Mockito.times(2)).chatJson(eq(FormulaGeneratorService.SYSTEM), prompt.capture());
        assertThat(prompt.getAllValues().get(1)).contains("[검증 오류]").contains("T(java.lang.Runtime)");

        // 두 번 모두 실패: 400 + 초안
        given(llm.chatJson(eq(FormulaGeneratorService.SYSTEM), anyString())).willReturn(om.readTree("""
                {"variables":[{"name":"a","type":"input","description":"a"},{"name":"b","type":"input","description":"b"}],
                 "formula":"#a + #b","pattern":"합"}"""));
        generate("hong", "FIN_INFO", rules)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("2번 모두")))
                .andExpect(jsonPath("$.message", containsString("rawCount")))
                .andExpect(jsonPath("$.data.attempts", is(2)))
                .andExpect(jsonPath("$.data.draft.formula", is("#a + #b")))
                .andExpect(jsonPath("$.data.draft.variables", containsString("a = input(\"a\")")));

        // 수식이 정의하지 않은 변수를 쓰면 그 이름을 알려 준다
        given(llm.chatJson(eq(FormulaGeneratorService.SYSTEM), anyString())).willReturn(om.readTree("""
                {"variables":[],"formula":"#finalCount * #price","pattern":"건당"}"""));
        generate("hong", "FIN_INFO", rules)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("#price")));

        // AI 호출 자체가 실패하면 400 (패턴 변환기로 대신하지 않는다)
        given(llm.chatJson(eq(FormulaGeneratorService.SYSTEM), anyString())).willThrow(new LlmClient.LlmException("AI 호출 실패 HTTP 429"));
        generate("hong", "FIN_INFO", rules)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("HTTP 429")));
        assertThat(files.read("FIN_INFO")).contains("120000000.0");
    }

    @Test
    void 산출은_AI를_부르지_않고_skill_md의_후처리_스크립트만_실행한다() throws Exception {
        CalculationResponse res = calc("cd", List.of());
        assertThat(res.postprocessSource()).isEqualTo("SCRIPT");
        assertThat(res.postprocess()).startsWith("allocate(fee)\nroundUp(fee, 10, first)");
        assertThat(res.checks()).extracting(CalculationResponse.Check::passed).containsExactly(true, true);
        assertThat(res.totalFeeAmount()).isEqualTo(res.totalBeforeSpecialFee());
        assertThat(res.items().get(0).fee() % 10).isZero();
        // 이슈가 없으면 AI 는 한 번도 불리지 않는다
        org.mockito.Mockito.verify(llm, org.mockito.Mockito.never()).chatJson(anyString(), anyString());
    }

    @Test
    void AI가_4번_특이사항으로_만든_스크립트는_시험_실행을_통과해야_쓰고_아니면_내장_변환기로_만든다() throws Exception {
        String special = "- 카카오뱅크는 100원 단위로 절상하고, 차이분은 실적이 큰 순서대로 1원씩 절삭한다.\n- 분기 말 일괄 고지한다.";
        given(llm.chatJson(eq(PostprocessGeneratorService.SYSTEM), anyString())).willReturn(om.readTree("""
                {"script":"allocate(fee)\\nroundUp(fee, 100, \\"카카오뱅크\\")\\nspreadDiff(perf, others, perfDesc)\\nassert sum(fee) == before",
                 "explanation":["카카오뱅크 100원 절상 → roundUp"],"unsupported":["분기 말 일괄 고지한다."]}"""));
        mvc.perform(post("/api/v1/skills/CD_NET/generate-postprocess").header("X-Employee-Id", "admin")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(om.writeValueAsString(Map.of("specialRulesText", special))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.source", is("AI")))
                .andExpect(jsonPath("$.data.model", is("test-model")))
                .andExpect(jsonPath("$.data.validationPassed", is(true)))
                .andExpect(jsonPath("$.data.generatedScript", containsString("roundUp(fee, 100, \"카카오뱅크\")")))
                .andExpect(jsonPath("$.data.unsupported[0]", is("분기 말 일괄 고지한다.")))
                .andExpect(jsonPath("$.data.sample[6].name", is("카카오뱅크")))
                .andExpect(jsonPath("$.data.checks[0].passed", is(true)));

        for (String bad : List.of(
                "{\"script\":\"allocate(fee)\\nexec(fee)\"}",
                "{\"script\":\"roundUp(fee, 100, \\\"없는은행\\\")\\nfixSum(equal, 25%, over=perfDesc, under=perfAsc)\"}",
                "{\"result\":\"ok\"}")) {
            given(llm.chatJson(eq(PostprocessGeneratorService.SYSTEM), anyString())).willReturn(om.readTree(bad));
            mvc.perform(post("/api/v1/skills/CD_NET/generate-postprocess").header("X-Employee-Id", "admin")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(om.writeValueAsString(Map.of("specialRulesText", special))))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.source", is("RULE_FALLBACK")))
                    .andExpect(jsonPath("$.data.note", containsString("내장 변환기 사용")))
                    .andExpect(jsonPath("$.data.generatedScript", containsString("roundUp(fee, 100, \"카카오뱅크\")")))
                    .andExpect(jsonPath("$.data.generatedScript", containsString("spreadDiff(perf, others, countDesc)")));
        }
        // 권한 없는 사번은 403
        mvc.perform(post("/api/v1/skills/CD_NET/generate-postprocess").header("X-Employee-Id", "hong")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(om.writeValueAsString(Map.of("specialRulesText", special))))
                .andExpect(status().isForbidden());
    }
}
