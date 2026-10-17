// 한글 HWPX(OWPML, zip + XML) 문서에서 표를 뽑는다.
import CFB from 'cfb';

export function readHwpx(buffer) {
  const zip = CFB.read(buffer, { type: 'buffer' });
  const sections = zip.FullPaths
    .map((p, i) => ({ p, i, m: p.match(/Contents\/section(\d+)\.xml$/i) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]));
  if (!sections.length) throw new Error('HWPX 본문(Contents/section*.xml)을 찾지 못했습니다.');
  const tables = [];
  for (const s of sections) tables.push(...extractTablesFromXml(Buffer.from(zip.FileIndex[s.i].content).toString('utf8')));
  return tables.map((rows, i) => ({ name: `표 ${i + 1}`, rows }));
}

const TOKEN = /<(\/?)(?:\w+:)?(tbl|tc|cellAddr|cellSpan|p|t|tab|lineBreak)\b([^>]*?)(\/?)>|<[^>]*>|([^<]+)/g;
const attr = (s, name) => Number((s.match(new RegExp(`\\b${name}="(\\d+)"`)) ?? [])[1] ?? NaN);

export function extractTablesFromXml(xml) {
  const done = [];
  const stack = [];
  let inText = 0;
  for (const m of xml.matchAll(TOKEN)) {
    const [, close, tag, attrs, selfClose, text] = m;
    const top = stack.at(-1);
    if (text !== undefined) {
      if (inText && top?.cur) top.cur.text += decode(text);
      continue;
    }
    if (!tag) continue;
    if (tag === 'tbl') {
      if (!close) stack.push({ cells: [], cur: null });
      else if (top) done.push(toRows(stack.pop().cells));
    } else if (tag === 'tc' && top) {
      if (!close) { top.cur = { col: NaN, row: NaN, rowSpan: 1, text: '' }; top.cells.push(top.cur); }
      else top.cur = null;
    } else if (tag === 'cellAddr' && top?.cur) {
      top.cur.col = attr(attrs, 'colAddr');
      top.cur.row = attr(attrs, 'rowAddr');
    } else if (tag === 'cellSpan' && top?.cur) {
      top.cur.rowSpan = attr(attrs, 'rowSpan') || 1;
    } else if (tag === 't' && !selfClose) {
      inText += close ? -1 : 1;
    } else if (tag === 'p' && !close && top?.cur?.text) {
      top.cur.text += ' '; // 셀 안 문단 구분
    } else if ((tag === 'tab' || tag === 'lineBreak') && inText && top?.cur) {
      top.cur.text += ' ';
    }
  }
  return done;
}

function toRows(cells) {
  const rows = [];
  for (const c of cells) {
    if (Number.isNaN(c.row) || Number.isNaN(c.col)) continue;
    for (let dr = 0; dr < c.rowSpan; dr++) {
      const r = (rows[c.row + dr] ??= []);
      r[c.col] = c.text.trim();
    }
  }
  return Array.from(rows, (r) => Array.from(r ?? [], (v) => v ?? ''));
}

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');
