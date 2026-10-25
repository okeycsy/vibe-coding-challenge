package com.kftc.feecalc.domain.fee.ai;

import java.util.ArrayList;
import java.util.List;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;
import com.kftc.feecalc.domain.fee.dto.CalculationResponse;
import com.kftc.feecalc.domain.fee.dto.PostprocessGenerateResponse;
import com.kftc.feecalc.domain.fee.dto.PostprocessGenerateResponse.SampleItem;
import com.kftc.feecalc.domain.fee.entity.Institution;
import com.kftc.feecalc.domain.fee.repository.InstitutionRepository;
import com.kftc.feecalc.domain.fee.service.PostprocessEngine;
import com.kftc.feecalc.domain.fee.service.PostprocessScript;
import com.kftc.feecalc.domain.fee.service.SpecialRuleConverter;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * "## 4. 최종 정산 특이사항" 자연어로 후처리 스크립트를 만든다 (POST /api/v1/skills/{taskCode}/generate-postprocess).
 * AI 키가 있으면 LLM 에 먼저 맡기고, AI 스크립트도 저장과 같은 검사(문법 + 시험 실행 2벌, {@link PostprocessEngine#trial})를
 * 통과해야 쓴다. 키가 없거나 AI 가 실패·검사 탈락하면 {@link SpecialRuleConverter}(내장 변환기)로 만든다. 파일은 저장하지 않는다.
 * 산출 때는 이 서비스를 부르지 않는다: 확정된 스크립트만 실행한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PostprocessGeneratorService {

    public static final String SYSTEM = """
            너는 금융결제원 회비 정산 시스템의 후처리 스크립트 작성 AI야. [최종 정산 특이사항] 문장을 읽고 아래 문법의 스크립트로만 바꿔. 금액을 직접 계산하지 마.
            스크립트는 한 줄에 한 단계이고 위에서 아래로 실행된다. 시작 값은 기관별 균등분담분(equal)·실적분담분(perf)의 원 미만 포함 원시값이고, fee = equal + perf 다.
            쓸 수 있는 줄:
            - allocate(fee|equal|perf): 원 단위 배분(최대잔여법, 합계 유지). 정수화 문장이 없으면 첫 줄에 allocate(fee)
            - roundHalf(comp[, unit][, 대상...][, addTo=equal|perf]) / roundUp(...) / roundDown(...): 반올림·절상·절사. comp 는 fee|equal|perf, unit 생략 = 1원. fee 를 반올림하면 차이는 addTo(기본 perf)에 넣는다
            - fixSum(comp, 금액|N%, over=정렬, under=정렬): comp 합계를 목표(원 또는 총액의 N%)에 맞춰 초과면 over 순서로 1원씩 감액, 미달이면 under 순서로 1원씩 증액. 정수화 뒤에만 쓸 수 있다
            - spreadDiff(comp[, 대상][, 정렬][, step=N]): 바로 앞 단계들이 늘리거나 줄인 금액을 대상 기관의 comp 에서 되돌려 합계를 유지 (기본 others, perfDesc, 1원씩)
            - min(comp, 금액[, 대상...]) / max(comp, 금액[, 대상...]) / add(comp, 금액|N%[, 대상...]) / set(comp, 금액[, 대상...]): 최저·최고·가감·고정
            - assert sum(comp) == 금액|N%|before / assert fee("기관명") % N == 0 / assert all(fee >= 0) / assert integer: 검증(실패해도 산출은 되고 화면에 표시)
            대상: all, first(첫 번째 기관), last, others(직전 단계 대상의 나머지), "기관명"(여러 개 가능, [기관 목록]의 이름 그대로).
            정렬: perfDesc|perfAsc(실적분담분), countDesc|countAsc(인정 건수), feeDesc|feeAsc, equalDesc|equalAsc, codeAsc. 동률은 기관코드 오름차순.
            규칙:
            - "소수점 반올림"은 roundHalf(equal) 과 roundHalf(perf). "균등분담 합계를 총액의 25%에 맞춘다"는 fixSum(equal, 25%, over=perfDesc, under=perfAsc).
            - "우체국은 10원 단위 절상, 증액분은 실적분담회비에 가산"은 roundUp(fee, 10, "우체국", addTo=perf), 그 뒤 "차이분은 다른 기관 실적분담회비에서 큰 순서로 1원씩 차감"은 spreadDiff(perf, others, perfDesc).
            - 최종 검증 문장은 assert 로 바꿔 (예: assert sum(equal) == 25%, assert fee("우체국") % 10 == 0, assert sum(fee) == before, assert all(fee >= 0)).
            - 위 문법으로 바꿀 수 없는 문장은 unsupported 에 원문 그대로 넣어. 50줄 이하.
            반드시 다음 JSON 객체로만 답해: {"script":"줄바꿈(\\n)으로 구분한 스크립트","explanation":["문장 → 단계 설명", "..."],"unsupported":["문장"...]}""";

    private final LlmClient llm;
    private final InstitutionRepository institutionRepository;

    public PostprocessGenerateResponse generate(String taskCode, String specialRulesText) {
        String rules = specialRulesText == null ? "" : specialRulesText.replace("\r\n", "\n").strip();
        if (rules.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "'## 4. 최종 정산 특이사항'에 문장을 먼저 적어 주세요.");
        }
        List<Institution> institutions = institutionRepository.findByActiveTrueOrderBySortOrder();
        String note = null;
        if (llm.enabled()) {
            try {
                StringBuilder user = new StringBuilder("[기관 목록] (산출 순서, 첫 줄이 첫 번째 기관)\n");
                for (Institution i : institutions) {
                    user.append("- ").append(i.getName()).append(" (기관코드 ").append(i.getBankCode()).append(")\n");
                }
                user.append("\n[최종 정산 특이사항]\n").append(rules);
                JsonNode res = llm.chatJson(SYSTEM, user.toString());
                String script = res.path("script").asText("").strip();
                if (script.isEmpty()) {
                    throw new LlmClient.LlmException("AI 응답에 스크립트가 없습니다.");
                }
                PostprocessEngine.trial(script);
                List<String> steps = new ArrayList<>();
                res.path("explanation").forEach(s -> steps.add(s.asText()));
                List<String> unsupported = new ArrayList<>();
                res.path("unsupported").forEach(u -> {
                    if (u.isTextual() && !u.asText().isBlank() && unsupported.size() < 20) {
                        unsupported.add(u.asText().strip());
                    }
                });
                return response(taskCode, script, steps, unsupported, "AI", llm.model(), null);
            } catch (LlmClient.LlmException e) {
                note = "AI 스크립트 생성 실패로 내장 변환기 사용 (" + e.getMessage() + ")";
            } catch (BusinessException e) {
                note = "AI 가 만든 스크립트가 문법 검사·시험 실행을 통과하지 못해 내장 변환기 사용 (" + e.getMessage() + ")";
            }
            log.warn(note);
        }
        SpecialRuleConverter.Converted c = SpecialRuleConverter.convert(rules, institutions.stream()
                .map(i -> new SpecialRuleConverter.Institution(i.getName(), i.getAliases())).toList());
        return response(taskCode, c.script(), c.steps(), c.unsupported(), note == null ? "RULE" : "RULE_FALLBACK", null, note);
    }

    /** 저장 검증과 같은 검사(문법 + 시험 실행)를 다시 돌려 결과를 응답에 담는다 */
    static PostprocessGenerateResponse response(String taskCode, String script, List<String> steps, List<String> unsupported,
                                                String source, String model, String note) {
        boolean passed = true;
        String message = "문법 검사와 시험 실행 2벌(정상·실적 0)을 통과했습니다.";
        List<SampleItem> sample = List.of();
        List<CalculationResponse.Check> checks = List.of();
        List<String> notes = List.of();
        try {
            PostprocessEngine.Result r = PostprocessEngine.trial(script);
            List<PostprocessEngine.Line> lines = PostprocessEngine.sampleLines();
            List<SampleItem> items = new ArrayList<>();
            for (int i = 0; i < lines.size(); i++) {
                items.add(SampleItem.of(lines.get(i), r.items().get(i)));
            }
            sample = items;
            CalculationResponse.PostprocessResult pr = CalculationResponse.PostprocessResult.from(r);
            checks = pr.checks();
            notes = pr.notes();
            if (!r.allPassed()) {
                message += " 단, 시험 데이터에서 검증(assert) " + r.checks().stream().filter(ch -> !ch.passed()).count()
                        + "건이 실패했습니다 (실제 기관 데이터로 산출해 확인해 주세요).";
            }
        } catch (BusinessException e) {
            passed = false;
            message = e.getMessage();
        }
        return new PostprocessGenerateResponse(taskCode, script, steps, unsupported, passed, message, sample, checks, notes,
                source, model, note);
    }

    /** 문법만 검사 (빌더가 손으로 고친 스크립트 확인용) */
    public static void check(String script) {
        PostprocessScript.parse(script);
    }
}
