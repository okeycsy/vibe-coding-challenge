// 예시 실적 파일(HWP 5.0, HWPX)을 만드는 최소 작성기. 샘플 생성과 테스트에서만 쓴다.
// 본문에 제목 문단과 표 하나만 들어간, 파서가 읽을 수 있는 최소 구조다.
import zlib from 'node:zlib';
import CFB from 'cfb';

const TAG = { PARA_HEADER: 66, PARA_TEXT: 67, CTRL_HEADER: 71, LIST_HEADER: 72, TABLE: 77 };

function rec(tag, level, data) {
  const size = data.length;
  const head = Buffer.alloc(size >= 0xfff ? 8 : 4);
  head.writeUInt32LE((tag & 0x3ff) | ((level & 0x3ff) << 10) | (Math.min(size, 0xfff) << 20) >>> 0, 0);
  if (size >= 0xfff) head.writeUInt32LE(size, 4);
  return Buffer.concat([head, data]);
}

const utf16 = (s) => Buffer.from(s, 'utf16le');
const u16 = (...v) => { const b = Buffer.alloc(v.length * 2); v.forEach((x, i) => b.writeUInt16LE(x, i * 2)); return b; };
const u32 = (...v) => { const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeUInt32LE(x >>> 0, i * 4)); return b; };
const PARA_END = u16(13);

function paragraph(level, text) {
  return [
    rec(TAG.PARA_HEADER, level, Buffer.alloc(24)),
    rec(TAG.PARA_TEXT, level + 1, Buffer.concat([utf16(text), PARA_END])),
  ];
}

// 표 컨트롤 문자(확장 컨트롤 11, 8글자 폭)
const TABLE_CHAR = Buffer.concat([u16(11), Buffer.from(' lbt', 'latin1'), Buffer.alloc(8), u16(11)]);

export function buildHwp({ title, rows }) {
  const out = [...paragraph(0, title)];
  out.push(rec(TAG.PARA_HEADER, 0, Buffer.alloc(24)));
  out.push(rec(TAG.PARA_TEXT, 1, Buffer.concat([TABLE_CHAR, PARA_END])));
  out.push(rec(TAG.CTRL_HEADER, 1, Buffer.concat([u32(0x74626c20), Buffer.alloc(42)])));
  const nRows = rows.length;
  const nCols = Math.max(...rows.map((r) => r.length));
  out.push(rec(TAG.TABLE, 2, Buffer.concat([u32(0), u16(nRows, nCols, 0), u16(0, 0, 0, 0), u16(...rows.map((r) => r.length)), u16(1)])));
  rows.forEach((r, ri) => r.forEach((cell, ci) => {
    // 문단 수, (예약), 속성 / 열, 행, 열병합, 행병합 / 폭, 높이 / 안 여백 4개 / 테두리
    out.push(rec(TAG.LIST_HEADER, 2, Buffer.concat([u16(1, 0), u32(0), u16(ci, ri, 1, 1), u32(5000, 1000), u16(140, 140, 140, 140), u16(1)])));
    out.push(...paragraph(2, String(cell)));
  }));
  out.push(...paragraph(0, '※ 예시 데이터'));
  const body = zlib.deflateRawSync(Buffer.concat(out));

  const header = Buffer.alloc(256);
  header.write('HWP Document File', 0, 'latin1');
  header.writeUInt32LE(0x05000300, 32); // 5.0.3.0
  header.writeUInt32LE(1, 36);          // 압축

  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, '/FileHeader', header);
  CFB.utils.cfb_add(cfb, '/DocInfo', zlib.deflateRawSync(Buffer.alloc(0)));
  CFB.utils.cfb_add(cfb, '/BodyText/Section0', body);
  return Buffer.from(CFB.write(cfb, { type: 'buffer' }));
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildHwpx({ title, rows }) {
  const p = (text) => `<hp:p><hp:run><hp:t>${esc(text)}</hp:t></hp:run></hp:p>`;
  const cells = rows.map((r, ri) => `<hp:tr>${r.map((c, ci) =>
    `<hp:tc><hp:subList>${p(c)}</hp:subList><hp:cellAddr colAddr="${ci}" rowAddr="${ri}"/><hp:cellSpan colSpan="1" rowSpan="1"/></hp:tc>`).join('')}</hp:tr>`).join('');
  const section = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
${p(title)}
<hp:p><hp:run><hp:tbl rowCnt="${rows.length}" colCnt="${rows[0].length}">${cells}</hp:tbl></hp:run></hp:p>
${p('※ 예시 데이터')}
</hs:sec>`;
  const zip = CFB.utils.cfb_new();
  CFB.utils.cfb_add(zip, 'mimetype', Buffer.from('application/hwp+zip'));
  CFB.utils.cfb_add(zip, 'Contents/section0.xml', Buffer.from(section, 'utf8'));
  return Buffer.from(CFB.write(zip, { fileType: 'zip', type: 'buffer' }));
}
