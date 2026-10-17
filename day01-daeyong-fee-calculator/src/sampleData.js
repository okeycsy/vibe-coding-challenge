// 예시 입력 데이터: 가상 기관 8곳의 2024년 1월 ~ 2026년 12월 월별 건수(3년치).
// 기관명과 건수는 모두 가상의 값이다. 같은 기관이 달마다 한 행씩 나온다.
export const SAMPLE_FILENAME = '예시_기관별_월별건수_3년.xlsx';
export const SAMPLE_QUARTER_FEE = 25_000_000;

// [기관명, 월평균 압류, 추심, 해제, 첫 달(이 달부터 데이터가 있음)]
const ORGS = [
  ['예시은행A', 1040, 280, 670, '2024-01'],
  ['예시은행B', 820, 175, 505, '2024-01'],
  ['예시은행C', 360, 75, 225, '2024-01'],
  ['예시저축은행D', 125, 27, 73, '2024-01'],
  ['예시증권E', 52, 13, 34, '2024-01'],
  ['예시카드F', 190, 58, 133, '2024-01'],
  ['예시보험G', 15, 4, 8, '2024-01'],
  ['예시상호금융H', 30, 6, 15, '2025-07'],
];

// 시드가 고정된 의사난수 (매번 같은 예시가 나오도록)
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

export function sampleSheetRows() {
  const rand = rng(20241);
  const rows = [['기준년월', '기관명', '압류건수', '추심건수', '해제건수', '합계건수']];
  for (let y = 2024; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      for (const [name, s, c, r, from] of ORGS) {
        if (ym < from) continue;
        const k = () => 0.75 + rand() * 0.5;
        const v = [Math.round(s * k()), Math.round(c * k()), Math.round(r * k())];
        rows.push([ym, name, ...v, v[0] + v[1] + v[2]]);
      }
    }
  }
  return rows;
}
