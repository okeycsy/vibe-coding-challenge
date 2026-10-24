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

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

/**
 * 업무 목록과 업무별 skill.md 파일 I/O. 1업무 = 1파일: 업무마다 {app.skills.dir} 안의 md 파일 하나만 읽고 쓴다.
 * <ul>
 *   <li>업무 목록(업무 코드·이름·파일명)은 같은 폴더의 tasks.json 에 둔다. 없으면 기본 5개 업무로 만든다</li>
 *   <li>기동 시 파일이 없는 기본 업무는 classpath:skills/{TASK_CODE}.md(초기 기준)를 복사해 만든다.
 *       관리자가 추가한 업무는 기본 템플릿의 뼈대(제목·항목·섹션 제목·빈 formula 블록)만 있는 파일로 시작한다</li>
 *   <li>업무 코드·파일명은 영문·숫자·밑줄(파일명은 - 도)만 받는다. 경로 문자(.., /, \)가 섞이면 거부하고,
 *       만든 경로가 저장 폴더 밖이면 다시 한 번 막는다 (Path Traversal 방지). 한 파일은 한 업무에만 연결된다</li>
 *   <li>저장 전 섹션·수식 구문·시험 계산을 통과해야 하며, 임시 파일에 쓴 뒤 바꿔 끼운다</li>
 * </ul>
 */
@Slf4j
@Service
public class SkillFileService {

    /** 기본 업무: 업무 코드, 업무 ID(Business.code, 프론트 BUSINESSES[].id), 업무명. 파일명은 {업무 코드}.md */
    private static final List<TaskEntry> BUILT_IN = List.of(
            builtIn("OPEN_BANKING", "openbanking", "오픈뱅킹"),
            builtIn("FIN_INFO", "fininfo", "금융거래정보(금거정)"),
            builtIn("CMS", "cms", "CMS"),
            builtIn("CD_NET", "cd", "CD공동망"),
            builtIn("INTERBANK", "interbank", "타행환"));

    private static final Pattern SAFE_CODE = Pattern.compile("^[A-Za-z0-9_]{1,30}$");
    /** 새 업무 코드: 영문 대문자로 시작, 대문자·숫자·밑줄 2~30자 */
    private static final Pattern NEW_CODE = Pattern.compile("^[A-Z][A-Z0-9_]{1,29}$");
    /** md 파일명(확장자 제외): 영문·숫자로 시작, 영문·숫자·밑줄·하이픈 50자 이하 */
    private static final Pattern FILE_BASE = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$");
    static final String REGISTRY_FILE = "tasks.json";
    static final int MAX_MARKDOWN_LENGTH = 20_000;
    static final int MAX_NAME_LENGTH = 50;

    private final Path dir;
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    /** 업무 코드 → 업무. 등록 순서 유지, 변경은 synchronized 로 묶는다 */
    private final Map<String, TaskEntry> tasks = new LinkedHashMap<>();
    /** 마지막 수정자 (파일 시스템에는 남지 않으므로 메모리에 둔다) */
    private final Map<String, String> updatedBy = new ConcurrentHashMap<>();

    public SkillFileService(@Value("${app.skills.dir:./data/skills}") String dir) {
        this.dir = Path.of(dir).toAbsolutePath().normalize();
    }

    /** 업무 한 건: 업무 코드 ↔ md 파일 1:1. builtIn 이면 초기 기준이 classpath 에 있다 */
    public record TaskEntry(String taskCode, String businessId, String name, String fileName, boolean builtIn,
                            LocalDateTime createdAt, String createdBy) {
    }

    /** 파일 상태 요약 */
    public record SkillFileMeta(String taskCode, LocalDateTime lastModified, long size, String version,
                                boolean modified, String updatedBy) {
    }

    private static TaskEntry builtIn(String code, String businessId, String name) {
        return new TaskEntry(code, businessId, name, code + ".md", true, null, null);
    }

    @PostConstruct
    synchronized void init() throws IOException {
        Files.createDirectories(dir);
        Path registry = dir.resolve(REGISTRY_FILE);
        if (Files.exists(registry)) {
            for (TaskEntry t : json.readValue(registry.toFile(), new TypeReference<List<TaskEntry>>() { })) {
                // 손으로 고친 목록이라도 경로 규칙을 벗어난 항목은 쓰지 않는다
                if (SAFE_CODE.matcher(t.taskCode()).matches() && validFileName(t.fileName())) {
                    tasks.put(t.taskCode(), t);
                }
            }
        } else {
            BUILT_IN.forEach(t -> tasks.put(t.taskCode(), t));
            saveRegistry();
        }
        for (TaskEntry t : tasks.values()) {
            Path file = path(t.taskCode());
            if (!Files.exists(file)) {
                Files.writeString(file, readDefault(t), StandardCharsets.UTF_8);
            }
        }
        List<String> mapped = tasks.values().stream().map(TaskEntry::fileName).toList();
        try (Stream<Path> files = Files.list(dir)) {
            files.map(p -> p.getFileName().toString())
                    .filter(n -> n.endsWith(".md") && !mapped.contains(n))
                    .forEach(n -> log.warn("업무에 연결되지 않은 md 파일은 쓰지 않습니다 (1업무 1파일): {}", n));
        }
        log.info("skill.md 저장 폴더: {} (업무 {}개)", dir, tasks.size());
    }

    /** skill.md 저장 폴더 */
    public Path directory() {
        return dir;
    }

    // ---------- 업무 목록 ----------

    public synchronized List<TaskEntry> tasks() {
        return List.copyOf(tasks.values());
    }

    public synchronized TaskEntry task(String taskCode) {
        TaskEntry t = tasks.get(taskCode);
        if (t == null) {
            throw new BusinessException(ErrorCode.BUSINESS_NOT_FOUND);
        }
        return t;
    }

    public String businessIdOf(String taskCode) {
        return task(taskCode).businessId();
    }

    public List<String> taskCodes() {
        return tasks().stream().map(TaskEntry::taskCode).toList();
    }

    /**
     * 업무 추가. 업무 코드·업무명·파일명이 다른 업무와 겹치면 409, 형식이 틀리면 400.
     * md 파일은 기본 템플릿의 뼈대(#·## 제목, 업무명 등 항목, 빈 formula 블록)만 쓴 채로 만든다.
     */
    public synchronized TaskEntry create(String taskCode, String name, String fileName, String employeeId) {
        String code = taskCode == null ? "" : taskCode.trim().toUpperCase();
        if (!NEW_CODE.matcher(code).matches()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT,
                    "업무 코드는 영문 대문자로 시작하는 영문 대문자·숫자·밑줄(_) 2~30자로 입력해 주세요.");
        }
        String taskName = name == null ? "" : name.strip();
        if (taskName.isEmpty() || taskName.length() > MAX_NAME_LENGTH) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "업무명은 1~" + MAX_NAME_LENGTH + "자로 입력해 주세요.");
        }
        String file = normalizeFileName(fileName == null || fileName.isBlank() ? code : fileName);
        String businessId = code.toLowerCase();
        for (TaskEntry t : tasks.values()) {
            if (t.taskCode().equals(code) || t.businessId().equalsIgnoreCase(businessId)) {
                throw new BusinessException(ErrorCode.DUPLICATE_TASK, "이미 있는 업무 코드입니다: " + code);
            }
            if (t.name().equals(taskName)) {
                throw new BusinessException(ErrorCode.DUPLICATE_TASK, "이미 있는 업무명입니다: " + taskName);
            }
            if (t.fileName().equalsIgnoreCase(file)) {
                throw new BusinessException(ErrorCode.DUPLICATE_TASK,
                        file + " 파일은 이미 " + t.name() + " 업무에 연결되어 있습니다. 한 파일은 한 업무에만 연결할 수 있습니다.");
            }
        }
        Path target = resolveInDir(file);
        if (Files.exists(target)) {
            throw new BusinessException(ErrorCode.DUPLICATE_TASK, "저장 폴더에 같은 이름의 파일이 이미 있습니다: " + file);
        }
        TaskEntry entry = new TaskEntry(code, businessId, taskName, file, false,
                LocalDateTime.now(ZoneId.of("Asia/Seoul")).withNano(0), employeeId);
        write(target, skeletonTemplate(entry));
        tasks.put(code, entry);
        try {
            saveRegistry();
        } catch (BusinessException e) {
            tasks.remove(code);
            deleteQuietly(target);
            throw e;
        }
        updatedBy.put(code, employeeId);
        log.info("업무 추가: {} ({}) → {} by {}", code, taskName, file, employeeId);
        return entry;
    }

    /** 업무 삭제: 목록에서 빼고 연결된 md 파일도 지운다 */
    public synchronized TaskEntry delete(String taskCode, String employeeId) {
        TaskEntry entry = task(taskCode);
        Path file = path(taskCode);
        tasks.remove(taskCode);
        try {
            saveRegistry();
        } catch (BusinessException e) {
            tasks.put(taskCode, entry);
            throw e;
        }
        deleteQuietly(file);
        updatedBy.remove(taskCode);
        log.info("업무 삭제: {} ({}) , {} 삭제 by {}", taskCode, entry.name(), entry.fileName(), employeeId);
        return entry;
    }

    /** 파일명 검사: 확장자(.md)는 붙여도 안 붙여도 되고, 결과는 항상 {이름}.md */
    static String normalizeFileName(String fileName) {
        String base = fileName.trim();
        if (base.toLowerCase().endsWith(".md")) {
            base = base.substring(0, base.length() - 3);
        }
        if (!FILE_BASE.matcher(base).matches()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT,
                    "md 파일명은 영문·숫자로 시작하는 영문·숫자·밑줄(_)·하이픈(-) 50자 이하로 입력해 주세요. (예: NEW_TASK.md)");
        }
        return base + ".md";
    }

    private static boolean validFileName(String fileName) {
        return fileName != null && fileName.endsWith(".md")
                && FILE_BASE.matcher(fileName.substring(0, fileName.length() - 3)).matches();
    }

    /**
     * 처음 만든 업무의 skill.md: 기본 템플릿에서 반드시 있어야 하는 뼈대만 넣는다.
     * # 제목, 업무명·산정 유형·표시 단위 항목, ## 1~3 섹션 제목, 빈 ```formula 블록. 내용은 비어 있어
     * 요약과 수식을 채워 저장하기 전까지는 산출에 쓰이지 않는다.
     */
    static String skeletonTemplate(TaskEntry t) {
        return "# " + t.name() + " 회비 산정 기준 (" + t.taskCode() + ")\n"
                + "\n"
                + "- 업무명: " + t.name() + "\n"
                + "- 산정 유형:\n"
                + "- 표시 단위:\n"
                + "\n"
                + "## 1. 비즈니스 규칙 요약\n"
                + "\n"
                + "## 2. AI 예외 차감 지침\n"
                + "\n"
                + "## 3. 정산 수식\n"
                + "\n"
                + "```formula\n"
                + "```\n";
    }

    private void saveRegistry() {
        try {
            Path tmp = Files.createTempFile(dir, REGISTRY_FILE, ".tmp");
            json.writerWithDefaultPrettyPrinter().writeValue(tmp.toFile(), List.copyOf(tasks.values()));
            Files.move(tmp, dir.resolve(REGISTRY_FILE), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "업무 목록을 저장하지 못했습니다.");
        }
    }

    private static void deleteQuietly(Path file) {
        try {
            Files.deleteIfExists(file);
        } catch (IOException e) {
            log.warn("md 파일을 지우지 못했습니다: {}", file, e);
        }
    }

    /** 업무 코드(OPEN_BANKING) 또는 업무 ID(openbanking)를 검증해 업무 코드로 바꾼다 */
    public String resolveTaskCode(String code) {
        if (code == null || !SAFE_CODE.matcher(code.trim()).matches()) {
            throw new BusinessException(ErrorCode.INVALID_INPUT, "잘못된 업무 코드입니다.");
        }
        String trimmed = code.trim();
        String upper = trimmed.toUpperCase();
        List<TaskEntry> all = tasks();
        return all.stream()
                .filter(t -> t.taskCode().equals(upper) || t.businessId().equalsIgnoreCase(trimmed))
                .map(TaskEntry::taskCode)
                .findFirst()
                .orElseThrow(() -> new BusinessException(ErrorCode.BUSINESS_NOT_FOUND, "skill.md 가 없는 업무입니다: " + trimmed));
    }

    /** 저장 폴더 안의 업무 md 파일. 목록에 있는 업무 코드만 받고, 결과가 폴더 밖이면 거부한다 */
    private Path path(String taskCode) {
        return resolveInDir(task(taskCode).fileName());
    }

    private Path resolveInDir(String fileName) {
        Path file = dir.resolve(fileName).normalize();
        if (!dir.equals(file.getParent())) {
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
            String markdown = readDefault(task(taskCode));
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
                !content.equals(readDefault(task(taskCode))), updatedBy.get(taskCode));
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

    /** 초기 기준(기본 업무는 classpath, 추가한 업무는 기본 템플릿 뼈대)으로 되돌린다 */
    public synchronized void reset(String taskCode, String employeeId) {
        write(path(taskCode), readDefault(task(taskCode)));
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

    private static String readDefault(TaskEntry t) {
        if (!t.builtIn()) {
            return skeletonTemplate(t);
        }
        String taskCode = t.taskCode();
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
