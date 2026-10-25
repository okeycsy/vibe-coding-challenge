// AI 단계의 규칙 기반(Rule-based) 해석. 서버 RuleBasedFeeRules·RuleBasedFormulaGenerator 와 같은 규칙이다.
// 서버 미연결(Mock) 모드는 브라우저에 AI 키를 둘 수 없으므로 늘 이 규칙으로 동작한다.
// 서버 연결 시에는 서버가 AI(LLM)를 부르고, 키가 없거나 AI가 실패하면 서버도 같은 규칙으로 동작한다.

// ── 공통 ──
export const lines = (text) =>
  (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^([-*]|\d+\.)\s+/, ''));

const AMOUNT = String.raw`\d[\d,]*(?:\.\d+)?\s*(?:억|만|천)?(?:\s*\d[\d,]*\s*(?:만|천))?\s*원`;
const UNITS = { 억: 100_000_000, 만: 10_000, 천: 1_000 };

// "50만원", "1억 2,000만원", "900,000원" → 원
export function parseAmount(text) {
  let total = 0;
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(억|만|천)?/g)) {
    total += Number(m[1].replace(/,/g, '')) * (m[2] ? UNITS[m[2]] : 1);
  }
  return Math.round(total);
}

const won = (n) => `${Math.abs(n).toLocaleString('ko-KR')}원`;
export const signed = (d) => `${d > 0 ? '+' : '-'}${won(d)}`;

// ── Step A: 이슈 차감 판별 ──
const EXCLUDE = /차감하지\s*않|차감\s*대상이\s*아니|차감에서\s*제외|차감\s*제외/;
const SUBJECT_END = /(건은|건도|경우|이므로|하므로|므로)/;
const SUFFIXES = ['에서', '으로', '하는', '한', '된', '로', '은', '는', '이', '가', '을', '를', '의', '도', '에', '과', '와'];
const STOPWORDS = new Set(['건', '기관', '경우', '등', '같은', '다시', '쪽', '애초에', '정상', '거래', '건수', '대상', '처리']);

const stripSuffix = (w) => {
  const s = SUFFIXES.find((x) => w.endsWith(x) && w.length - x.length >= 2);
  return s ? w.slice(0, w.length - s.length) : w;
};

export function keywords(clause) {
  const end = clause.match(SUBJECT_END);
  const subject = end ? clause.slice(0, end.index) : clause;
  const keys = [];
  subject.split(/[\s·,()[\]/~'"‘’“”.]+/).forEach((raw) => {
    const w = stripSuffix(raw.trim());
    if (w.length >= 2 && !STOPWORDS.has(w) && !keys.includes(w)) keys.push(w);
  });
  return keys;
}

// 지침상 차감에서 빼야 하면 근거가 된 지침 줄, 차감 대상이면 null
export function excludedBy(guide, issueText) {
  if (!guide?.trim() || !issueText) return null;
  for (const line of lines(guide)) {
    const m = line.match(EXCLUDE);
    // "기관명과 건수가 없으면 차감하지 않는다"는 문장 해석기(기관·건수 인식)가 이미 처리한다
    if (!m || line.includes('없으면')) continue;
    const keys = keywords(line.slice(0, m.index));
    if (!keys.length) continue;
    const hit = keys.filter((k) => issueText.includes(k)).length;
    if (hit >= Math.max(1, Math.floor((keys.length + 1) / 2))) return line;
  }
  return null;
}

// 이슈마다 { applied, judgement } (서버 AiFeePostProcessor.reviewIssues 의 규칙 기반 결과와 같다)
export function reviewIssues(guide, issues) {
  return issues.map((i) => {
    if (!i.parsed.institutionId || !i.parsed.count) {
      return { ...i, applied: false, judgement: '기관명 또는 차감 건수를 문장에서 찾지 못해 반영하지 않았습니다.' };
    }
    const line = excludedBy(guide, i.text);
    return line
      ? { ...i, applied: false, judgement: `지침상 차감 제외: ${line}` }
      : { ...i, applied: true, judgement: '지침상 차감 대상' };
  });
}

// ── Step C: 최종 보정 ──
const ROUNDING = /(\d[\d,]*)\s*원\s*(?:단위|미만)\s*(?:로|으로|에서)?\s*(반올림|절상|올림|절사|절삭|버림|내림)/;
const CLAMP = new RegExp(String.raw`(최저|최소|최고|최대)\s*(?:회비|금액|한도)?\s*(?:는|은)?\s*(${AMOUNT})`, 'g');
const LABEL = { 올림: '절상', 버림: '절사', 내림: '절사' };

function round(fee, unit, mode) {
  if (mode === '절상' || mode === '올림') return Math.floor((fee + unit - 1) / unit) * unit;
  if (mode === '반올림') return Math.floor((fee + Math.floor(unit / 2)) / unit) * unit;
  return Math.floor(fee / unit) * unit;
}

// 규칙 문장에 이름·별칭이 나온 기관 (더 긴 이름 안의 별칭은 뺀다). 하나도 없으면 전체 기관
export function targets(rule, rows) {
  const found = [];
  rows.forEach((r, idx) => {
    const hit = rule.includes(r.name)
      ? r.name
      : (r.aliases ?? []).filter((a) => rule.includes(a)).sort((a, b) => b.length - a.length)[0];
    if (hit) found.push({ idx, hit });
  });
  const result = found
    .filter((f) => !found.some((g) => g !== f && g.hit.length > f.hit.length && g.hit.includes(f.hit)))
    .map((f) => f.idx);
  return result.length ? result : rows.map((_, idx) => idx);
}

// rows: [{ institutionId, name, aliases, finalCount, primaryFee }] → [{ finalFee, reason }]
export function postProcess(summary, rows) {
  const fee = rows.map((r) => r.primaryFee);
  const reasons = rows.map(() => []);
  const rules = lines(summary);

  // 1) 최저·최고 회비 (수식에 이미 있으면 바뀌는 기관이 없다)
  rules.forEach((rule) => {
    for (const m of rule.matchAll(CLAMP)) {
      const limit = parseAmount(m[2]);
      const min = m[1] === '최저' || m[1] === '최소';
      targets(rule, rows).forEach((i) => {
        const next = min ? Math.max(fee[i], limit) : Math.min(fee[i], limit);
        if (next !== fee[i]) {
          reasons[i].push(`${m[1]} 회비 ${won(limit)} 적용 (${signed(next - fee[i])})`);
          fee[i] = next;
        }
      });
    }
  });

  // 2) 원 단위 절상·절사·반올림, 3) 차이분 실적순 1원씩 되돌리기
  rules.forEach((rule) => {
    const m = rule.match(ROUNDING);
    if (!m) return;
    const unit = Number(m[1].replace(/,/g, ''));
    if (unit <= 1) return;
    const label = LABEL[m[2]] ?? m[2];
    const tg = targets(rule, rows);
    let diff = 0;
    tg.forEach((i) => {
      const next = round(fee[i], unit, m[2]);
      if (next !== fee[i]) {
        reasons[i].push(`${unit.toLocaleString('ko-KR')}원 단위 ${label} (${signed(next - fee[i])})`);
        diff += next - fee[i];
        fee[i] = next;
      }
    });
    if (diff !== 0 && /(차이|차액)/.test(rule) && rule.includes('1원씩')) {
      const asc = /(작은|적은)\s*(순|기관)/.test(rule);
      const order = rows
        .map((_, i) => i)
        .filter((i) => !tg.includes(i))
        .sort((a, b) => (asc ? rows[a].finalCount - rows[b].finalCount : rows[b].finalCount - rows[a].finalCount) || a - b);
      const delta = rows.map(() => 0);
      const step = diff > 0 ? -1 : 1;
      let left = Math.abs(diff);
      while (left > 0) {
        let moved = false;
        for (const i of order) {
          if (left === 0) break;
          if (step < 0 && fee[i] <= 0) continue;
          fee[i] += step;
          delta[i] += step;
          left--;
          moved = true;
        }
        if (!moved) break;
      }
      order.forEach((i) => {
        if (delta[i]) reasons[i].push(`${label} 차이분 실적순 ${step < 0 ? '절삭' : '가산'} (${signed(delta[i])})`);
      });
    }
  });

  return rows.map((_, i) => ({ finalFee: fee[i], reason: reasons[i].length ? `규칙 반영: ${reasons[i].join(', ')}` : null }));
}

// ── 1번 규칙 → 3번 수식 (서버 RuleBasedFormulaGenerator 와 같다) ──
const TOTAL = new RegExp(String.raw`총액\s*(${AMOUNT})`);
const EQUAL_SHARE = /(\d+(?:\.\d+)?)\s*%[^\n%]*균등/;
const BASE_FEE = new RegExp(String.raw`기본료[^\d\n]*(${AMOUNT})`);
const UNIT = /건당\s*(?:단가\s*)?(\d[\d,]*)\s*원/;
const MIN = new RegExp(String.raw`(?:최저|최소)\s*(?:회비|금액|한도)?\s*(?:는|은)?\s*(${AMOUNT})`);
const MAX = new RegExp(String.raw`(?:최고|최대)\s*(?:회비|금액|한도)?\s*(?:는|은)?\s*(${AMOUNT})`);
const TIER_UPPER = /(?:(\d[\d,]*)\s*(만|억)?\s*건\s*까지|~\s*(\d[\d,]*)\s*(만|억)?\s*건)/;
const num = (s) => Number(s.replace(/,/g, ''));
// 0.3, 0.7 처럼 소수 오차 없이
const ratio = (pct) => String(Number((pct / 100).toFixed(10)));

function tiered(summary) {
  for (const line of lines(summary)) {
    if (!/건\s?까지/.test(line)) continue;
    const tiers = [];
    line
      .slice(line.indexOf(':') + 1)
      .split(/[,，]/)
      .forEach((seg) => {
        const prices = [...seg.matchAll(/(\d[\d,]*)\s*원/g)];
        if (!prices.length) return;
        const u = seg.match(TIER_UPPER);
        const upper = u ? parseAmount((u[1] ?? u[3]) + ((u[1] ? u[2] : u[4]) ?? '')) : -1;
        tiers.push([upper, num(prices[prices.length - 1][1])]);
      });
    if (tiers.length < 2 || tiers[0][0] <= 0) continue;
    const parts = [];
    let lower = 0;
    for (let i = 0; i < tiers.length; i++) {
      const [upper, price] = tiers[i];
      const last = i === tiers.length - 1;
      if (!last && upper <= lower) return null;
      if (i === 0) parts.push(`(#finalCount < ${upper} ? #finalCount : ${upper}) * ${price}`);
      else if (last && upper <= lower) parts.push(`(#finalCount > ${lower} ? #finalCount - ${lower} : 0) * ${price}`);
      else parts.push(`(#finalCount > ${lower} ? (#finalCount < ${upper} ? #finalCount : ${upper}) - ${lower} : 0) * ${price}`);
      lower = Math.max(lower, upper);
    }
    return { formula: parts.join('\n  + '), explanation: `구간별 차등 단가 ${tiers.length}구간 (최종 인정 건수 기준 누진 감액)` };
  }
  return null;
}

function baseFee(summary) {
  const b = summary.match(BASE_FEE);
  const u = summary.match(UNIT);
  if (!b || !u) return null;
  const base = parseAmount(b[1]);
  const unit = num(u[1]);
  const baseExpr = `${base}${summary.includes('일수') ? ' * #periodScale' : ''}`;
  const onlyActive = /1건\s*이상/.test(summary);
  return {
    formula: `${onlyActive ? `(#finalCount > 0 ? ${baseExpr} : 0)` : baseExpr} + #finalCount * ${unit}`,
    explanation: `기본료 ${won(base)}${onlyActive ? '(실적 1건 이상 기관만)' : ''} + 건당 ${unit}원`,
  };
}

function totalShare(summary) {
  const t = summary.match(TOTAL);
  if (!t) return null;
  const total = parseAmount(t[1]);
  const e = summary.match(EQUAL_SHARE);
  const pct = e ? Number(e[1]) : 0;
  if (pct > 0 && pct < 100) {
    return {
      formula: `${total}.0 * #periodScale * (${ratio(pct)} / #institutionCount + (#totalCount == 0 ? 0 : ${ratio(100 - pct)} * #finalCount / #totalCount))`,
      explanation: `총액 ${won(total)} 중 ${pct}% 균등 + ${Number((100 - pct).toFixed(10))}% 실적 비례`,
    };
  }
  return {
    formula: `#totalCount == 0 ? 0 : ${total}.0 * #periodScale * #finalCount / #totalCount`,
    explanation: `총액 ${won(total)}을 인정 건수 비율로 분담`,
  };
}

function unitPrice(summary) {
  const u = summary.match(UNIT);
  if (!u) return null;
  const unit = num(u[1]);
  const fee = `#finalCount * ${unit}`;
  const mn = summary.match(MIN);
  const mx = summary.match(MAX);
  const min = mn ? parseAmount(mn[1]) : null;
  const max = mx ? parseAmount(mx[1]) : null;
  const capped = max == null ? fee : `(${fee} > ${max} ? ${max} : ${fee})`;
  return {
    formula: min == null ? capped : `${fee} < ${min}\n  ? ${min}\n  : ${capped}`,
    explanation: `건당 ${unit}원${min != null ? `, 최저 ${won(min)}` : ''}${max != null ? `, 최고 ${won(max)}` : ''}`,
  };
}

export function generateFormula(summary) {
  if (!summary?.trim()) return null;
  return tiered(summary) ?? baseFee(summary) ?? totalShare(summary) ?? unitPrice(summary);
}

const SUMMARY = /^##\s*1\.\s*비즈니스 규칙 요약[ \t]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m;
const FORMULA_BLOCK = /(```formula[ \t]*\n)([\s\S]*?)(```)/;

export const summaryOf = (markdown) => markdown.replace(/\r\n/g, '\n').match(SUMMARY)?.[1]?.trim() ?? '';
export const formulaOf = (markdown) => markdown.replace(/\r\n/g, '\n').match(FORMULA_BLOCK)?.[2]?.trim() ?? '';

// ```formula 블록 안만 바꾼다. 블록이 없으면 "## 3." 제목 아래(없으면 끝)에 만든다 (서버 FormulaSyncService.replaceFormula 와 같다)
export function replaceFormula(markdown, formula) {
  const md = markdown.replace(/\r\n/g, '\n');
  const fm = md.match(FORMULA_BLOCK);
  if (fm) {
    const start = fm.index + fm[1].length;
    return md.slice(0, start) + formula + '\n' + md.slice(start + fm[2].length);
  }
  const block = '```formula\n' + formula + '\n```\n';
  const s3 = md.match(/^##\s*3\.[^\n]*$/m);
  if (s3) {
    const end = s3.index + s3[0].length;
    return md.slice(0, end) + '\n\n' + block + md.slice(end).replace(/^\n+/, '\n');
  }
  return `${md.trimEnd()}\n\n## 3. 정산 수식\n\n${block}`;
}
