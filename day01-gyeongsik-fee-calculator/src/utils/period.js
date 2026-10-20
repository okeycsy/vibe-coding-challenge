// 산출 기간(From~To) 날짜 처리. 날짜 문자열은 모두 'YYYY-MM-DD' 형식이다.

const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2099;

// 숫자만 남기고 YYYY-MM-DD 모양으로 하이픈을 넣는다. 예: '20260701' → '2026-07-01'
export function maskDate(raw) {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}

// 붙여넣은 '2026.7.1', '2026/07/01' 같은 값을 'YYYY-MM-DD'로 맞춘다. 맞출 수 없으면 숫자 마스크를 쓴다.
export function normalizeDate(raw) {
  const m = raw.trim().match(/^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?\.?$/);
  return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : maskDate(raw);
}

// 오류가 없으면 { date }, 있으면 { error }를 돌려준다.
export function parseDate(text) {
  if (!text) return { error: '날짜를 입력해 주세요.' };
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { error: 'YYYY-MM-DD 형식으로 숫자 8자리를 입력해 주세요.' };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < MIN_YEAR || y > MAX_YEAR) return { error: `${MIN_YEAR}~${MAX_YEAR}년 사이의 날짜를 입력해 주세요.` };
  if (mo < 1 || mo > 12) return { error: '월은 01~12 사이로 입력해 주세요.' };
  const date = new Date(y, mo - 1, d);
  if (d < 1 || date.getMonth() !== mo - 1) return { error: `${y}년 ${mo}월에는 ${d}일이 없습니다.` };
  return { date };
}

export const daysBetween = (from, to) => Math.round((parseDate(to).date - parseDate(from).date) / 86_400_000) + 1;

export function quarterRange(year, quarter) {
  return { from: toISO(new Date(year, (quarter - 1) * 3, 1)), to: toISO(new Date(year, quarter * 3, 0)) };
}

// 기간이 정확히 한 분기면 { year, quarter }를 돌려준다.
export function asQuarter(from, to) {
  const y = Number(from.slice(0, 4));
  for (let q = 1; q <= 4; q += 1) {
    const r = quarterRange(y, q);
    if (r.from === from && r.to === to) return { year: y, quarter: q };
  }
  return null;
}

// 오늘 기준 직전 분기 (회비는 분기 종료 후 산출)
export function previousQuarter(today = new Date()) {
  const q = Math.floor(today.getMonth() / 3) + 1;
  return q === 1 ? quarterRange(today.getFullYear() - 1, 4) : quarterRange(today.getFullYear(), q - 1);
}

export function periodLabel(from, to) {
  const q = asQuarter(from, to);
  return q ? `${q.year}년 ${q.quarter}분기 (${from} ~ ${to})` : `${from} ~ ${to} (${daysBetween(from, to)}일)`;
}

// 파일 이름용: 20260701-20260930
export const periodTag = (from, to) => `${from.replaceAll('-', '')}-${to.replaceAll('-', '')}`;
