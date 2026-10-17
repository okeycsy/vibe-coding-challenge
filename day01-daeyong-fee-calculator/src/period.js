// 기간(년월·일자·분기) 값을 분기로 바꾸고, 건수 행을 분기·기관별로 묶는다.
// 분기는 달력 기준: 1~3월 1분기, 4~6월 2분기, 7~9월 3분기, 10~12월 4분기.

export const quarterKey = (year, quarter) => `${year}-Q${quarter}`;
export const quarterLabel = (year, quarter) => `${year}년 ${quarter}분기`;
const fromMonth = (year, month) =>
  month >= 1 && month <= 12 ? { year, quarter: Math.ceil(month / 3) } : null;
const validYear = (y) => y >= 1990 && y <= 2100;

// 엑셀 날짜 일련번호(1900 기준) → 년·월
function fromExcelSerial(n) {
  const d = new Date(Math.round((n - 25569) * 86400 * 1000));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

// 셀 값 하나를 { year, quarter }로. 알 수 없으면 null
export function toQuarter(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return fromMonth(v.getFullYear(), v.getMonth() + 1);

  if (typeof v === 'number') {
    if (v >= 199001 && v <= 210012) return fromMonth(Math.floor(v / 100), v % 100); // 202401
    if (v >= 19900101 && v <= 21001231) return fromMonth(Math.floor(v / 10000), Math.floor(v / 100) % 100); // 20240115
    if (v >= 32874 && v <= 73051) {
      // 1990-01-01 ~ 2100-01-01 사이 엑셀 날짜
      const { year, month } = fromExcelSerial(v);
      return fromMonth(year, month);
    }
    return null;
  }

  const s = String(v).trim().replace(/\s+/g, '').toUpperCase();
  let m;
  // 분기 표기: 2024년1분기, 2024-1분기, 2024Q1, 2024.1Q, 1Q2024, 24년1분기
  if ((m = s.match(/^(\d{4}|\d{2})년?[-./]?([1-4])(?:분기|Q)$/)) || (m = s.match(/^(\d{4})[-./]?Q([1-4])$/))) {
    const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
    return validYear(y) ? { year: y, quarter: Number(m[2]) } : null;
  }
  if ((m = s.match(/^([1-4])Q[-./]?(\d{4})$/))) return validYear(+m[2]) ? { year: +m[2], quarter: +m[1] } : null;
  // 년월: 2024-01, 2024.1, 2024/01/15, 2024년1월, 2024년01월15일
  if ((m = s.match(/^(\d{4})[-./년](\d{1,2})/))) return validYear(+m[1]) ? fromMonth(+m[1], +m[2]) : null;
  // 202401, 20240115
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})?$/))) return validYear(+m[1]) ? fromMonth(+m[1], +m[2]) : null;
  return null;
}

// 연도 열 + 월(또는 분기) 열이 따로 있을 때
export function toQuarterFromParts(yearValue, monthValue, quarterValue) {
  const year = Number(String(yearValue ?? '').replace(/[^\d]/g, ''));
  const y = year < 100 && year > 0 ? 2000 + year : year;
  if (!validYear(y)) return null;
  if (quarterValue !== undefined) {
    const q = Number(String(quarterValue).replace(/[^\d]/g, ''));
    return q >= 1 && q <= 4 ? { year: y, quarter: q } : null;
  }
  return fromMonth(y, Number(String(monthValue ?? '').replace(/[^\d]/g, '')));
}

// records: [{ name, period: {year, quarter} | null, seizure, collection, release }]
// → 분기 오름차순 [{ key, label, year, quarter, orgs: [{name, seizure, collection, release, rows}] }]
//   같은 분기 안의 같은 기관명은 한 기관으로 합산한다. 기간이 없으면 '전체' 한 묶음.
export function groupByQuarter(records) {
  const groups = new Map();
  for (const r of records) {
    const key = r.period ? quarterKey(r.period.year, r.period.quarter) : 'ALL';
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: r.period ? quarterLabel(r.period.year, r.period.quarter) : '전체',
        year: r.period?.year ?? 0,
        quarter: r.period?.quarter ?? 0,
        orgMap: new Map(),
      });
    }
    const orgMap = groups.get(key).orgMap;
    const org = orgMap.get(r.name) ?? { name: r.name, seizure: 0, collection: 0, release: 0, rows: 0 };
    org.seizure += r.seizure;
    org.collection += r.collection;
    org.release += r.release;
    org.rows += 1;
    orgMap.set(r.name, org);
  }
  return [...groups.values()]
    .sort((a, b) => a.year - b.year || a.quarter - b.quarter)
    .map(({ orgMap, ...g }) => ({ ...g, orgs: [...orgMap.values()] }));
}
