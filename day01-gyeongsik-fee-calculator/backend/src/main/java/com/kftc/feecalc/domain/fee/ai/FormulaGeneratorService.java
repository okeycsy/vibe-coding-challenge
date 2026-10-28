package com.kftc.feecalc.domain.fee.ai;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;
import com.kftc.feecalc.domain.fee.dto.FormulaGenerateResponse;
import com.kftc.feecalc.domain.fee.dto.VariableInfo;
import com.kftc.feecalc.domain.fee.service.SkillEngineService;
import com.kftc.feecalc.domain.fee.service.SkillVariables;
import com.kftc.feecalc.domain.fee.service.SkillVariables.Bound;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * "## 1. 비즈니스 규칙 요약" 텍스트로 "## 3. 정산 수식"(변수 정의 + SpEL)을 만든다 (POST /api/v1/skills/{taskCode}/generate-formula).
 * 패턴 매칭 없이 연결된 AI 가 규칙을 읽고 필요한 변수(실적 입력·상수·파생값)를 스스로 정의한 뒤 그 변수로 수식을 쓴다.
 * AI 답은 저장과 같은 검사({@link SkillVariables#parse} + {@link SkillEngineService#validateFormula})를 통과해야 하고, 통과하지 못하면
 * 오류를 알려 주며 한 번 더 물은 뒤 그래도 안 되면 400 으로 초안과 원인을 돌려준다. AI 키가 없으면 400. 파일은 저장하지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FormulaGeneratorService {

    public static final int MAX_ATTEMPTS = 2;

    public static final String SYSTEM = """
            너는 금융결제원 회비 정산 수식 작성 AI야. [비즈니스 규칙 요약]을 읽고 (1) 계산에 필요한 변수를 스스로 정의하고 (2) 그 변수로 기관 한 곳의 \
            회비(원)를 계산하는 Spring SpEL 수식을 작성해. 정해진 패턴은 없다. 규칙에 적힌 계산 방식을 그대로 옮겨.
            [변수 정의] variables 는 줄마다 하나씩, 위에서 아래 순서로 정의한다 (뒤 줄은 앞 줄 변수만 쓸 수 있다). 이름은 영문 소문자로 시작하는 camelCase(한글 불가).
            - 이름 = input("설명"): 실적 엑셀에서 기관별로 읽어 올 건수. 규칙이 실적으로 인정하는 항목마다 하나씩 (예: 출금이체 성공 건, 입금이체 성공 건). \
            설명은 엑셀 열 이름과 맞추기 쉽게 한국어로, 제외한다고 적힌 항목(조회성 API 등)은 input 으로 만들지 마. 꼭 필요한 건수만 골라.
            - rawCount = 수식: 기준 실적(차감 대상). input 이 2개 이상이면 반드시 정의해 (보통 input 들의 합). input 이 1개면 자동으로 그 값이라 정의하지 않아도 된다.
            - 이름 = 숫자: 총액·단가·비율 같은 상수 (예: totalFee = 300000000, unitPrice = 12, equalRate = 0.3).
            - 이름 = 수식: 파생값. #변수 로 참조한다. 기관별 변수를 쓰면 기관별 값, 아니면 모든 기관에 같은 값.
            - 이름 = sum(#변수): 모든 기관의 그 변수 합계 (기관별 변수만).
            [예약 변수] 정의하지 말고 수식에서 그냥 써: #deductedCount AI 차감 건수, #finalCount = rawCount − deductedCount (최종 인정 건수), \
            #totalCount 전체 기관 finalCount 합계, #institutionCount 참가기관 수, #periodScale 기간 환산 비율(한 분기 = 1, 분기가 아니면 일수 ÷ 91). \
            #deductedCount·#finalCount·#totalCount 는 rawCount 줄 뒤에서만 쓸 수 있다.
            [수식 문법] 숫자, #변수, + - * / %, 괄호, 비교(< > <= >= == !=), and/or/!, 삼항(조건 ? 값 : 값). \
            메서드 호출, T(...) 타입 참조, new, 빈 참조(@), 문자열, 줄 끝 세미콜론은 쓸 수 없다. 정수끼리 나누면 소수점이 버려지므로 비율 계산은 \
            300000000.0 처럼 소수점을 붙이고, #totalCount·#institutionCount 로 나눌 때는 (#totalCount == 0 ? 0 : ...) 처럼 0 나누기를 막아. 결과는 항상 0 이상.
            분기 기준 총액·기본료는 #periodScale 을 곱해 기간을 환산해. 원 미만 처리·합계 맞춤·특정 기관 10원 절상 같은 끝전 처리는 엔진과 \
            "## 4. 최종 정산 특이사항" 후처리 단계가 하므로 수식에 넣지 마.
            균등 분담과 실적 비례 분담을 합치는 혼합형이면 균등분담분만 계산하는 수식을 equalFormula, 실적분담분만 계산하는 수식을 perfFormula 에 따로 적어 \
            (formula = equalFormula + perfFormula). 혼합형이 아니면 두 값은 null.
            반드시 다음 JSON 객체로만 답해: {"variables":[{"name":"withdrawCount","type":"input","description":"출금이체 성공 건수"},\
            {"name":"depositCount","type":"input","description":"입금이체 성공 건수"},{"name":"rawCount","type":"expr","expr":"#withdrawCount + #depositCount"},\
            {"name":"unitPrice","type":"number","value":20},{"name":"grandTotal","type":"sum","of":"finalCount"}],\
            "formula":"수식","equalFormula":"균등 수식 또는 null","perfFormula":"실적 수식 또는 null",\
            "pattern":"규칙에서 읽어 낸 산정 방식 한 줄","explanation":["규칙 항목 → 변수·수식 매핑 설명", "..."]}""";

    private final LlmClient llm;

    public FormulaGenerateResponse generate(String taskCode, String businessRulesText) {
        String rules = businessRulesText == null ? "" : businessRulesText.replace("\r\n", "\n").strip();
        if (rules.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "'## 1. 비즈니스 규칙 요약'에 규칙을 먼저 적어 주세요.");
        }
        if (!llm.enabled()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "AI 키(AI_API_KEY)가 없어 수식을 생성할 수 없습니다. "
                    + "백엔드(Render) Environment 에 AI_API_KEY 를 넣고 재배포한 뒤 다시 시도하거나, 변수와 수식을 직접 작성해 주세요.");
        }
        String user = "[비즈니스 규칙 요약]\n" + rules;
        String lastError = null;
        Draft lastDraft = null;
        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            JsonNode res;
            try {
                res = llm.chatJson(SYSTEM, attempt == 1 ? user : retryPrompt(user, lastDraft, lastError));
            } catch (LlmClient.LlmException e) {
                throw new BusinessException(ErrorCode.INVALID_INPUT, "AI 수식 생성에 실패했습니다: " + e.getMessage(), draftData(lastDraft, attempt, e.getMessage()));
            }
            Draft draft = Draft.from(res);
            try {
                Checked checked = check(draft);
                String note = attempt == 1 ? null : "1차 답변이 검증을 통과하지 못해 오류를 알려 주고 다시 받았습니다 (" + lastError + ")";
                return response(taskCode, draft, checked, attempt, llm.model(), note);
            } catch (BusinessException e) {
                lastError = e.getMessage();
                lastDraft = draft;
                log.warn("AI 수식 {}차 답변 검증 실패: {}", attempt, lastError);
            }
        }
        throw new BusinessException(ErrorCode.INVALID_FORMULA,
                "AI 가 만든 수식이 " + MAX_ATTEMPTS + "번 모두 검증을 통과하지 못했습니다: " + lastError
                        + " 초안을 빌더에서 고치거나 1번 규칙을 더 구체적으로 적은 뒤 다시 생성해 주세요.",
                draftData(lastDraft, MAX_ATTEMPTS, lastError));
    }

    /** AI 가 돌려준 초안 (검증 전). variables 는 블록 텍스트로 합친 것 */
    public record Draft(String variables, String formula, String equalFormula, String perfFormula, String pattern, List<String> explanation) {

        static Draft from(JsonNode res) {
            String formula = res.path("formula").asText("").strip();
            String equal = optional(res, "equalFormula");
            String perf = optional(res, "perfFormula");
            if (equal == null || perf == null) {
                equal = null;
                perf = null;
            }
            List<String> steps = new ArrayList<>();
            res.path("explanation").forEach(s -> steps.add(s.asText()));
            if (steps.isEmpty() && res.path("explanation").isTextual()) {
                steps.add(res.path("explanation").asText());
            }
            return new Draft(variablesText(res.path("variables")), formula, equal, perf, res.path("pattern").asText("AI 해석"), steps);
        }

        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("variables", variables);
            m.put("formula", formula);
            m.put("equalFormula", equalFormula);
            m.put("perfFormula", perfFormula);
            m.put("pattern", pattern);
            m.put("explanation", explanation);
            return m;
        }
    }

    /** AI 의 variables 는 객체 배열(권장) 또는 블록 텍스트 어느 쪽이든 받아 블록 텍스트로 만든다 */
    static String variablesText(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return "";
        }
        if (node.isTextual()) {
            return node.asText().replace("\r\n", "\n").strip();
        }
        List<String> lines = new ArrayList<>();
        for (JsonNode v : node) {
            String name = v.path("name").asText("").strip();
            String type = v.path("type").asText(v.path("kind").asText("")).strip().toLowerCase();
            if (name.isEmpty()) {
                continue;
            }
            if (type.equals("input")) {
                String label = v.path("description").asText(v.path("label").asText("")).strip().replace("\"", "'");
                lines.add(name + " = input(\"" + label + "\")");
            } else if (type.equals("sum")) {
                lines.add(name + " = sum(#" + v.path("of").asText(v.path("expr").asText("")).strip().replace("#", "") + ")");
            } else if (type.equals("number") || type.equals("const") || type.equals("constant")) {
                JsonNode value = v.has("value") ? v.path("value") : v.path("expr");
                lines.add(name + " = " + (value.isNumber() ? value.numberValue().toString() : value.asText("").strip()));
            } else {
                JsonNode expr = v.has("expr") ? v.path("expr") : v.has("value") ? v.path("value") : v.path("formula");
                lines.add(name + " = " + (expr.isNumber() ? expr.numberValue().toString() : expr.asText("").strip()));
            }
        }
        return String.join("\n", lines);
    }

    private static String optional(JsonNode res, String field) {
        JsonNode v = res.path(field);
        return v.isTextual() && !v.asText().isBlank() && !v.asText().strip().equalsIgnoreCase("null") ? v.asText().strip() : null;
    }

    private static String retryPrompt(String user, Draft draft, String error) {
        return user + "\n\n[이전 답변]\n" + "variables:\n" + draft.variables() + "\nformula: " + draft.formula()
                + (draft.equalFormula() == null ? "" : "\nequalFormula: " + draft.equalFormula() + "\nperfFormula: " + draft.perfFormula())
                + "\n\n[검증 오류]\n" + error + "\n\n위 오류를 고쳐 같은 JSON 형식으로 다시 답해.";
    }

    private static Map<String, Object> draftData(Draft draft, int attempts, String error) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("draft", draft == null ? null : draft.toMap());
        data.put("attempts", attempts);
        data.put("error", error);
        return data;
    }

    private record Checked(SkillVariables variables, long sampleNormal, long sampleZero) {
    }

    /** 저장과 같은 검사: 변수 블록 파싱 → 수식 구문·미정의 변수·기관 8곳 시험 계산 2벌. 통과하면 예시 결과(첫 기관) */
    private static Checked check(Draft draft) {
        if (draft.formula().isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_FORMULA, "답변에 formula 가 없습니다.");
        }
        SkillVariables vars = SkillVariables.parse(draft.variables().isEmpty() ? null : draft.variables());
        List<String> formulas = draft.equalFormula() != null ? List.of(draft.equalFormula(), draft.perfFormula()) : List.of(draft.formula());
        for (String f : formulas) {
            SkillEngineService.validateFormula(f, vars);
        }
        if (draft.equalFormula() != null) {
            SkillEngineService.validateFormula(draft.formula(), vars);
        }
        return new Checked(vars, sample(formulas, vars, false), sample(formulas, vars, true));
    }

    /** 기관 8곳 예시의 첫 기관 회비(원, 반올림). 분리형이면 균등 + 실적 */
    private static long sample(List<String> formulas, SkillVariables vars, boolean zero) {
        Bound b = vars.bind(vars.sampleRows(zero), zero ? SkillVariables.SAMPLE_SCALE_ZERO : SkillVariables.SAMPLE_SCALE_NORMAL);
        BigDecimal sum = BigDecimal.ZERO;
        for (String f : formulas) {
            sum = sum.add(SkillEngineService.evaluate(f, b.contexts().get(0)));
        }
        return sum.setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    private static FormulaGenerateResponse response(String taskCode, Draft d, Checked c, int attempts, String model, String note) {
        return new FormulaGenerateResponse(taskCode, d.variables(), VariableInfo.list(c.variables()), VariableInfo.inputs(c.variables()),
                d.formula(), d.equalFormula(), d.perfFormula(), d.pattern(), d.explanation(), true,
                "변수 정의·수식 구문 검사와 기관 8곳 시험 계산 2벌(정상·실적 0)을 통과했습니다.", c.sampleNormal(), c.sampleZero(),
                "AI", model, note, attempts);
    }
}
