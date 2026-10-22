// 엑셀의 기간 값(일자·년월·분기)을 날짜 범위로 바꾼다. 실적 적용 기간 필터에 쓴다.

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const validYear = (y) => y >= 1990 && y <= 2100;
const validMonth = (m) => m >= 1 && m <= 12;

const day = (y, m, d) => (validYear(y) && validMonth(m) && d >= 1 && d <= lastDay(y, m) ? { from: ymd(y, m, d), to: ymd(y, m, d), unit: 'day' } : null);
const month = (y, m) => (validYear(y) && validMonth(m) ? { from: ymd(y, m, 1), to: ymd(y, m, lastDay(y, m)), unit: 'month' } : null);
const quarter = (y, q) => (validYear(y) && q >= 1 && q <= 4 ? { from: ymd(y, q * 3 - 2, 1), to: ymd(y, q * 3, lastDay(y, q * 3)), unit: 'quarter' } : null);

// 셀 값 하나 → { from, to, unit } (YYYY-MM-DD 문자열). 읽을 수 없으면 null
export function toDateRange(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // SheetJS cellDates는 현지 자정 기준이라 몇 시간 어긋날 수 있어 12시간을 더해 날짜만 취한다
    const t = new Date(v.getTime() + 12 * 3600 * 1000);
    return day(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }
  if (typeof v === 'number') {
    if (v >= 199001 && v <= 210012) return month(Math.floor(v / 100), v % 100);
    if (v >= 19900101 && v <= 21001231) return day(Math.floor(v / 10000), Math.floor(v / 100) % 100, v % 100);
    if (v >= 32874 && v <= 73051) {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return day(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = String(v).trim().replace(/\s+/g, '').toUpperCase();
  let m;
  if ((m = s.match(/^(\d{4}|\d{2})년?[-./]?([1-4])(?:분기|Q)$/)) || (m = s.match(/^(\d{4})[-./]?Q([1-4])$/))) {
    return quarter(m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]), Number(m[2]));
  }
  if ((m = s.match(/^([1-4])Q[-./]?(\d{4})$/))) return quarter(Number(m[2]), Number(m[1]));
  if ((m = s.match(/^(\d{4})[-./년](\d{1,2})[-./월](\d{1,2})일?$/))) return day(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{4})[-./년](\d{1,2})월?$/))) return month(+m[1], +m[2]);
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return day(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{4})(\d{2})$/))) return month(+m[1], +m[2]);
  return null;
}

// 분기의 첫날과 마지막 날
export const quarterRange = (year, q) => quarter(Number(year), Number(q));

// 범위가 [start, end] 안에 완전히 들어가는지 (start·end가 비어 있으면 그쪽은 제한 없음)
export const within = (range, start, end) => (!start || range.from >= start) && (!end || range.to <= end);
