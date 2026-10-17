// 예시 입력 엑셀(public/sample-input.xlsx) 생성. 기관명과 건수는 모두 가상의 값이다.
import * as XLSX from 'xlsx';
import { mkdirSync } from 'node:fs';

const rows = [
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
const total = ['합계', ...[1, 2, 3, 4].map((c) => rows.slice(1).reduce((a, r) => a + r[c], 0))];

const ws = XLSX.utils.aoa_to_sheet([...rows, total]);
ws['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '건수');
mkdirSync('public', { recursive: true });
XLSX.writeFile(wb, 'public/sample-input.xlsx');
console.log('public/sample-input.xlsx 생성');
