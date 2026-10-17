// 회비자동산출 AI툴 API 서버.
// 프론트(Vite) 개발 서버는 /api를 이쪽으로 넘기고, 빌드 후에는 이 서버가 dist도 함께 내보낸다.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { calculateFees } from './engine/calculate.js';
import { learnCriteria, MODEL } from './engine/learn.js';
import { describeRule, validateRule } from './engine/rules.js';
import { periodLabel } from './engine/period.js';
import { buildWorkbook } from './export.js';
import { ACCEPT, parsePerformanceFile } from './parsers/index.js';
import * as store from './store.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  const route = (fn) => async (req, res) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined) res.json(out);
    } catch (e) {
      res.status(e.status ?? 400).json({ error: e.message });
    }
  };

  app.get('/api/health', route(() => ({
    ok: true,
    aiEngine: process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? MODEL : 'rule-based',
    accept: ACCEPT,
  })));

  // 업무와 분담기준
  app.get('/api/works', route(() => store.listWorks().map(withDescription)));
  app.post('/api/works', route((req) => withDescription(store.addWork(req.body))));
  app.get('/api/works/:code/criteria', route((req) => {
    const w = store.getWork(req.params.code);
    return { code: w.code, name: w.name, activeVersion: w.activeVersion, versions: [...w.versions].reverse().map((v) => ({ ...v, description: describeRule(v.rule) })) };
  }));
  // 학습: 기준 문장 → 규칙 초안 (저장하지 않음)
  app.post('/api/works/:code/criteria/learn', route(async (req) => {
    const w = store.getWork(req.params.code);
    const out = await learnCriteria({ workName: w.name, text: req.body?.text, hint: req.body?.hint });
    return { ...out, description: out.errors.length ? [] : describeRule(out.rule) };
  }));
  // 확인한 규칙을 새 버전으로 저장·적용
  app.post('/api/works/:code/criteria', route((req) => withDescription(store.saveCriteria(req.params.code, req.body ?? {}))));
  app.post('/api/works/:code/criteria/:version/activate', route((req) => withDescription(store.activateVersion(req.params.code, req.params.version))));
  app.post('/api/rules/validate', route((req) => {
    const { rule, errors } = validateRule(req.body?.rule);
    return { rule, errors, description: errors.length ? [] : describeRule(rule) };
  }));

  // 실적 파일 업로드: 바이너리 본문, 파일명은 쿼리로
  app.post('/api/performance/parse',
    express.raw({ type: () => true, limit: '20mb' }),
    route(async (req) => {
      const filename = String(req.query.filename ?? '');
      if (!req.body?.length) throw new Error('파일이 비어 있습니다.');
      return parsePerformanceFile(filename, req.body, { year: Number(req.query.year) || undefined });
    }));

  app.post('/api/fees/calculate', route((req) => runCalculation(req.body).result));

  app.post('/api/fees/export', route(async (req, res) => {
    const ctx = runCalculation(req.body);
    const buf = await buildWorkbook(ctx);
    const name = `${ctx.work.name}_${periodLabel(ctx.result.period.year, ctx.result.period.quarter)}_회비산출내역.xlsx`.replace(/\s+/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="fee.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(Buffer.from(buf));
  }));

  // 빌드된 프론트
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return app;
}

function withDescription(w) {
  return { ...w, description: w.rule ? describeRule(w.rule) : [] };
}

function runCalculation(body = {}) {
  const { workCode, year, quarter, totalFee, records } = body;
  if (!Array.isArray(records) || !records.length) throw new Error('실적 데이터가 없습니다. 실적 파일을 먼저 올려 주세요.');
  const { work, version } = store.activeRule(workCode);
  const result = calculateFees({ rule: version.rule, records, year, quarter, totalFee });
  return { work, version, result: { ...result, work: { code: work.code, name: work.name }, criteriaVersion: version.version } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8787;
  createApp().listen(port, () => {
    console.log(`회비자동산출 API: http://localhost:${port}`);
    console.log(process.env.ANTHROPIC_API_KEY ? `분담기준 학습: Claude (${MODEL})` : '분담기준 학습: 규칙 기반 해석기 (ANTHROPIC_API_KEY 미설정)');
  });
}
