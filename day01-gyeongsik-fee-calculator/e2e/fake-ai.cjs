// OpenAI Chat Completions 호환 가짜 AI 서버 (E2E 용). 프롬프트 내용을 보고 정해진 JSON 을 돌려준다.
const http = require('http');

const PORT = Number(process.env.FAKE_AI_PORT || 18080);
const log = [];

const FORMULA_ANSWER = {
  variables: [
    { name: 'withdrawCount', type: 'input', description: '출금이체 성공 건수' },
    { name: 'depositCount', type: 'input', description: '입금이체 성공 건수' },
    { name: 'rawCount', type: 'expr', expr: '#withdrawCount + #depositCount' },
    { name: 'tier1Limit', type: 'number', value: 1000000 },
    { name: 'tier2Limit', type: 'number', value: 3000000 },
    { name: 'tier1Unit', type: 'number', value: 20 },
    { name: 'tier2Unit', type: 'number', value: 15 },
    { name: 'tier3Unit', type: 'number', value: 10 },
  ],
  formula:
    '(#finalCount < #tier1Limit ? #finalCount : #tier1Limit) * #tier1Unit' +
    ' + (#finalCount > #tier1Limit ? (#finalCount < #tier2Limit ? #finalCount : #tier2Limit) - #tier1Limit : 0) * #tier2Unit' +
    ' + (#finalCount > #tier2Limit ? #finalCount - #tier2Limit : 0) * #tier3Unit',
  equalFormula: null,
  perfFormula: null,
  pattern: '출금이체·입금이체 성공 건수 합계에 구간별 차등 단가(20원/15원/10원) 적용',
  explanation: [
    "'출금이체·입금이체 성공 건을 실적으로 인정' → 실적 입력 withdrawCount, depositCount 두 개를 정의하고 rawCount = 둘의 합 (조회성 API 열은 쓰지 않음)",
    "'100만 건까지 20원, 300만 건까지 15원, 초과분 10원' → 구간 경계 tier1Limit·tier2Limit 와 단가 tier1Unit·tier2Unit·tier3Unit",
    "'구간은 최종 인정 건수 기준' → 차감을 뺀 finalCount 로 구간을 나눠 구간별 건수 × 단가를 더한다",
  ],
};

function layoutAnswer(user) {
  const withInputs = user.includes('[실적 항목]');
  return {
    sheet: 0,
    headerRow: 0,
    institutionColumn: 1,
    codeColumn: -1,
    dateSource: 'COLUMN',
    dateColumn: 0,
    valueColumns: withInputs
      ? [
          { column: 2, kind: 'COUNT', use: false },
          { column: 3, kind: 'COUNT', use: false },
          { column: 4, kind: 'COUNT', use: false },
          { column: 5, kind: 'COUNT', use: true, variable: 'withdrawCount' },
          { column: 6, kind: 'COUNT', use: true, variable: 'depositCount' },
        ]
      : [
          { column: 2, kind: 'COUNT', use: true },
          { column: 3, kind: 'COUNT', use: true },
          { column: 4, kind: 'COUNT', use: true },
          { column: 5, kind: 'COUNT', use: true },
          { column: 6, kind: 'COUNT', use: true },
        ],
    reason: withInputs ? '기준월·기관명 열, 출금이체·입금이체 열을 실적 항목에 연결' : '기준월·기관명 열과 API 종류별 건수 열',
  };
}

function answer(system, user) {
  if (system.includes('실적 엑셀 판독')) return layoutAnswer(user);
  if (system.includes('정산 수식 작성')) return FORMULA_ANSWER;
  if (system.includes('후처리')) return { script: 'allocate(fee)', explanation: ['기본 배분'] };
  return { ok: true, results: [] };
}

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'GET' && req.url.startsWith('/__log')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(log));
        return;
      }
      let payload = {};
      try {
        payload = JSON.parse(body || '{}');
      } catch {}
      const msgs = payload.messages || [];
      const system = msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      const user = msgs.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const content = JSON.stringify(answer(system, user));
      log.push({ url: req.url, model: payload.model, system: system.slice(0, 80), user: user.slice(0, 400) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'fake', object: 'chat.completion', model: payload.model || 'fake', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`fake AI on http://127.0.0.1:${PORT}`));
