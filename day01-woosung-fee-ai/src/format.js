export const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
export const num = (n) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
export const monthLabel = (ym) => `${Number(ym.split('-')[1])}월`;

// 1234567 → '123만 4,567원' 식의 한글 금액 보조 표기
export function koreanAmount(n) {
  let v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return '';
  const units = [['조', 1e12], ['억', 1e8], ['만', 1e4]];
  const parts = [];
  for (const [u, d] of units) {
    if (v >= d) { parts.push(`${Math.floor(v / d).toLocaleString('ko-KR')}${u}`); v %= d; }
  }
  if (v) parts.push(v.toLocaleString('ko-KR'));
  return `${parts.join(' ')}원`;
}
