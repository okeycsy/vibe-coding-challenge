package com.kftc.feecalc.domain.fee.service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

/**
 * 업무별 skill.md 파일 I/O. 1업무 = 1파일: {app.skills.dir}/{TASK_CODE}.md 하나만 읽고 쓴다.
 * <ul>
 *   <li>기동 시 파일이 없는 업무는 classpath:skills/{TASK_CODE}.md(초기 기준)를 복사해 만든다</li>
 *   <li>업무 코드는 아래 목록에 있는 영문 대문자·밑줄만 받는다. 경로 문자(.., /, \)가 섞이면 거부하고,
 *       만든 경로가 저장 폴더 밖이면 다시 한 번 막는다 (Path Traversal 방지)</li>
 *   <li>저장 전 섹션·수식 구문·시험 계산을 통과해야 하며, 임시 파일에 쓴 뒤 바꿔 끼운다</li>
 * </ul>
 */
@Slf4j
@Service
public class SkillFileService {

    /** 업무 코드(= 파일명) ↔ 업무 ID(Business.code, 프론트 BUSINESSES[].id). 업무를 늘리면 여기와 skill.md 하나를 추가한다 */
    private static final Map<String, String> TASK_TO_BUSINESS = new LinkedHashMap<>();

    static {
        TASK_TO_BUSINESS.put("OPEN_BANKING", "openbanking");
        TASK_TO_BUSINESS.put("FIN_INFO", "fininfo");
        TASK_TO_BUSINESS.put("CMS", "cms");
        TASK_TO_BUSINESS.put("CD_NET", "cd");
        TASK_TO_BUSINESS.put("INTERBANK", "interbank");
    }

    private static final Pattern SAFE_CODE = Pattern.compile("^[A-Za-z_]{1,30}$");
    static final int MAX_MARKDOWN_LENGTH = 20_000;

    private final Path dir;
    /** 마지막 수정자 (파일 시스템에는 남지 않으므로 메모리에 둔다) */
    private final Map<String, String> updatedBy = new ConcurrentHashMap<>();

    public SkillFileService(@Value("${app.skills.dir:./data/skills}") String dir) {
        this.dir = Path.of(dir).toAbsolutePath().normalize();
    }

    /** 파일 상태 요약 */
    public record SkillFileMeta(String taskCode, LocalDateTime lastModified, long size, String version,
                                boolean modified, String updatedBy) {
    }

    @PostConstruct
    void init() throws IOException {
        Files.createDirectories(dir);
        for (String taskCode : TASK_TO_BUSINESS.keySet()) {
            Path file = path(taskCode);
            if (!Files.exists(file)) {
                Files.writeString(file, readDefault(taskCode), StandardCharsets.UTF_8);
            }
        }
        try (Stream<Path> files = Files.list(dir)) {
            files.map(p -> p.getFileName().toString())
                    .filter(n -> n.endsWith(".md") && !TASK_TO_BUSINESS.containsKey(n.substring(0, n.length() - 3)))
                    .forEach(n -> log.warn("업무 코드에 없는 skill.md 는 쓰지 않습니다 (1업무 1파일): {}", n));
        }
        log.info("skill.md 저장 폴더: {}", dir);
    }

    // ---------- 업무 코드 ----------

    public static String businessIdOf(String taskCode) {
        return TASK_TO_BUSINESS.get(taskCode);
    }

    public List<String> taskCodes() {
        return List.copyOf(TASK_TO_BUSINESS.keySet());
    }

    /** 업무 코드(OPEN_BANKING) 또는 업무 ID(openbanking)를 검증해 업무 코드로 바꾼다 */
    public String resolveTaskCode(String code) {
        if (code == null || !SAFE_CODE.matcher(code.trim()).matches()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "잘못된 업무 코드입니다.");
        }
        String trimmed = code.trim();
        String upper = trimmed.toUpperCase();
        if (TASK_TO_BUSINESS.containsKey(upper)) {
            return upper;
        }
        return TASK_TO_BUSINESS.entrySet().stream()
                .filter(e -> e.getValue().equalsIgnoreCase(trimmed))
                .map(Map.Entry::getKey)
                .findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.BUSINESS_NOT_FOUND, "skill.md 가 없는 업무입니다: " + trimmed));
    }

    /** 저장 폴더 안의 {taskCode}.md. 목록에 있는 업무 코드만 받고, 결과가 폴더 밖이면 거부한다 */
    private Path path(String taskCode) {
        if (!TASK_TO_BUSINESS.containsKey(taskCode)) {
            throw new BusinessException(ErrorCode.BUSINESS_NOT_FOUND);
        }
        Path file = dir.resolve(taskCode + ".md").normalize();
        if (!file.getParent().equals(dir)) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "잘못된 파일 경로입니다.");
        }
        return file;
    }

    // ---------- 읽기·쓰기 ----------

    public String read(String taskCode) {
        Path file = path(taskCode);
        try {
            return Files.readString(file, StandardCharsets.UTF_8).replace("\r\n", "\n");
        } catch (IOException e) {
            log.warn("skill.md 를 읽지 못해 초기 기준으로 다시 만듭니다: {}", file, e);
            String markdown = readDefault(taskCode);
            write(file, markdown);
            return markdown;
        }
    }

    public SkillFileMeta meta(String taskCode) {
        Path file = path(taskCode);
        String content = read(taskCode);
        LocalDateTime lastModified;
        long size;
        try {
            lastModified = LocalDateTime.ofInstant(Files.getLastModifiedTime(file).toInstant(), ZoneId.of("Asia/Seoul"));
            size = Files.size(file);
        } catch (IOException e) {
            lastModified = null;
            size = content.getBytes(StandardCharsets.UTF_8).length;
        }
        return new SkillFileMeta(taskCode, lastModified, size, version(content),
                !content.equals(readDefault(taskCode)), updatedBy.get(taskCode));
    }

    /** 검증(섹션 → 수식 구문 → 시험 계산)을 통과하면 파일을 덮어쓴다. 실패하면 파일은 그대로다 */
    public synchronized void save(String taskCode, String content, String employeeId) {
        Path file = path(taskCode);
        if (content == null || content.isBlank()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "skill.md 내용이 비어 있습니다.");
        }
        if (content.length() > MAX_MARKDOWN_LENGTH) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "skill.md 는 " + MAX_MARKDOWN_LENGTH + "자 이하로 작성해 주세요.");
        }
        String normalized = content.replace("\r\n", "\n");
        SkillEngineService.ParsedSkill parsed = SkillEngineService.parse(taskCode, businessIdOf(taskCode), normalized);
        SkillEngineService.validateFormula(parsed.formula());
        write(file, normalized);
        updatedBy.put(taskCode, employeeId);
        log.info("skill.md 저장: {} by {}", taskCode, employeeId);
    }

    /** 초기 기준(classpath)으로 되돌린다 */
    public synchronized void reset(String taskCode, String employeeId) {
        write(path(taskCode), readDefault(taskCode));
        updatedBy.put(taskCode, employeeId);
        log.info("skill.md 초기 기준 복원: {} by {}", taskCode, employeeId);
    }

    private void write(Path file, String content) {
        try {
            Path tmp = Files.createTempFile(dir, file.getFileName().toString(), ".tmp");
            Files.writeString(tmp, content, StandardCharsets.UTF_8);
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "skill.md 를 저장하지 못했습니다.");
        }
    }

    private static String readDefault(String taskCode) {
        ClassPathResource resource = new ClassPathResource("skills/" + taskCode + ".md");
        try (InputStream in = resource.getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8).replace("\r\n", "\n");
        } catch (IOException e) {
            throw new IllegalStateException("skill.md 초기 기준을 읽을 수 없습니다: " + taskCode, e);
        }
    }

    private static String version(String content) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(content.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash).substring(0, 8);
        } catch (NoSuchAlgorithmException e) {
            return "";
        }
    }
}
