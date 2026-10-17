// API 흐름 테스트. Claude API는 로컬 가짜 서버로 대신한다.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fee-ai-'));
process.env.FEE_AI_DATA_DIR = tmp;

let claudeRequests = [];
const fakeClaude = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    claudeRequests.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
    const rule = {
      summary: '20% 균등 + 80% 실적 비례',
      items: [{ name: '압류', weight: 1 }, { name: '해제', weight: 0.5 }],
      components: [
        { name: '기본회비', ratio: 0.2, method: 'equal', tiers: [] },
        { name: '실적회비', ratio: 0.8, method: 'proportional', tiers: [] },
      ],
      rounding: { unit: 10 },
      notes: ['미반영: 최저회비 10만원'],
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
      content: [{ type: 'text', text: JSON.stringify(rule) }],
      stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 1, output_tokens: 1 },
    }));
  });
});

let server;
let base;
before(async () => {
  await new Promise((r) => fakeClaude.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fakeClaude.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const { createApp } = await import('../server/index.js');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); fakeClaude.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('예시 업무 3개가 기본으로 등록된다', async () => {
  const works = await (await fetch(`${base}/works`)).json();
  assert.deepEqual(works.map((w) => w.code), ['cms', 'interbank', 'giro']);
  assert.ok(works.every((w) => w.rule && w.activeVersion === 1));
});

test('학습 → 저장 → 산출 → 엑셀 다운로드', async () => {
  // 1) 학습: Claude에 구조화 출력·폴백을 요청하고 규칙 초안을 돌려받는다
  const learned = await (await post('/works/cms/criteria/learn', { text: '기본 20% 균등, 80%는 압류 1·해제 0.5 가중 실적 비례, 최저회비 10만원' })).json();
  assert.deepEqual(learned.errors, []);
  assert.equal(learned.rule.rounding.unit, 10);
  const sent = claudeRequests.at(-1);
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.equal(sent.body.fallbacks, 'default');
  assert.equal(sent.body.output_config.format.type, 'json_schema');
  assert.match(sent.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);

  // 2) 저장: 새 버전(v2)으로 적용
  const saved = await (await post('/works/cms/criteria', { rule: learned.rule, sourceText: 'x', engine: learned.engine })).json();
  assert.equal(saved.activeVersion, 2);

  // 3) 산출
  const records = [
    { institution: '가온은행', month: '2026-07', item: '압류', count: 100 },
    { institution: '가온은행', month: '2026-08', item: '해제', count: 100 },
    { institution: '나래은행', month: '2026-09', item: '압류', count: 50 },
  ];
  const body = { workCode: 'cms', year: 2026, quarter: 3, totalFee: '1,000,000', records };
  const result = await (await post('/fees/calculate', body)).json();
  assert.equal(result.criteriaVersion, 2);
  // 균등 200,000 → 100,000씩 / 비례 800,000 × 150:50 → 600,000, 200,000
  assert.deepEqual(result.rows.map((r) => r.fee), [700000, 300000]);

  // 4) 엑셀
  const res = await post('/fees/export', body);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /filename\*=UTF-8''/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const ws = wb.getWorksheet('회비산출내역');
  assert.deepEqual(ws.getRow(4).values.slice(1, 5), ['금융기관명', '7월 실적건수', '8월 실적건수', '9월 실적건수']);
  assert.equal(ws.getCell('A5').value, '가온은행');
  assert.equal(ws.getRow(5).values.at(-2), 700000);
  assert.equal(ws.getCell('A7').value, '합계');
  assert.ok(wb.getWorksheet('산출기준'));

  // 5) 이전 버전으로 되돌리기
  const back = await (await post('/works/cms/criteria/1/activate', {})).json();
  assert.equal(back.activeVersion, 1);
});

test('실적 파일 업로드 API', async () => {
  const buf = fs.readFileSync(new URL('../samples/giro-2026q3.hwp', import.meta.url));
  const res = await fetch(`${base}/performance/parse?filename=giro.hwp&year=2026`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: buf });
  const out = await res.json();
  assert.equal(out.records.length, 18);
});

test('잘못된 규칙은 저장하지 않는다', async () => {
  const res = await post('/works/cms/criteria', { rule: { components: [{ name: 'x', ratio: 0.5, method: 'equal', tiers: [] }], rounding: { unit: 1 } } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /100%/);
});
