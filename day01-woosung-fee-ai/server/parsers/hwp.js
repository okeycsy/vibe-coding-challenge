// 한글(HWP 5.0) 바이너리 문서에서 표를 뽑는다.
// HWP 5.0은 OLE 복합 문서이고 본문(BodyText/SectionN)은 레코드 스트림(보통 raw deflate 압축)이다.
// 참고: 한글과컴퓨터 「한글 문서 파일 형식 5.0」 공개 문서.
import zlib from 'node:zlib';
import CFB from 'cfb';

export const TAG = {
  PARA_HEADER: 66,
  PARA_TEXT: 67,
  CTRL_HEADER: 71,
  LIST_HEADER: 72,
  TABLE: 77,
};
export const CTRL_TABLE = 0x74626c20; // 'tbl '

export function readHwp(buffer) {
  const cfb = CFB.read(buffer, { type: 'buffer' });
  const header = entry(cfb, /^FileHeader$/);
  if (!header) throw new Error('HWP 5.0 문서가 아닙니다. (HWP 3.0 이하 문서는 한글에서 다시 저장해 주세요)');
  const h = Buffer.from(header.content);
  if (!h.subarray(0, 17).toString('latin1').startsWith('HWP Document File')) throw new Error('HWP 파일 서명이 올바르지 않습니다.');
  const props = h.readUInt32LE(36);
  if (props & 0b10) throw new Error('암호가 걸린 HWP 문서는 읽을 수 없습니다.');
  if (props & 0b100) throw new Error('배포용 HWP 문서는 읽을 수 없습니다. 일반 문서로 저장해 주세요.');
  const compressed = (props & 1) === 1;

  const sections = cfb.FullPaths
    .map((p, i) => ({ p, i, m: p.match(/BodyText\/Section(\d+)$/) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]));
  if (!sections.length) throw new Error('HWP 본문(BodyText)을 찾지 못했습니다.');

  const tables = [];
  for (const s of sections) {
    let data = Buffer.from(cfb.FileIndex[s.i].content);
    if (compressed) data = zlib.inflateRawSync(data);
    tables.push(...extractTables(data));
  }
  return tables.map((rows, i) => ({ name: `표 ${i + 1}`, rows }));
}

function entry(cfb, re) {
  const i = cfb.FullPaths.findIndex((p) => re.test(p.replace(/^[^/]*\//, '').replace(/\/$/, '')));
  return i >= 0 ? cfb.FileIndex[i] : null;
}

export function* records(buf) {
  let off = 0;
  while (off + 4 <= buf.length) {
    const h = buf.readUInt32LE(off);
    off += 4;
    const tag = h & 0x3ff;
    const level = (h >>> 10) & 0x3ff;
    let size = h >>> 20;
    if (size === 0xfff) { size = buf.readUInt32LE(off); off += 4; }
    yield { tag, level, data: buf.subarray(off, off + size) };
    off += size;
  }
}

// 문단 텍스트(UTF-16LE). 제어문자 중 확장·인라인 컨트롤은 8글자 폭을 차지한다.
const WIDE_CTRL = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
export function paraText(data) {
  let s = '';
  for (let i = 0; i + 1 < data.length;) {
    const c = data.readUInt16LE(i);
    if (c >= 32) { s += String.fromCharCode(c); i += 2; continue; }
    if (c === 9) s += ' ';
    if (c === 10) s += ' ';
    i += WIDE_CTRL.has(c) ? 16 : 2;
  }
  return s;
}

// 레코드 레벨로 표 구조를 따라간다. 셀 = 표 본문(TABLE) 다음에 나오는 LIST_HEADER.
export function extractTables(buf) {
  const done = [];
  const stack = [];
  const finish = () => {
    const t = stack.pop();
    const rows = [];
    for (const c of t.cells) {
      for (let dr = 0; dr < c.rowSpan; dr++) {
        const r = (rows[c.row + dr] ??= []);
        r[c.col] = c.text.join(' ').trim();
      }
    }
    done.push(Array.from(rows, (r) => Array.from(r ?? [], (v) => v ?? '')));
  };
  for (const rec of records(buf)) {
    while (stack.length && rec.level <= stack.at(-1).level) finish();
    const top = stack.at(-1);
    if (rec.tag === TAG.CTRL_HEADER && rec.data.length >= 4 && rec.data.readUInt32LE(0) === CTRL_TABLE) {
      stack.push({ level: rec.level, cells: [], cur: null, body: false });
    } else if (top && rec.tag === TAG.TABLE && rec.level === top.level + 1) {
      top.body = true;
    } else if (top && top.body && rec.tag === TAG.LIST_HEADER && rec.level === top.level + 1 && rec.data.length >= 16) {
      const d = rec.data;
      top.cur = { col: d.readUInt16LE(8), row: d.readUInt16LE(10), colSpan: d.readUInt16LE(12) || 1, rowSpan: d.readUInt16LE(14) || 1, text: [] };
      top.cells.push(top.cur);
    } else if (top && top.cur && rec.tag === TAG.PARA_TEXT) {
      top.cur.text.push(paraText(rec.data));
    }
  }
  while (stack.length) finish();
  return done;
}
