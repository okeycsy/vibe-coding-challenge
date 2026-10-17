// 업로드한 실적 파일(엑셀·CSV·HWP·HWPX)을 실적 레코드로 바꾼다.
import { readCsv, readXlsx } from './excel.js';
import { readHwp } from './hwp.js';
import { readHwpx } from './hwpx.js';
import { tableToRecords } from './table.js';

export const ACCEPT = ['.xlsx', '.csv', '.hwp', '.hwpx'];

export async function parsePerformanceFile(filename, buffer, { year } = {}) {
  const ext = (String(filename).toLowerCase().match(/\.[a-z0-9]+$/) ?? [''])[0];
  let tables;
  if (ext === '.xlsx') tables = await readXlsx(buffer);
  else if (ext === '.csv') tables = readCsv(buffer);
  else if (ext === '.hwp') tables = readHwp(buffer);
  else if (ext === '.hwpx') tables = readHwpx(buffer);
  else if (ext === '.xls') throw new Error('예전 엑셀(.xls)은 지원하지 않습니다. .xlsx로 저장해 업로드해 주세요.');
  else throw new Error(`지원하지 않는 파일 형식입니다(${ext || '확장자 없음'}). ${ACCEPT.join(', ')} 파일을 올려 주세요.`);

  const tried = [];
  for (const t of tables) {
    const res = tableToRecords(t.rows, { year });
    if (res && res.records.length) {
      return { source: t.name, layout: res.layout, records: res.records, problems: res.problems, tables: tables.length };
    }
    tried.push(t.name);
  }
  throw new Error(
    `실적 표를 찾지 못했습니다${tried.length ? `(${tried.join(', ')} 확인)` : ''}. ` +
    "첫 줄 근처에 '금융기관명' 열과, '월' 열 또는 '7월'·'2026-07' 같은 월별 열이 있어야 합니다.",
  );
}
