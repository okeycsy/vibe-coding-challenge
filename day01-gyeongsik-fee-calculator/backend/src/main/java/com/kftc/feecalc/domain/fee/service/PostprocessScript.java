package com.kftc.feecalc.domain.fee.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.kftc.feecalc.common.exception.BusinessException;
import com.kftc.feecalc.common.exception.ErrorCode;

/**
 * "## 4. 최종 정산 특이사항"의 ```postprocess 블록(후처리 스크립트) 문법. 한 줄이 한 단계이고, AI(또는 내장 변환기)가
 * 자연어 특이사항을 이 스크립트로 바꿔 두면 산출 때 {@link PostprocessEngine}이 그대로 실행한다 (산출 시 AI 호출 없음).
 * 프론트 src/utils/postprocess.js 와 같은 문법·같은 실행 규칙이다.
 * <pre>
 *   allocate(fee)                                   # 원 단위 배분(최대잔여법). fee 면 균등분담분도 따로 배분
 *   roundHalf(equal)  roundHalf(perf)               # 구성요소별 반올림(정수화)
 *   roundUp(fee, 10, "우체국", addTo=perf)          # 10원 단위 절상, 늘어난 금액은 실적분담분에
 *   roundDown(fee, 10)                              # 10원 미만 절사(전체 기관)
 *   fixSum(equal, 25%, over=perfDesc, under=perfAsc) # 합계를 목표에 맞춰 1원씩 보정
 *   spreadDiff(perf, others, perfDesc)              # 직전 단계들에서 생긴 차이분을 나머지 기관에 1원씩 되돌림
 *   min(fee, 300000)  max(fee, 100000000, "토스뱅크") # 최저·최고
 *   add(perf, -5%, "토스뱅크")  set(fee, 0, "우체국")  # 가감·고정
 *   assert sum(equal) == 25%   assert fee("우체국") % 10 == 0   assert all(fee >= 0)   assert sum(fee) == before
 * </pre>
 * 구성요소: equal(균등분담분) · perf(실적분담분) · fee(회비 = equal + perf). 대상: all · first · last · others(직전 대상의 나머지) ·
 * "기관명"(기관명·기관 ID·기관코드·별칭). 정렬: perfDesc/perfAsc(실적분담분) · countDesc/countAsc(최종 인정 건수) ·
 * feeDesc/feeAsc · equalDesc/equalAsc · codeAsc. 동률은 기관코드 오름차순.
 */
public final class PostprocessScript {

    private PostprocessScript() {
    }

    public static final int MAX_LINES = 50;
    public static final int MAX_LINE_LENGTH = 200;
    public static final long MAX_UNIT = 100_000_000L;
    public static final long MAX_AMOUNT = 1_000_000_000_000L;
    public static final double MAX_PCT = 1000;

    public enum Component { EQUAL, PERF, FEE }

    public enum Rounding { UP, DOWN, HALF_UP }

    public enum SelectorType { ALL, FIRST, LAST, OTHERS, NAMED }

    public enum Order { PERF_DESC, PERF_ASC, COUNT_DESC, COUNT_ASC, FEE_DESC, FEE_ASC, EQUAL_DESC, EQUAL_ASC, CODE_ASC }

    public enum Kind { ALLOCATE, ROUND, FIX_SUM, SPREAD_DIFF, MIN, MAX, ADD, SET, ASSERT }

    /** 금액 또는 비율(%). pct 는 비율일 때만 */
    public record Amount(long won, Double pct) {

        public boolean isPct() {
            return pct != null;
        }

        public String label() {
            return isPct() ? trimPct(pct) + "%" : String.format("%,d원", won);
        }
    }

    public record Selector(SelectorType type, List<String> names) {

        static final Selector ALL = new Selector(SelectorType.ALL, List.of());
        static final Selector OTHERS = new Selector(SelectorType.OTHERS, List.of());
    }

    /** assert 한 줄: SUM(comp OP value|before) · MOD(comp("name") % n == 0) · ALL(comp OP n) · INTEGER */
    public record Assertion(String form, Component comp, String op, Amount value, boolean before, long mod,
                            Selector selector) {
    }

    /** 스크립트 한 줄 */
    public record Op(int line, String text, Kind kind, Component comp, long unit, Rounding rounding, Selector selector,
                     Component addTo, Amount amount, Order order, Order over, Order under, long step, Assertion assertion) {
    }

    private static final Map<String, Component> COMPONENTS = Map.of("equal", Component.EQUAL, "perf", Component.PERF, "fee", Component.FEE);
    private static final Map<String, Order> ORDERS = Map.of(
            "perfdesc", Order.PERF_DESC, "perfasc", Order.PERF_ASC, "countdesc", Order.COUNT_DESC, "countasc", Order.COUNT_ASC,
            "feedesc", Order.FEE_DESC, "feeasc", Order.FEE_ASC, "equaldesc", Order.EQUAL_DESC, "equalasc", Order.EQUAL_ASC,
            "codeasc", Order.CODE_ASC);
    private static final Pattern CALL = Pattern.compile("^([A-Za-z_]\\w*)\\s*\\((.*)\\)$");
    private static final Pattern ARG = Pattern.compile("\\s*(?:([A-Za-z_]\\w*)\\s*=\\s*)?(\"[^\"]*\"|-?[\\d,]+(?:\\.\\d+)?\\s*%?|[A-Za-z_]\\w*)\\s*(?:,|$)");
    private static final Pattern ASSERT_SUM = Pattern.compile("^sum\\(\\s*(equal|perf|fee)\\s*\\)\\s*(==|!=|<=|>=|<|>)\\s*(before|-?[\\d,]+(?:\\.\\d+)?\\s*%?)$");
    private static final Pattern ASSERT_MOD = Pattern.compile("^(equal|perf|fee)\\(\\s*(\"[^\"]*\"|first|last)\\s*\\)\\s*%\\s*(\\d+)\\s*==\\s*0$");
    private static final Pattern ASSERT_ALL = Pattern.compile("^all\\(\\s*(equal|perf|fee)\\s*(==|!=|<=|>=|<|>)\\s*(-?[\\d,]+(?:\\.\\d+)?)\\s*\\)$");

    /** 스크립트를 줄 단위로 읽는다. 문법·허용 범위를 벗어나면 400 INVALID_FORMULA ("후처리 스크립트 N행: …") */
    public static List<Op> parse(String script) {
        List<Op> ops = new ArrayList<>();
        if (script == null || script.isBlank()) {
            return ops;
        }
        String[] rows = script.replace("\r\n", "\n").split("\n");
        int count = 0;
        for (int i = 0; i < rows.length; i++) {
            String text = stripComment(rows[i]).strip();
            if (text.isEmpty()) {
                continue;
            }
            if (++count > MAX_LINES) {
                throw error(i + 1, "후처리 스크립트는 " + MAX_LINES + "줄 이하로 작성해 주세요.");
            }
            if (text.length() > MAX_LINE_LENGTH) {
                throw error(i + 1, "한 줄은 " + MAX_LINE_LENGTH + "자 이하로 작성해 주세요.");
            }
            ops.add(parseLine(i + 1, text));
        }
        return ops;
    }

    private static String stripComment(String row) {
        boolean quoted = false;
        for (int i = 0; i < row.length(); i++) {
            char c = row.charAt(i);
            if (c == '"') {
                quoted = !quoted;
            } else if (c == '#' && !quoted) {
                return row.substring(0, i);
            }
        }
        return row;
    }

    static BusinessException error(int line, String message) {
        return new BusinessException(ErrorCode.INVALID_FORMULA, "후처리 스크립트 " + line + "행: " + message);
    }

    private static Op parseLine(int line, String text) {
        if (text.startsWith("assert ") || text.startsWith("assert\t")) {
            return new Op(line, text, Kind.ASSERT, null, 0, null, null, null, null, null, null, null, 0,
                    parseAssert(line, text.substring(6).strip()));
        }
        Matcher m = CALL.matcher(text);
        if (!m.matches()) {
            throw error(line, "'연산(인자, ...)' 또는 'assert 조건' 형식이어야 합니다: " + text);
        }
        String name = m.group(1);
        List<Object[]> args = parseArgs(line, m.group(2));
        return switch (name) {
            case "allocate" -> {
                Component comp = comp(line, positional(line, args, 0, true));
                noMore(line, args, 1);
                yield op(line, text, Kind.ALLOCATE).comp(comp).build();
            }
            case "roundUp", "roundDown", "roundHalf" -> {
                Rounding rounding = name.equals("roundUp") ? Rounding.UP : name.equals("roundDown") ? Rounding.DOWN : Rounding.HALF_UP;
                Component comp = comp(line, positional(line, args, 0, true));
                long unit = 1;
                int next = 1;
                Object second = positional(line, args, 1, false);
                if (second instanceof Number n) {
                    unit = n.longValue();
                    if (unit < 1 || unit > MAX_UNIT) {
                        throw error(line, "단위는 1원 이상 " + String.format("%,d", MAX_UNIT) + "원 이하여야 합니다.");
                    }
                    next = 2;
                }
                Selector selector = selector(line, args, next);
                if (positional(line, args, next, false) != null) {
                    noMore(line, args, next + consumed(selector));
                }
                Component addTo = keyword(line, args, "addTo") == null ? null : comp(line, keyword(line, args, "addTo"));
                if (addTo != null && comp != Component.FEE) {
                    throw error(line, "addTo 는 fee 를 다룰 때만 쓸 수 있습니다.");
                }
                if (addTo == Component.FEE) {
                    throw error(line, "addTo 는 equal 또는 perf 여야 합니다.");
                }
                yield op(line, text, Kind.ROUND).comp(comp).unit(unit).rounding(rounding).selector(selector)
                        .addTo(addTo == null ? Component.PERF : addTo).build();
            }
            case "fixSum" -> {
                Component comp = comp(line, positional(line, args, 0, true));
                Amount target = amount(line, positional(line, args, 1, true));
                noMore(line, args, 2);
                Order over = keyword(line, args, "over") == null ? Order.PERF_DESC : order(line, keyword(line, args, "over"));
                Order under = keyword(line, args, "under") == null ? Order.PERF_ASC : order(line, keyword(line, args, "under"));
                yield op(line, text, Kind.FIX_SUM).comp(comp).amount(target).over(over).under(under).build();
            }
            case "spreadDiff" -> {
                Component comp = comp(line, positional(line, args, 0, true));
                if (comp == Component.FEE) {
                    throw error(line, "spreadDiff 는 equal 또는 perf 에만 쓸 수 있습니다.");
                }
                // 대상(선택, 기본 others)과 정렬(선택, 기본 perfDesc)은 순서 상관없이
                Selector selector = null;
                Order order = null;
                int idx = 1;
                Object a;
                while ((a = positional(line, args, idx, false)) != null) {
                    if (a instanceof String s && ORDERS.containsKey(s.toLowerCase(Locale.ROOT)) && order == null) {
                        order = order(line, s);
                        idx++;
                    } else if (selector == null) {
                        selector = selector(line, args, idx);
                        idx += consumed(selector);
                    } else {
                        throw error(line, "spreadDiff 인자가 너무 많습니다.");
                    }
                }
                long step = 1;
                if (keyword(line, args, "step") instanceof Number n) {
                    step = n.longValue();
                    if (step < 1 || step > MAX_UNIT) {
                        throw error(line, "step 은 1원 이상이어야 합니다.");
                    }
                }
                yield op(line, text, Kind.SPREAD_DIFF).comp(comp).selector(selector == null ? Selector.OTHERS : selector)
                        .order(order == null ? Order.PERF_DESC : order).step(step).build();
            }
            case "min", "max", "add", "set" -> {
                Kind kind = switch (name) {
                    case "min" -> Kind.MIN;
                    case "max" -> Kind.MAX;
                    case "add" -> Kind.ADD;
                    default -> Kind.SET;
                };
                Component comp = comp(line, positional(line, args, 0, true));
                Amount amount = amount(line, positional(line, args, 1, true));
                if (amount.isPct() && kind != Kind.ADD) {
                    throw error(line, name + " 의 금액은 원 단위여야 합니다.");
                }
                if (kind != Kind.ADD && amount.won() < 0) {
                    throw error(line, name + " 의 금액은 0 이상이어야 합니다.");
                }
                Selector selector = selector(line, args, 2);
                if (positional(line, args, 2, false) != null) {
                    noMore(line, args, 2 + consumed(selector));
                }
                yield op(line, text, kind).comp(comp).amount(amount).selector(selector).build();
            }
            default -> throw error(line, "지원하지 않는 연산입니다: " + name
                    + " (allocate · roundUp · roundDown · roundHalf · fixSum · spreadDiff · min · max · add · set · assert)");
        };
    }

    private static Assertion parseAssert(int line, String cond) {
        String c = cond.replaceAll("\\s+", " ");
        if (c.equals("integer")) {
            return new Assertion("INTEGER", null, null, null, false, 0, null);
        }
        Matcher m = ASSERT_SUM.matcher(c);
        if (m.matches()) {
            boolean before = m.group(3).equals("before");
            return new Assertion("SUM", COMPONENTS.get(m.group(1)), m.group(2), before ? null : amount(line, numberOrPct(line, m.group(3))),
                    before, 0, null);
        }
        m = ASSERT_MOD.matcher(c);
        if (m.matches()) {
            long mod = Long.parseLong(m.group(3));
            if (mod < 2 || mod > MAX_UNIT) {
                throw error(line, "나누는 단위는 2 이상이어야 합니다.");
            }
            String sel = m.group(2);
            Selector selector = sel.startsWith("\"") ? new Selector(SelectorType.NAMED, List.of(sel.substring(1, sel.length() - 1)))
                    : new Selector(sel.equals("first") ? SelectorType.FIRST : SelectorType.LAST, List.of());
            return new Assertion("MOD", COMPONENTS.get(m.group(1)), "==", null, false, mod, selector);
        }
        m = ASSERT_ALL.matcher(c);
        if (m.matches()) {
            return new Assertion("ALL", COMPONENTS.get(m.group(1)), m.group(2), amount(line, numberOrPct(line, m.group(3))), false, 0, null);
        }
        throw error(line, "assert 는 'sum(구성요소) == 금액|N%|before', '구성요소(\"기관명\") % N == 0', 'all(구성요소 >= 0)', 'integer' 형식만 됩니다.");
    }

    // ---------- 인자 ----------

    /** [키 또는 null, 값(String 식별자 · Quoted 문자열 · Number · Pct)] */
    private static List<Object[]> parseArgs(int line, String body) {
        List<Object[]> args = new ArrayList<>();
        if (body.isBlank()) {
            return args;
        }
        Matcher m = ARG.matcher(body);
        int pos = 0;
        while (pos < body.length()) {
            if (!m.find(pos) || m.start() != pos) {
                throw error(line, "인자를 읽을 수 없습니다: " + body.substring(pos));
            }
            args.add(new Object[] {m.group(1), value(line, m.group(2).strip())});
            pos = m.end();
            if (pos < body.length() && body.charAt(pos - 1) != ',') {
                throw error(line, "인자 사이에 쉼표가 필요합니다: " + body);
            }
        }
        return args;
    }

    record Quoted(String text) {
    }

    record Pct(double value) {
    }

    private static Object value(int line, String raw) {
        if (raw.startsWith("\"")) {
            String s = raw.substring(1, raw.length() - 1).strip();
            if (s.isEmpty()) {
                throw error(line, "기관명이 비어 있습니다.");
            }
            return new Quoted(s);
        }
        if (raw.matches("-?[\\d,]+(?:\\.\\d+)?\\s*%?")) {
            return numberOrPct(line, raw);
        }
        return raw;
    }

    private static Object numberOrPct(int line, String raw) {
        String s = raw.replace(",", "").replace(" ", "");
        boolean pct = s.endsWith("%");
        if (pct) {
            s = s.substring(0, s.length() - 1);
        }
        double v;
        try {
            v = Double.parseDouble(s);
        } catch (NumberFormatException e) {
            throw error(line, "숫자를 읽을 수 없습니다: " + raw);
        }
        if (pct) {
            if (Math.abs(v) > MAX_PCT) {
                throw error(line, "비율은 ±" + (int) MAX_PCT + "% 이내여야 합니다.");
            }
            return new Pct(v);
        }
        if (s.contains(".")) {
            throw error(line, "금액은 원 단위 정수여야 합니다: " + raw);
        }
        if (Math.abs(v) > MAX_AMOUNT) {
            throw error(line, "금액이 너무 큽니다: " + raw);
        }
        return Long.parseLong(s);
    }

    private static Object positional(int line, List<Object[]> args, int index, boolean required) {
        int k = 0;
        for (Object[] a : args) {
            if (a[0] == null) {
                if (k == index) {
                    return a[1];
                }
                k++;
            }
        }
        if (required) {
            throw error(line, (index + 1) + "번째 인자가 필요합니다.");
        }
        return null;
    }

    private static Object keyword(int line, List<Object[]> args, String key) {
        for (Object[] a : args) {
            if (a[0] != null) {
                if (a[0].equals(key)) {
                    return a[1];
                }
                if (!List.of("addTo", "over", "under", "step").contains((String) a[0])) {
                    throw error(line, "알 수 없는 키워드 인자입니다: " + a[0]);
                }
            }
        }
        return null;
    }

    private static void noMore(int line, List<Object[]> args, int from) {
        if (positional(line, args, from, false) != null) {
            throw error(line, "인자가 너무 많습니다.");
        }
    }

    private static Component comp(int line, Object v) {
        if (v instanceof String s && COMPONENTS.containsKey(s)) {
            return COMPONENTS.get(s);
        }
        throw error(line, "구성요소는 equal · perf · fee 중 하나여야 합니다: " + show(v));
    }

    private static Order order(int line, Object v) {
        if (v instanceof String s && ORDERS.containsKey(s.toLowerCase(Locale.ROOT))) {
            return ORDERS.get(s.toLowerCase(Locale.ROOT));
        }
        throw error(line, "정렬은 perfDesc · perfAsc · countDesc · countAsc · feeDesc · feeAsc · equalDesc · equalAsc · codeAsc 중 하나여야 합니다: " + show(v));
    }

    private static Amount amount(int line, Object v) {
        if (v instanceof Long l) {
            return new Amount(l, null);
        }
        if (v instanceof Pct p) {
            return new Amount(0, p.value());
        }
        throw error(line, "금액(원) 또는 비율(N%)이 필요합니다: " + show(v));
    }

    /** index 부터 이어지는 위치 인자를 대상으로 읽는다: all · first · last · others · "기관명"(여러 개). 없으면 all */
    private static Selector selector(int line, List<Object[]> args, int index) {
        Object first = positional(line, args, index, false);
        if (first == null) {
            return Selector.ALL;
        }
        if (first instanceof Quoted) {
            List<String> names = new ArrayList<>();
            Object v;
            int k = index;
            while ((v = positional(line, args, k++, false)) instanceof Quoted q) {
                names.add(q.text());
            }
            return new Selector(SelectorType.NAMED, names);
        }
        if (first instanceof String s) {
            Selector sel = switch (s) {
                case "all" -> Selector.ALL;
                case "first" -> new Selector(SelectorType.FIRST, List.of());
                case "last" -> new Selector(SelectorType.LAST, List.of());
                case "others" -> Selector.OTHERS;
                default -> throw error(line, "대상은 all · first · last · others · \"기관명\" 중 하나여야 합니다: " + s);
            };
            return sel;
        }
        throw error(line, "대상은 all · first · last · others · \"기관명\" 중 하나여야 합니다: " + show(first));
    }

    /** 대상이 차지한 위치 인자 수 */
    private static int consumed(Selector sel) {
        return sel.type() == SelectorType.NAMED ? sel.names().size() : 1;
    }

    private static String show(Object v) {
        return v instanceof Quoted q ? '"' + q.text() + '"' : v instanceof Pct p ? trimPct(p.value()) + "%" : String.valueOf(v);
    }

    static String trimPct(double v) {
        return v == Math.rint(v) ? String.valueOf((long) v) : String.valueOf(v);
    }

    // ---------- Op 빌더 ----------

    private static OpBuilder op(int line, String text, Kind kind) {
        return new OpBuilder(line, text, kind);
    }

    private static final class OpBuilder {
        private final int line;
        private final String text;
        private final Kind kind;
        private Component comp;
        private long unit = 1;
        private Rounding rounding;
        private Selector selector = Selector.ALL;
        private Component addTo;
        private Amount amount;
        private Order order;
        private Order over;
        private Order under;
        private long step = 1;

        OpBuilder(int line, String text, Kind kind) {
            this.line = line;
            this.text = text;
            this.kind = kind;
        }

        OpBuilder comp(Component v) { comp = v; return this; }
        OpBuilder unit(long v) { unit = v; return this; }
        OpBuilder rounding(Rounding v) { rounding = v; return this; }
        OpBuilder selector(Selector v) { selector = v; return this; }
        OpBuilder addTo(Component v) { addTo = v; return this; }
        OpBuilder amount(Amount v) { amount = v; return this; }
        OpBuilder order(Order v) { order = v; return this; }
        OpBuilder over(Order v) { over = v; return this; }
        OpBuilder under(Order v) { under = v; return this; }
        OpBuilder step(long v) { step = v; return this; }

        Op build() {
            return new Op(line, text, kind, comp, unit, rounding, selector, addTo, amount, order, over, under, step, null);
        }
    }
}
