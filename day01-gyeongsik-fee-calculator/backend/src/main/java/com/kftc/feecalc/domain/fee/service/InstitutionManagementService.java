package com.kftc.feecalc.domain.fee.service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;
import com.kftc.feecalc.domain.fee.dto.InstitutionAdminResponse;
import com.kftc.feecalc.domain.fee.dto.InstitutionAdminResponse.Usage;
import com.kftc.feecalc.domain.fee.dto.InstitutionMatchResponse;
import com.kftc.feecalc.domain.fee.dto.InstitutionSaveRequest;
import com.kftc.feecalc.domain.fee.dto.ParsedIssue;
import com.kftc.feecalc.domain.fee.entity.Institution;
import com.kftc.feecalc.domain.fee.entity.InstitutionType;
import com.kftc.feecalc.domain.fee.repository.FeeCalculationRepository;
import com.kftc.feecalc.domain.fee.repository.InstitutionRepository;
import com.kftc.feecalc.domain.reconcile.repository.ReconcileRecordRepository;
import com.kftc.feecalc.domain.reconcile.repository.TestResultRepository;
import com.kftc.feecalc.domain.user.repository.MemberRepository;

import lombok.RequiredArgsConstructor;

/**
 * 기관 관리(시스템관리자): 조회·추가·수정·사용 중지/재사용·삭제·매칭 시험.
 * <p>
 * 엑셀 매칭({@link FeeExcelService#matchInstitution})과 AI 이슈 인식({@link AiIssueParser})은 요청마다 DB의 사용 중인 기관을
 * 읽으므로, 여기서 바꾼 내용이 다음 업로드·산출부터 바로 반영된다. 지난 산출 이력·대사 내역은 산출 당시 기관명·코드를 따로 저장해
 * 두어 이름을 바꾸거나 사용을 중지해도 그대로 남는다. 그래서 이력이 있는 기관은 삭제 대신 사용 중지만 허용한다.
 * <p>
 * 중복 검증 규칙은 프론트엔드 src/utils/institutions.js validateInstitution 과 같다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class InstitutionManagementService {

    private static final Pattern ID = Pattern.compile("[a-z][a-z0-9_-]{1,29}");
    private static final Pattern CODE = Pattern.compile("[A-Z0-9]{2,10}");
    private static final int MAX_ALIASES = 10;

    private final InstitutionRepository institutionRepository;
    private final FeeCalculationRepository calculationRepository;
    private final ReconcileRecordRepository reconcileRepository;
    private final TestResultRepository testResultRepository;
    private final MemberRepository memberRepository;
    private final SkillAccessControlService accessControl;
    private final AiIssueParser issueParser;

    public List<InstitutionAdminResponse> list(String employeeId) {
        accessControl.checkAdmin(employeeId);
        Map<String, Usage> usage = usage();
        return institutionRepository.findAllByOrderBySortOrder().stream()
                .map(i -> InstitutionAdminResponse.of(i, usage.getOrDefault(i.getCode(), Usage.NONE)))
                .toList();
    }

    @Transactional
    public InstitutionAdminResponse create(String employeeId, InstitutionSaveRequest req) {
        accessControl.checkAdmin(employeeId);
        List<Institution> all = institutionRepository.findAllByOrderBySortOrder();
        String code = normalizeCode(req.code());
        String id = req.id() == null || req.id().isBlank() ? code.toLowerCase(Locale.ROOT) : req.id().trim().toLowerCase(Locale.ROOT);
        if (!ID.matcher(id).matches()) {
            throw invalid("id", "내부 ID는 영문 소문자로 시작하고 소문자·숫자·_·- 2~30자로 입력해 주세요.");
        }
        Valid v = validate(all, null, id, req.name(), code, req.aliases());
        int order = all.stream().mapToInt(Institution::getSortOrder).max().orElse(0) + 1;
        Institution saved = institutionRepository.save(Institution.builder()
                .code(id).name(v.name()).bankCode(code).type(type(req.type(), v.name())).aliases(v.aliases())
                .volumeWeight(0).sortOrder(order).updatedBy(employeeId.trim()).updatedAt(LocalDateTime.now())
                .build());
        return InstitutionAdminResponse.of(saved, Usage.NONE);
    }

    @Transactional
    public InstitutionAdminResponse update(String employeeId, String id, InstitutionSaveRequest req) {
        accessControl.checkAdmin(employeeId);
        Institution inst = find(id);
        Valid v = validate(institutionRepository.findAllByOrderBySortOrder(), inst.getCode(), inst.getCode(),
                req.name(), normalizeCode(req.code()), req.aliases());
        String oldName = inst.getName();
        inst.update(v.name(), normalizeCode(req.code()), type(req.type(), v.name()), v.aliases(), employeeId.trim(),
                LocalDateTime.now());
        // 참가기관 담당자의 소속 표시(org)도 새 이름으로 맞춘다
        if (!oldName.equals(v.name())) {
            memberRepository.findAll().stream()
                    .filter(m -> inst.getCode().equals(m.getInstitutionCode()))
                    .forEach(m -> m.changeOrg(v.name()));
        }
        return InstitutionAdminResponse.of(inst, usage().getOrDefault(inst.getCode(), Usage.NONE));
    }

    @Transactional
    public InstitutionAdminResponse changeActive(String employeeId, String id, boolean active) {
        accessControl.checkAdmin(employeeId);
        Institution inst = find(id);
        inst.changeActive(active, employeeId.trim(), LocalDateTime.now());
        return InstitutionAdminResponse.of(inst, usage().getOrDefault(inst.getCode(), Usage.NONE));
    }

    /** 산출·대사·테스트 결과·회원 어디에도 쓰이지 않은 기관만 지운다 */
    @Transactional
    public Institution delete(String employeeId, String id) {
        accessControl.checkAdmin(employeeId);
        Institution inst = find(id);
        Usage u = usage().getOrDefault(inst.getCode(), Usage.NONE);
        if (!InstitutionAdminResponse.of(inst, u).deletable()) {
            throw new BusinessException(ErrorCode.INSTITUTION_IN_USE, String.format(
                    "%s은(는) 산출 이력 %d건·대사 %d건·테스트 결과 %d건·연결 회원 %d명이 있어 삭제할 수 없습니다. 사용 중지로 바꿔 주세요.",
                    inst.getName(), u.calculations(), u.reconciles(), u.tests(), u.members()));
        }
        institutionRepository.delete(inst);
        return inst;
    }

    /** 이 값이 지금 엑셀 업로드·AI 이슈 문장에서 어느 기관으로 잡히는지 (사용 중인 기관 기준) */
    public InstitutionMatchResponse match(String employeeId, String value) {
        accessControl.checkAdmin(employeeId);
        String v = value == null ? "" : value.trim();
        List<Institution> active = institutionRepository.findByActiveTrueOrderBySortOrder();
        InstitutionMatchResponse.Match excel = null;
        InstitutionMatchResponse.Match issue = null;
        if (!v.isEmpty()) {
            Institution e = FeeExcelService.matchInstitution(v, active);
            if (e != null) {
                excel = new InstitutionMatchResponse.Match(e.getCode(), e.getName(), e.getBankCode(),
                        matchedBy(e, v.replace(" ", "")));
            }
            ParsedIssue p = issueParser.parse(v, active);
            if (p.institutionId() != null) {
                Institution i = active.stream().filter(x -> x.getCode().equals(p.institutionId())).findFirst().orElseThrow();
                issue = new InstitutionMatchResponse.Match(i.getCode(), i.getName(), i.getBankCode(), p.matchedAlias());
            }
        }
        return new InstitutionMatchResponse(v, excel, issue);
    }

    // ---------- helpers ----------

    private record Valid(String name, List<String> aliases) {
    }

    /**
     * 중복 검증 (비활성 기관 포함, 다시 사용할 때 겹치지 않도록).
     * 엑셀 매칭이 기관코드·내부 ID를 대소문자 없이 같은 값으로 보고, 이름·별칭은 공백을 지우고 비교하므로 그 기준으로 겹침을 본다.
     */
    private Valid validate(List<Institution> all, String selfId, String id, String rawName, String code,
                           List<String> rawAliases) {
        String name = rawName == null ? "" : rawName.trim();
        if (name.isEmpty() || name.length() > 50) {
            throw invalid("name", "기관명을 1~50자로 입력해 주세요.");
        }
        if (name.chars().anyMatch(Character::isWhitespace)) {
            throw invalid("name", "기관명에는 공백을 넣을 수 없습니다. (엑셀 매칭은 공백을 지우고 비교합니다)");
        }
        if (!CODE.matcher(code).matches()) {
            throw invalid("code", "기관코드는 영문 대문자·숫자 2~10자로 입력해 주세요. (예: B088)");
        }
        Set<String> aliasSet = new LinkedHashSet<>();
        for (String a : rawAliases == null ? List.<String>of() : rawAliases) {
            String t = a == null ? "" : a.trim();
            if (t.isEmpty()) {
                continue;
            }
            if (t.length() > 30 || t.chars().anyMatch(Character::isWhitespace)) {
                throw invalid("aliases", "별칭은 공백 없이 30자 이하로 입력해 주세요: " + t);
            }
            if (t.equals(name)) {
                throw invalid("aliases", "기관명과 같은 별칭은 넣지 않아도 됩니다: " + t);
            }
            aliasSet.add(t);
        }
        if (aliasSet.size() > MAX_ALIASES) {
            throw invalid("aliases", "별칭은 " + MAX_ALIASES + "개까지 넣을 수 있습니다.");
        }

        for (Institution o : all) {
            if (o.getCode().equals(selfId)) {
                continue;
            }
            String label = o.getName() + "(" + o.getBankCode() + (o.isActive() ? "" : ", 사용 중지") + ")";
            Set<String> keys = new LinkedHashSet<>(List.of(o.getCode().toLowerCase(Locale.ROOT),
                    o.getBankCode().toLowerCase(Locale.ROOT)));
            if (keys.contains(code.toLowerCase(Locale.ROOT))) {
                throw duplicate("code", "기관코드 " + code + "는 " + label + "의 기관코드·ID와 겹칩니다.");
            }
            if (selfId == null && keys.contains(id)) {
                throw duplicate("id", "내부 ID " + id + "는 " + label + "의 ID·기관코드와 겹칩니다.");
            }
            Set<String> words = new LinkedHashSet<>();
            words.add(o.getName());
            words.addAll(o.getAliases());
            if (words.contains(name)) {
                throw duplicate("name", "기관명 " + name + "은(는) " + label + "의 이름·별칭과 겹칩니다.");
            }
            for (String a : aliasSet) {
                if (words.contains(a) || keys.contains(a.toLowerCase(Locale.ROOT))) {
                    throw duplicate("aliases", "별칭 " + a + "은(는) " + label + "의 이름·별칭·코드와 겹칩니다.");
                }
            }
        }
        return new Valid(name, new ArrayList<>(aliasSet));
    }

    private Map<String, Usage> usage() {
        Map<String, Long> calcs = new HashMap<>();
        calculationRepository.countCalculationsByInstitution()
                .forEach(r -> calcs.put((String) r[0], ((Number) r[1]).longValue()));
        Map<String, Long> recs = countBy(reconcileRepository.findAll(), r -> r.getInstitutionCode());
        Map<String, Long> tests = countBy(testResultRepository.findAll(), t -> t.getInstitutionCode());
        Map<String, Long> members = countBy(memberRepository.findAll(), m -> m.getInstitutionCode());
        Map<String, Usage> result = new HashMap<>();
        Set<String> ids = new LinkedHashSet<>();
        ids.addAll(calcs.keySet());
        ids.addAll(recs.keySet());
        ids.addAll(tests.keySet());
        ids.addAll(members.keySet());
        for (String id : ids) {
            result.put(id, new Usage(calcs.getOrDefault(id, 0L), recs.getOrDefault(id, 0L),
                    tests.getOrDefault(id, 0L), members.getOrDefault(id, 0L)));
        }
        return result;
    }

    private static <T> Map<String, Long> countBy(List<T> list, Function<T, String> key) {
        return list.stream().map(key).filter(k -> k != null)
                .collect(Collectors.groupingBy(Function.identity(), Collectors.counting()));
    }

    private static String matchedBy(Institution i, String v) {
        if (v.equalsIgnoreCase(i.getBankCode())) {
            return "기관코드";
        }
        if (v.equalsIgnoreCase(i.getCode())) {
            return "내부 ID";
        }
        if (v.equals(i.getName())) {
            return "기관명";
        }
        return i.findMatchedAlias(v);
    }

    private Institution find(String id) {
        return institutionRepository.findById(id == null ? "" : id.trim())
                .orElseThrow(() -> new BusinessException(ErrorCode.INSTITUTION_NOT_FOUND));
    }

    private static String normalizeCode(String code) {
        return code == null ? "" : code.trim().toUpperCase(Locale.ROOT);
    }

    private static InstitutionType type(String type, String name) {
        if (type == null || type.isBlank()) {
            return InstitutionType.guess(name);
        }
        try {
            return InstitutionType.valueOf(type.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw invalid("type", "기관 구분은 BANK·SECURITIES·INSURANCE·OTHER 중 하나입니다.");
        }
    }

    private static BusinessException invalid(String field, String message) {
        return new BusinessException(ErrorCode.INVALID_INPUT, message, Map.of("field", field));
    }

    private static BusinessException duplicate(String field, String message) {
        return new BusinessException(ErrorCode.DUPLICATE_INSTITUTION, message, Map.of("field", field));
    }
}
