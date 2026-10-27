#!/usr/bin/env node
// 모듈 단위 녹화. 사용: node record.js [모듈 id ...]   (id 를 주지 않으면 modules/order.json 전부)
//   예) node record.js 30-upload 40-ai-issue     ← 두 모듈만 다시 찍는다
// 화면 모듈: 새 페이지에서 setup(상태 준비, 녹화 안 함) → run(녹화, beat 로 구간 표시)
// 카드 모듈: card.html 을 Chromium 에서 seconds 초 동안 녹화
// 출력: tools/out/modules/<id>.mp4 + <id>.json (길이, 비트 시작·끝 시각)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { Recorder } = require('./lib/recorder');
const ov = require('./lib/overlay');
const app = require('./lib/app');

const ROOT = path.join(__dirname, '..');
const MODULES = path.join(ROOT, 'modules');
const OUT = path.join(__dirname, 'out', 'modules');
const order = JSON.parse(fs.readFileSync(path.join(MODULES, 'order.json'), 'utf8')).map((m) => m.id);

function beatsFromMarkers(markers, duration) {
  const beats = [];
  for (const m of markers) {
    const [id, kind] = m.label.split(':');
    if (kind === 'start') beats.push({ id, start: m.t, end: duration });
    else if (kind === 'end') {
      const b = beats.find((x) => x.id === id);
      if (b) b.end = m.t;
    }
  }
  return beats;
}

async function recordCard(browser, id, mod) {
  const html = fs.readFileSync(path.join(MODULES, id, 'card.html'), 'utf8').replace(/LOGO_SRC/g, `file://${app.LOGO}`);
  const htmlPath = path.join(OUT, `${id}.card.html`);
  fs.writeFileSync(htmlPath, html);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const rec = new Recorder(page, OUT, id);
  await page.evaluate(() => { document.body.style.visibility = 'hidden'; });
  await rec.start();
  await page.waitForTimeout(250);
  // 보이게 하면서 CSS 애니메이션을 처음부터 다시 시작한다
  await page.evaluate(() => {
    document.querySelectorAll('[style*="animation-delay"], .anim').forEach((el) => {
      const a = el.style.animationDelay;
      el.style.animation = 'none';
      // eslint-disable-next-line no-unused-expressions
      el.offsetHeight;
      el.style.animation = '';
      el.style.animationDelay = a;
    });
    document.body.style.visibility = '';
  });
  await page.waitForTimeout(mod.seconds * 1000);
  const meta = await rec.stop();
  await page.close();
  return { ...meta, beats: [{ id: 'all', start: 0, end: meta.duration }] };
}

async function recordScreen(browser, id, mod) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`  [${id}] PAGEERROR`, e.message));
  const ctx = { page, ov, app, base: app.BASE, demo: app.demoFile, sample: app.SAMPLE, out: OUT };
  await page.goto(app.BASE, { waitUntil: 'networkidle' });
  await mod.setup(ctx);
  await ov.installOverlay(page);
  const rec = new Recorder(page, OUT, id);
  ctx.beat = async (bid, fn) => {
    rec.mark(`${bid}:start`);
    await fn();
    rec.mark(`${bid}:end`);
  };
  ctx.sleep = ov.sleep;
  await rec.start();
  await ov.sleep(500);
  await mod.run(ctx);
  await ov.sleep(600);
  const meta = await rec.stop();
  await context.close();
  return { ...meta, beats: beatsFromMarkers(meta.markers, meta.duration) };
}

(async () => {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const targets = ids.length ? ids : order;
  for (const id of targets) if (!order.includes(id)) throw new Error(`order.json 에 없는 모듈: ${id}`);
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const id of targets) {
      const mod = require(path.join(MODULES, id, 'module.js'));
      const t0 = Date.now();
      process.stdout.write(`▶ ${id} (${mod.kind}) … `);
      const meta = mod.kind === 'card' ? await recordCard(browser, id, mod) : await recordScreen(browser, id, mod);
      const json = { id, kind: mod.kind, duration: meta.duration, frames: meta.frames, beats: meta.beats };
      fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(json, null, 2));
      console.log(`${meta.duration.toFixed(1)}s, ${meta.beats.length} beats, ${((Date.now() - t0) / 1000).toFixed(0)}s 소요`);
      for (const b of meta.beats) console.log(`    ${b.id}: ${b.start.toFixed(1)} – ${b.end.toFixed(1)}`);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
