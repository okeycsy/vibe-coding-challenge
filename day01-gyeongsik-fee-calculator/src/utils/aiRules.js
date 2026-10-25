// 이슈 차감 판별(Step A)의 규칙 기반(Rule-based) 해석. 서버 RuleBasedFeeRules 와 같은 규칙이다.
// 서버 미연결(Mock) 모드는 브라우저에 AI 키를 둘 수 없으므로 늘 이 규칙으로 동작한다.
// 서버 연결 시에는 서버가 AI(LLM)를 부르고, 키가 없거나 AI가 실패하면 서버도 같은 규칙으로 동작한다.
// (금액 후처리는 "## 4. 최종 정산 특이사항"을 읽는 specialRules.js, 1번 규칙 → 3번 수식은 formulaGenerator.js)
import { lines } from './skill';

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
