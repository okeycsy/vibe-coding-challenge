package com.kftc.feecalc.domain.fee.service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import com.kftc.feecalc.domain.fee.service.PostprocessScript.Amount;
import com.kftc.feecalc.domain.fee.service.PostprocessScript.Assertion;
import com.kftc.feecalc.domain.fee.service.PostprocessScript.Component;
import com.kftc.feecalc.domain.fee.service.PostprocessScript.Op;
import com.kftc.feecalc.domain.fee.service.PostprocessScript.Order;
import com.kftc.feecalc.domain.fee.service.PostprocessScript.Rounding;
import com.kftc.feecalc.domain.fee.service.PostprocessScript.Selector;

/**
 * 후처리 스크립트({@link PostprocessScript}) 실행기. Step 1 원시값(균등분담분·실적분담분, 원 미만 포함)에서 출발해
 * 스크립트의 단계를 차례로 실행하고 기관별 최종 금액·보정 사유·검증 결과를 낸다. 결정적이며 AI 를 쓰지 않는다.
 * <p>
 * 금액은 모두 백만분의 1원(micro) 단위의 정수로 다뤄 서버·브라우저(src/utils/postprocess.js) 결과가 1원까지 같다.
 * 모든 값이 처음 정수가 되는 순간이 "정수화 완료"이고, 그 시점의 회비가 보정 전 금액(beforeSpecialFee)이다.
 * 그 전의 반올림·배분은 사유를 남기지 않고, 그 뒤의 단계(끝전 처리·보정)만 사유를 남긴다.
 * 스크립트가 끝나도 정수가 아니면 균등·실적을 각각 원 단위 배분(최대잔여법)하고 안내를 남긴다.
 */
public final class PostprocessEngine {

    private PostprocessEngine() {
    }

    public static final long MICRO = 1_000_000L;
    public static final String PREFIX = "특이사항 반영: ";

    /** 기관 한 행. equalMicro·perfMicro 는 Step 1 원시값(백만분의 1원) */
    public record Line(String institutionId, String code, String name, List<String> aliases, long finalCount,
                       long equalMicro, long perfMicro) {
    }

    public record Check(String expression, String label, boolean passed, String actual) {
    }

    /** 기관별 결과: 최종 균등·실적·회비(원), 보정 전 회비(원), 사유(보정이 없으면 null) */
    public record ItemResult(long equalFee, long perfFee, long fee, long beforeSpecialFee, String reason) {

        public boolean applied() {
            return reason != null || fee != beforeSpecialFee;
        }

        public long adjustment() {
            return fee - beforeSpecialFee;
        }
    }

    public record Result(List<ItemResult> items, List<Check> checks, List<String> notes) {

        public boolean allPassed() {
            return checks.stream().allMatch(Check::passed);
        }
    }

    public static Result run(String script, List<Line> lines) {
        return run(PostprocessScript.parse(script), lines);
    }

    public static Result run(List<Op> ops, List<Line> lines) {
        return new State(lines).run(ops);
    }

    /**
     * 시험용 기관 7곳(총액 3억원을 균등 30% + 실적 70%로 나눈 원시값, 원 미만 포함). 저장 전 시험 실행과 빌더 시뮬레이션에 쓴다
     * (프론트 postprocess.js SAMPLE_LINES 와 같은 값). 이름에 '우체국'·'NH농협은행'을 넣어 기관명 지정 단계도 시험한다.
     */
    public static List<Line> sampleLines() {
        String[] names = {"국민은행", "신한은행", "우리은행", "하나은행", "NH농협은행", "우체국", "카카오뱅크"};
        String[] codes = {"004", "088", "020", "081", "011", "071", "090"};
        long[] counts = {2_400_017, 2_100_003, 1_500_011, 1_200_007, 900_013, 300_001, 150_019};
        long total = 0;
        for (long c : counts) {
            total += c;
        }
        List<Line> lines = new ArrayList<>();
        long totalFeeMicro = 300_000_000L * MICRO; // 총액 3억원
        long equalMicro = Math.round(totalFeeMicro * 0.3 / names.length);
        for (int i = 0; i < names.length; i++) {
            long perfMicro = Math.round(totalFeeMicro * 0.7 * ((double) counts[i] / total));
            lines.add(new Line("S" + codes[i], codes[i], names[i], List.of(), counts[i], equalMicro, perfMicro));
        }
        return lines;
    }

    /** 실적 0 시험: 모든 기관 인정 건수 0, 실적분담분 0, 균등분담분만 */
    public static List<Line> zeroLines() {
        List<Line> lines = new ArrayList<>();
        for (Line l : sampleLines()) {
            lines.add(new Line(l.institutionId(), l.code(), l.name(), l.aliases(), 0, l.equalMicro(), 0));
        }
        return lines;
    }

    /**
     * 저장 전 시험 실행: 문법 검사 후 시험용 기관 2벌(정상·실적 0)에 실행해 본다. 문법 오류·실행 오류(정수화 전 fixSum 등)는
     * INVALID_FORMULA 예외로 올라온다. 검증(assert) 실패는 오류가 아니다 (산출 때 화면에 표시)
     */
    public static Result trial(String script) {
        List<Op> ops = PostprocessScript.parse(script);
        Result normal = run(ops, sampleLines());
        run(ops, zeroLines());
        return normal;
    }

    // ---------- 실행 상태 ----------

    private static final class State {
        final List<Line> lines;
        final int n;
        final long[] eq;
        final long[] pf;
        final long rawTotalMicro;
        final List<List<String>> reasons = new ArrayList<>();
        final List<Check> checks = new ArrayList<>();
        final List<String> notes = new ArrayList<>();
        long[] before;
        boolean captured;
        long pending;
        String pendingLabel;
        List<Integer> lastTargets;

        State(List<Line> lines) {
            this.lines = lines;
            this.n = lines.size();
            eq = lines.stream().mapToLong(Line::equalMicro).toArray();
            pf = lines.stream().mapToLong(Line::perfMicro).toArray();
            long sum = 0;
            for (int i = 0; i < n; i++) {
                sum += eq[i] + pf[i];
                reasons.add(new ArrayList<>());
            }
            rawTotalMicro = sum;
        }

        Result run(List<Op> ops) {
            capture();
            for (Op op : ops) {
                switch (op.kind()) {
                    case ALLOCATE -> allocate(op.comp());
                    case ROUND -> round(op);
                    case FIX_SUM -> fixSum(op);
                    case SPREAD_DIFF -> spreadDiff(op);
                    case MIN, MAX, ADD, SET -> adjust(op);
                    case ASSERT -> assertion(op);
                }
                capture();
            }
            if (!captured) {
                allocate(Component.EQUAL);
                allocate(Component.PERF);
                notes.add("스크립트가 원 미만을 정리하지 않아 균등분담분·실적분담분을 각각 원 단위로 배분했습니다 (allocate 또는 roundHalf 를 넣어 주세요).");
                capture();
            }
            List<ItemResult> items = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                items.add(new ItemResult(eq[i] / MICRO, pf[i] / MICRO, (eq[i] + pf[i]) / MICRO, before[i],
                        reasons.get(i).isEmpty() ? null : PREFIX + String.join(", ", reasons.get(i))));
            }
            return new Result(items, checks, notes);
        }

        boolean allInteger() {
            for (int i = 0; i < n; i++) {
                if (eq[i] % MICRO != 0 || pf[i] % MICRO != 0) {
                    return false;
                }
            }
            return true;
        }

        void capture() {
            if (!captured && allInteger()) {
                captured = true;
                before = new long[n];
                for (int i = 0; i < n; i++) {
                    before[i] = (eq[i] + pf[i]) / MICRO;
                }
            }
        }

        long get(Component c, int i) {
            return switch (c) {
                case EQUAL -> eq[i];
                case PERF -> pf[i];
                case FEE -> eq[i] + pf[i];
            };
        }

        /** fee 를 바꿀 때 차이는 addTo(기본 perf)에 넣는다 */
        void change(Component c, Component addTo, int i, long delta) {
            Component target = c == Component.FEE ? (addTo == null ? Component.PERF : addTo) : c;
            if (target == Component.EQUAL) {
                eq[i] += delta;
            } else {
                pf[i] += delta;
            }
        }

        void reason(int i, String text) {
            reasons.get(i).add(text);
        }

        // ---------- 연산 ----------

        void allocate(Component c) {
            if (c == Component.FEE) {
                long[] fee = new long[n];
                for (int i = 0; i < n; i++) {
                    fee[i] = eq[i] + pf[i];
                }
                long[] feeW = allocateMicro(fee);
                long[] eqW = allocateMicro(eq);
                for (int i = 0; i < n; i++) {
                    eq[i] = Math.min(eqW[i], feeW[i]) * MICRO;
                    pf[i] = feeW[i] * MICRO - eq[i];
                }
            } else if (c == Component.EQUAL) {
                long[] w = allocateMicro(eq);
                for (int i = 0; i < n; i++) {
                    eq[i] = w[i] * MICRO;
                }
            } else {
                long[] w = allocateMicro(pf);
                for (int i = 0; i < n; i++) {
                    pf[i] = w[i] * MICRO;
                }
            }
        }

        void round(Op op) {
            long unitMicro = op.unit() * MICRO;
            List<Integer> targets = targets(op.selector(), op.line());
            boolean record = op.unit() > 1 || captured;
            long total = 0;
            for (int i : targets) {
                long cur = get(op.comp(), i);
                long next = roundTo(cur, unitMicro, op.rounding());
                long delta = next - cur;
                if (delta == 0) {
                    continue;
                }
                change(op.comp(), op.addTo(), i, delta);
                total += delta;
                if (record) {
                    reason(i, String.format("%,d원 단위 %s (%s)", op.unit(), label(op.rounding()), signed(delta)));
                }
            }
            if (record) {
                pending += total;
                pendingLabel = label(op.rounding());
            }
        }

        void adjust(Op op) {
            List<Integer> targets = targets(op.selector(), op.line());
            Amount a = op.amount();
            long total = 0;
            String what;
            for (int i : targets) {
                long cur = get(op.comp(), i);
                long next;
                switch (op.kind()) {
                    case MIN -> next = Math.max(cur, a.won() * MICRO);
                    case MAX -> next = Math.min(cur, a.won() * MICRO);
                    case SET -> next = a.won() * MICRO;
                    default -> next = a.isPct()
                            ? cur + Math.round((double) cur / MICRO * a.pct() / 100.0) * MICRO
                            : cur + a.won() * MICRO;
                }
                if (next < 0) {
                    next = 0;
                }
                long delta = next - cur;
                if (delta == 0) {
                    continue;
                }
                change(op.comp(), null, i, delta);
                total += delta;
                what = switch (op.kind()) {
                    case MIN -> "최저 " + compLabel(op.comp()) + " " + a.label() + " 적용";
                    case MAX -> "최고 " + compLabel(op.comp()) + " " + a.label() + " 적용";
                    case SET -> compLabel(op.comp()) + " " + a.label() + " 고정";
                    default -> compLabel(op.comp()) + " " + (a.isPct() ? PostprocessScript.trimPct(Math.abs(a.pct())) + "%"
                            : String.format("%,d원", Math.abs(a.won()))) + (delta > 0 ? " 가산" : " 감액");
                };
                reason(i, what + " (" + signed(delta) + ")");
            }
            pending += total;
            pendingLabel = switch (op.kind()) {
                case MIN -> "최저 " + compLabel(op.comp());
                case MAX -> "최고 " + compLabel(op.comp());
                case SET -> compLabel(op.comp()) + " 고정";
                default -> compLabel(op.comp()) + " 가감";
            };
        }

        void fixSum(Op op) {
            long target = targetMicro(op.amount());
            long sum = 0;
            for (int i = 0; i < n; i++) {
                sum += get(op.comp(), i);
            }
            long diff = sum - target;
            if (diff == 0) {
                return;
            }
            if (!allInteger() || target % MICRO != 0) {
                throw PostprocessScript.error(op.line(), "fixSum 은 금액을 정수로 만든 뒤(allocate · roundHalf) 써야 합니다.");
            }
            long[] delta = new long[n];
            long left = Math.abs(diff);
            long step = diff > 0 ? -MICRO : MICRO;
            List<Integer> order = ordered(all(), diff > 0 ? op.over() : op.under());
            while (left > 0) {
                boolean moved = false;
                for (int i : order) {
                    if (left == 0) {
                        break;
                    }
                    if (step < 0 && get(op.comp(), i) + step < 0) {
                        continue;
                    }
                    change(op.comp(), null, i, step);
                    delta[i] += step;
                    left -= MICRO;
                    moved = true;
                }
                if (!moved) {
                    notes.add(op.line() + "행 fixSum: 0원 미만으로 내릴 수 없어 " + String.format("%,d", left / MICRO) + "원이 남았습니다.");
                    break;
                }
            }
            // 합계 보정은 그 자체로 완결된 단계라 되돌릴 차이분(pending)을 만들지 않는다
            for (int i = 0; i < n; i++) {
                if (delta[i] != 0) {
                    reason(i, compLabel(op.comp()) + " 합계 " + op.amount().label() + " 보정 (" + signed(delta[i]) + ")");
                }
            }
        }

        void spreadDiff(Op op) {
            if (pending == 0) {
                return;
            }
            List<Integer> targets = targets(op.selector(), op.line());
            List<Integer> order = ordered(targets, op.order());
            long stepMicro = op.step() * MICRO;
            long step = pending > 0 ? -stepMicro : stepMicro;
            long left = Math.abs(pending);
            long[] delta = new long[n];
            while (left > 0) {
                boolean moved = false;
                for (int i : order) {
                    if (left == 0) {
                        break;
                    }
                    long d = step < 0 ? -Math.min(stepMicro, left) : Math.min(stepMicro, left);
                    if (d < 0 && get(op.comp(), i) + d < 0) {
                        continue;
                    }
                    change(op.comp(), null, i, d);
                    delta[i] += d;
                    left -= Math.abs(d);
                    moved = true;
                }
                if (!moved) {
                    notes.add(op.line() + "행 spreadDiff: 0원 미만으로 내릴 수 없어 차이분 " + String.format("%,d", left / MICRO) + "원을 되돌리지 못했습니다.");
                    break;
                }
            }
            String what = (pendingLabel == null ? "" : pendingLabel + " ") + "차이분 " + orderLabel(op.order()) + (step < 0 ? " 절삭" : " 가산");
            for (int i : order) {
                if (delta[i] != 0) {
                    reason(i, what + " (" + signed(delta[i]) + ")");
                }
            }
            pending = 0;
            pendingLabel = null;
        }

        void assertion(Op op) {
            Assertion a = op.assertion();
            String expr = op.text().substring(6).strip();
            switch (a.form()) {
                case "INTEGER" -> checks.add(new Check(expr, "모든 금액이 원 단위 정수", allInteger(), allInteger() ? "정수" : "원 미만 있음"));
                case "SUM" -> {
                    long sum = 0;
                    for (int i = 0; i < n; i++) {
                        sum += get(a.comp(), i);
                    }
                    long target = a.before() ? Math.round((double) rawTotalMicro / MICRO) * MICRO : targetMicro(a.value());
                    String targetLabel = a.before() ? "보정 전 총액 " + won(target) : a.value().isPct() ? a.value().label() + " (" + won(target) + ")" : won(target);
                    checks.add(new Check(expr, compLabel(a.comp()) + " 합계 " + a.op() + " " + targetLabel, compare(sum, a.op(), target), won(sum)));
                }
                case "MOD" -> {
                    List<Integer> t = targets(a.selector(), op.line());
                    if (t.isEmpty()) {
                        checks.add(new Check(expr, compLabel(a.comp()) + " " + selectorLabel(a.selector()) + " " + a.mod() + "원 단위", false, "대상 기관 없음"));
                        return;
                    }
                    boolean ok = true;
                    List<String> actual = new ArrayList<>();
                    for (int i : t) {
                        long v = get(a.comp(), i);
                        ok &= v % (a.mod() * MICRO) == 0;
                        actual.add(lines.get(i).name() + " " + won(v));
                    }
                    checks.add(new Check(expr, selectorLabel(a.selector()) + " " + compLabel(a.comp()) + " " + String.format("%,d", a.mod()) + "원 단위", ok, String.join(", ", actual)));
                }
                default -> {
                    long limit = a.value().won() * MICRO;
                    boolean ok = true;
                    long worst = n == 0 ? 0 : get(a.comp(), 0);
                    for (int i = 0; i < n; i++) {
                        long v = get(a.comp(), i);
                        if (!compare(v, a.op(), limit)) {
                            ok = false;
                            worst = v;
                        }
                    }
                    checks.add(new Check(expr, "모든 기관 " + compLabel(a.comp()) + " " + a.op() + " " + won(limit), ok,
                            ok ? "전 기관 통과" : "위반 금액 " + won(worst)));
                }
            }
        }

        // ---------- 도우미 ----------

        long targetMicro(Amount a) {
            if (!a.isPct()) {
                return a.won() * MICRO;
            }
            // 비율 목표 = 보정 전 총액(원) × N% 를 원 단위 반올림. 브라우저와 같은 순서의 double 연산
            return Math.round((double) rawTotalMicro / MICRO * a.pct() / 100.0) * MICRO;
        }

        List<Integer> all() {
            List<Integer> idx = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                idx.add(i);
            }
            return idx;
        }

        List<Integer> targets(Selector sel, int line) {
            List<Integer> idx = new ArrayList<>();
            switch (sel.type()) {
                case ALL -> idx = all();
                case FIRST -> {
                    if (n > 0) {
                        idx.add(0);
                    }
                }
                case LAST -> {
                    if (n > 0) {
                        idx.add(n - 1);
                    }
                }
                case OTHERS -> {
                    List<Integer> prev = lastTargets == null ? List.of() : lastTargets;
                    for (int i = 0; i < n; i++) {
                        if (!prev.contains(i)) {
                            idx.add(i);
                        }
                    }
                }
                case NAMED -> {
                    for (String name : sel.names()) {
                        int i = indexOf(name);
                        if (i < 0) {
                            notes.add(line + "행: '" + name + "' 기관이 산출 대상에 없어 건너뛰었습니다.");
                        } else if (!idx.contains(i)) {
                            idx.add(i);
                        }
                    }
                }
            }
            if (sel.type() != Selector.OTHERS.type()) {
                lastTargets = idx;
            }
            return idx;
        }

        /** 기관명·기관 ID·기관코드가 같거나 별칭에 든 행 (없으면 -1) */
        int indexOf(String name) {
            for (int i = 0; i < n; i++) {
                Line l = lines.get(i);
                if (name.equals(l.name()) || name.equals(l.institutionId()) || name.equals(l.code())) {
                    return i;
                }
            }
            for (int i = 0; i < n; i++) {
                if (lines.get(i).aliases() != null && lines.get(i).aliases().contains(name)) {
                    return i;
                }
            }
            return -1;
        }

        List<Integer> ordered(List<Integer> idx, Order order) {
            Comparator<Integer> cmp = switch (order) {
                case PERF_DESC -> Comparator.<Integer>comparingLong(i -> -pf[i]);
                case PERF_ASC -> Comparator.comparingLong(i -> pf[i]);
                case COUNT_DESC -> Comparator.comparingLong(i -> -lines.get(i).finalCount());
                case COUNT_ASC -> Comparator.comparingLong(i -> lines.get(i).finalCount());
                case FEE_DESC -> Comparator.comparingLong(i -> -(eq[i] + pf[i]));
                case FEE_ASC -> Comparator.comparingLong(i -> eq[i] + pf[i]);
                case EQUAL_DESC -> Comparator.comparingLong(i -> -eq[i]);
                case EQUAL_ASC -> Comparator.comparingLong(i -> eq[i]);
                case CODE_ASC -> (a, b) -> 0;
            };
            List<Integer> sorted = new ArrayList<>(idx);
            sorted.sort(cmp.thenComparing(i -> lines.get(i).code() == null ? "" : lines.get(i).code()).thenComparing(i -> i));
            return sorted;
        }
    }

    // ---------- 공용 계산 ----------

    /** 원 단위 배분(최대잔여법). 입력·출력은 micro 와 원. 프론트 skill.js allocate 와 같은 정수 계산 */
    static long[] allocateMicro(long[] micro) {
        int n = micro.length;
        long[] fees = new long[n];
        long[] frac = new long[n];
        long fracSum = 0;
        List<Integer> order = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            fees[i] = Math.floorDiv(micro[i], MICRO);
            frac[i] = Math.floorMod(micro[i], MICRO);
            fracSum += frac[i];
            order.add(i);
        }
        long left = (fracSum + MICRO / 2) / MICRO;
        order.sort(Comparator.<Integer>comparingLong(i -> -frac[i]).thenComparing(i -> i));
        for (int k = 0; k < left && k < n; k++) {
            fees[order.get(k)]++;
        }
        return fees;
    }

    static long roundTo(long v, long unit, Rounding mode) {
        return switch (mode) {
            case UP -> Math.floorDiv(v + unit - 1, unit) * unit;
            case HALF_UP -> Math.floorDiv(v + unit / 2, unit) * unit;
            case DOWN -> Math.floorDiv(v, unit) * unit;
        };
    }

    static boolean compare(long a, String op, long b) {
        return switch (op) {
            case "==" -> a == b;
            case "!=" -> a != b;
            case "<" -> a < b;
            case "<=" -> a <= b;
            case ">" -> a > b;
            default -> a >= b;
        };
    }

    static String label(Rounding r) {
        return switch (r) {
            case UP -> "절상";
            case DOWN -> "절사";
            case HALF_UP -> "반올림";
        };
    }

    static String compLabel(Component c) {
        return switch (c) {
            case EQUAL -> "균등분담분";
            case PERF -> "실적분담분";
            case FEE -> "회비";
        };
    }

    static String orderLabel(Order o) {
        return switch (o) {
            case PERF_DESC, PERF_ASC, COUNT_DESC, COUNT_ASC -> "실적순";
            case FEE_DESC, FEE_ASC -> "회비순";
            case EQUAL_DESC, EQUAL_ASC -> "균등분담분순";
            case CODE_ASC -> "기관코드순";
        };
    }

    static String selectorLabel(Selector s) {
        return switch (s.type()) {
            case ALL -> "전체 기관";
            case FIRST -> "첫 번째 기관";
            case LAST -> "마지막 기관";
            case OTHERS -> "나머지 기관";
            case NAMED -> String.join("·", s.names());
        };
    }

    /** micro → "1,234원" (원 미만이 있으면 소수 둘째 자리까지) */
    static String won(long micro) {
        if (micro % MICRO == 0) {
            return String.format("%,d원", micro / MICRO);
        }
        return String.format("%,.2f원", micro / (double) MICRO);
    }

    static String signed(long micro) {
        return (micro > 0 ? "+" : "-") + won(Math.abs(micro));
    }
}
