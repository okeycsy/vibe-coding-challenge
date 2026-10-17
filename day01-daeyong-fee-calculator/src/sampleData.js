// 예시 입력 데이터. 기관명과 건수는 모두 가상의 값이다.
export const SAMPLE_FILENAME = '예시_기관별건수.xlsx';
export const SAMPLE_TOTAL_FEE = 100_000_000;

export const SAMPLE_ROWS = [
  ['기관명', '압류건수', '추심건수', '해제건수', '합계건수'],
  ['예시은행A', 12500, 3400, 8100, 24000],
  ['예시은행B', 9800, 2100, 6050, 17950],
  ['예시은행C', 4300, 900, 2700, 7900],
  ['예시저축은행D', 1500, 320, 880, 2700],
  ['예시증권E', 620, 150, 410, 1180],
  ['예시카드F', 2300, 700, 1600, 4600],
  ['예시보험G', 180, 40, 95, 315],
  ['예시상호금융H', 0, 0, 0, 0],
];

// 표 아래 합계 행까지 붙인 시트용 배열
export function sampleSheetRows() {
  const body = SAMPLE_ROWS.slice(1);
  const total = ['합계', ...[1, 2, 3, 4].map((c) => body.reduce((a, r) => a + r[c], 0))];
  return [...SAMPLE_ROWS, total];
}
