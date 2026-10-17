// 분기 ↔ 월 변환. 월은 'YYYY-MM' 문자열로 다룬다.

export function quarterMonths(year, quarter) {
  const y = Number(year);
  const q = Number(quarter);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new Error('연도가 올바르지 않습니다.');
  if (![1, 2, 3, 4].includes(q)) throw new Error('분기는 1~4 중 하나여야 합니다.');
  return [1, 2, 3].map((i) => `${y}-${String((q - 1) * 3 + i).padStart(2, '0')}`);
}

export function monthLabel(ym) {
  const [, m] = ym.split('-');
  return `${Number(m)}월`;
}

export function periodLabel(year, quarter) {
  return `${year}년 ${quarter}분기`;
}

// 실적 파일의 월 표기를 { year, month }로. 연도가 없으면 year는 null.
// 지원: 2026-07, 2026.07, 2026/7, 202607, 2026년 7월, 7월, 07, 7
export function parseMonth(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { year: raw.getFullYear(), month: raw.getMonth() + 1 };
  }
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*월?$/);
  if (m) return ok(Number(m[1]), Number(m[2]));
  m = s.match(/^(\d{4})(\d{2})$/);
  if (m) return ok(Number(m[1]), Number(m[2]));
  m = s.match(/^(\d{1,2})\s*월$/);
  if (m) return ok(null, Number(m[1]));
  m = s.match(/^(\d{1,2})$/);
  if (m) return ok(null, Number(m[1]));
  return null;
}

function ok(year, month) {
  if (month < 1 || month > 12) return null;
  if (year !== null && (year < 2000 || year > 2100)) return null;
  return { year, month };
}

// 연도 없는 월은 해당 분기의 연도로 채운다.
export function resolveMonth(parsed, year) {
  const y = parsed.year ?? Number(year);
  return `${y}-${String(parsed.month).padStart(2, '0')}`;
}
