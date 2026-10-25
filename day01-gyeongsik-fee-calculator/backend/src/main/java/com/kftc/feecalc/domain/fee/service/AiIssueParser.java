package com.kftc.feecalc.domain.fee.service;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;

import com.kftc.feecalc.domain.fee.dto.ParsedIssue;
import com.kftc.feecalc.domain.fee.entity.Institution;

/**
 * AI 이슈(예외 차감) 문장 해석기 — 시연용 규칙 기반.
 * 기관 이름·별칭과 "1,500건" 같은 건수를 찾아 차감 규칙으로 바꾼다. (프론트엔드 utils/fee.js parseIssue 와 같은 규칙)
 * TODO: LLM 기반 해석기로 교체할 때 이 클래스를 인터페이스로 분리한다.
 */
@Component
public class AiIssueParser {

    private static final Pattern COUNT = Pattern.compile("([\\d,]+)\\s*건");
    private static final Pattern DATE = Pattern.compile("(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일");

    public ParsedIssue parse(String text, List<Institution> institutions) {
        Institution inst = null;
        String alias = null;
        // 가장 길게 맞는 이름·별칭을 고른다 ('하나온은행'이 '하나'(하나은행)로 잡히지 않도록)
        for (Institution i : institutions) {
            String a = i.findMatchedAlias(text);
            if (a != null && (alias == null || a.length() > alias.length())) {
                alias = a;
                inst = i;
            }
        }

        Long count = null;
        Matcher cm = COUNT.matcher(text);
        if (cm.find()) {
            String digits = cm.group(1).replace(",", "");
            if (!digits.isEmpty()) {
                count = Long.parseLong(digits);
            }
        }

        Matcher dm = DATE.matcher(text);
        String date = dm.find() ? dm.group(1) + "/" + dm.group(2) : null;

        return new ParsedIssue(text, inst == null ? null : inst.getCode(), inst == null ? null : inst.getName(),
                alias, count, date, reason(text));
    }

    private String reason(String text) {
        boolean outage = text.contains("장애");
        boolean duplicate = text.contains("중복");
        if (outage && duplicate) {
            return "시스템 장애·중복 전송";
        }
        if (outage) {
            return "시스템 장애";
        }
        if (duplicate) {
            return "중복 전송";
        }
        if (text.contains("테스트") || text.contains("시험")) {
            return "테스트 전문";
        }
        if (text.contains("재처리")) {
            return "재처리분";
        }
        return "기타 예외";
    }
}
