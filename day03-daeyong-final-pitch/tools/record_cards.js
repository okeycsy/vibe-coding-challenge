// 키노트 카드 4장을 각각 세그먼트로 녹화한다. 사용: node record_cards.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { Recorder } = require('./recorder');

const WORK = path.join(__dirname, 'out');
const LOGO = path.join(__dirname, '..', '..', 'day01-gyeongsik-fee-calculator', 'public', 'kftc-symbol.png');
const CARDS = [
  { id: 'c0', seconds: 14.5 },
  { id: 'c1', seconds: 10 },
  { id: 'c8', seconds: 12.5 },
  { id: 'c9', seconds: 8 },
];

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const html = fs.readFileSync(path.join(__dirname, 'cards.html'), 'utf8').replace('LOGO_SRC', 'file://' + LOGO);
  const htmlPath = path.join(WORK, 'cards.html');
  fs.writeFileSync(htmlPath, html);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const only = process.env.ONLY; // 예: ONLY=c8 → 한 장만
  for (const c of CARDS.filter((x) => !only || x.id === only)) {
    await page.goto('about:blank');
    await page.goto(`file://${htmlPath}#${c.id}`, { waitUntil: 'load' });
    // 애니메이션이 시작되기 전에 녹화를 켠다: 카드는 렌더 직후부터 animation-delay로 움직인다
    await page.evaluate(() => document.fonts.ready);
    const rec = new Recorder(page, WORK, c.id);
    await page.evaluate(() => { document.querySelectorAll('.card').forEach((el) => (el.style.visibility = 'hidden')); });
    await rec.start();
    await page.waitForTimeout(250);
    // 보이게 하면서 애니메이션을 다시 시작한다
    await page.evaluate(() => {
      document.querySelectorAll('.card.show [style*="animation-delay"], .card.show .line, .card.show .logo, .card.show .title, .card.show .slogan, .card.show .accent, .card.show .stat, .card.show .stat-foot, .card.show .url, .card.show .eyebrow').forEach((el) => {
        const a = el.style.animationDelay;
        el.style.animation = 'none';
        // eslint-disable-next-line no-unused-expressions
        el.offsetHeight;
        el.style.animation = '';
        el.style.animationDelay = a;
      });
      document.querySelectorAll('.card').forEach((el) => (el.style.visibility = ''));
    });
    await page.waitForTimeout(c.seconds * 1000);
    const meta = await rec.stop();
    console.log(c.id, 'frames', meta.frames, 'duration', meta.duration.toFixed(2));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
