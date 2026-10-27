// 실제 화면 시연을 한 테이크로 녹화한다. 비트 경계는 marker로 남겨 자막 타이밍에 쓴다.
// 사용: node record_demo.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { Recorder } = require('./recorder');

const WORK = path.join(__dirname, 'out');
const BASE = process.env.APP_URL || 'http://127.0.0.1:5173/';
// 시연용 실적 파일 폴더(저장소에 넣지 않음). make_demo_files.py 로 만든 4개 파일이 있어야 한다
const DEMO = process.env.DEMO_FILES_DIR || path.join(__dirname, '..', 'demo-files');
const APP = path.join(__dirname, '..', '..', 'day01-gyeongsik-fee-calculator');
const SAMPLE = path.join(APP, 'public', 'samples', 'fee-performance-sample.xlsx');
const PW = 'kftc1234!!';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 화면 위 연출 요소: 가짜 커서, 하이라이트 박스, 로어서드 자막, 줌 ──
async function installOverlay(page) {
  await page.evaluate(() => {
    if (document.getElementById('__cur')) return;
    const style = document.createElement('style');
    style.id = '__ovstyle';
    style.textContent = `
      #__cur { position: fixed; left: 0; top: 0; width: 30px; height: 30px; z-index: 2147483600; pointer-events: none; transform: translate(-3px,-2px); filter: drop-shadow(0 2px 4px rgba(0,0,0,.45)); }
      #__ripple { position: fixed; width: 44px; height: 44px; border-radius: 50%; border: 3px solid #178cdc; z-index: 2147483599; pointer-events: none; opacity: 0; transform: translate(-50%,-50%) scale(.4); }
      #__ripple.go { animation: __rip 550ms ease-out forwards; }
      @keyframes __rip { 0% { opacity: .9; transform: translate(-50%,-50%) scale(.4); } 100% { opacity: 0; transform: translate(-50%,-50%) scale(1.5); } }
      .__hl { position: fixed; z-index: 2147483500; pointer-events: none; border: 3px solid #178cdc; border-radius: 12px; box-shadow: 0 0 0 6px rgba(23,140,220,.18), 0 0 30px rgba(23,140,220,.35); opacity: 0; transition: opacity 250ms; }
      .__hl.on { opacity: 1; }
      #__lt { position: fixed; left: 56px; bottom: 52px; z-index: 2147483550; pointer-events: none; display: flex; flex-direction: column; gap: 6px; padding: 18px 28px 20px; border-radius: 16px; background: rgba(7,12,29,.82); color: #fff; font-family: 'Pretendard','Noto Sans KR',sans-serif; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(255,255,255,.12); opacity: 0; transform: translateY(18px); transition: opacity 420ms cubic-bezier(.2,.8,.2,1), transform 420ms cubic-bezier(.2,.8,.2,1); max-width: 980px; }
      #__lt.on { opacity: 1; transform: none; }
      #__lt .t { font-size: 38px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.15; }
      #__lt .s { font-size: 20px; font-weight: 500; color: #b9c6e6; letter-spacing: -0.005em; }
      #__lt .bar { width: 46px; height: 4px; border-radius: 2px; background: linear-gradient(90deg,#178cdc,#6ea8ff); margin-top: 4px; }
      body { transition: transform 750ms cubic-bezier(.2,.8,.2,1); }
      html { overflow: hidden; }
    `;
    document.head.appendChild(style);
    const cur = document.createElement('div');
    cur.id = '__cur';
    cur.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M5 3l14 8.5-6.2 1.3-3.4 5.6z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(cur); // body 줌(transform)의 영향을 받지 않도록 html 바로 아래에 둔다
    const rip = document.createElement('div');
    rip.id = '__ripple';
    document.documentElement.appendChild(rip);
    const lt = document.createElement('div');
    lt.id = '__lt';
    lt.innerHTML = '<div class="t"></div><div class="s"></div><div class="bar"></div>';
    document.documentElement.appendChild(lt);
    window.__curPos = { x: 960, y: 540 };
    cur.style.left = '960px';
    cur.style.top = '540px';
  });
}

async function moveTo(page, x, y, ms = 650) {
  await page.evaluate(async ({ x, y, ms }) => {
    const cur = document.getElementById('__cur');
    const from = { ...window.__curPos };
    const t0 = performance.now();
    await new Promise((res) => {
      const step = () => {
        const p = Math.min(1, (performance.now() - t0) / ms);
        const e = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
        const cx = from.x + (x - from.x) * e;
        const cy = from.y + (y - from.y) * e;
        cur.style.left = `${cx}px`;
        cur.style.top = `${cy}px`;
        window.__curPos = { x: cx, y: cy };
        if (p < 1) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
    });
  }, { x, y, ms });
  await page.mouse.move(x, y);
}

async function center(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('no box for locator');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function hover(page, locator, ms = 650) {
  const c = await center(locator);
  await moveTo(page, c.x, c.y, ms);
  return c;
}

async function click(page, locator, { ms = 650, settle = 350 } = {}) {
  const c = await hover(page, locator, ms);
  await page.evaluate(({ x, y }) => {
    const r = document.getElementById('__ripple');
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    r.classList.remove('go');
    // eslint-disable-next-line no-unused-expressions
    r.offsetHeight;
    r.classList.add('go');
  }, { x: c.x, y: c.y });
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  await sleep(settle);
}

async function typeInto(page, locator, text, delay = 48) {
  await click(page, locator, { settle: 150 });
  await page.keyboard.type(text, { delay });
}

async function highlight(page, locator, ms = 1300, pad = 8) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) return;
  await page.evaluate(async ({ box, ms, pad }) => {
    const h = document.createElement('div');
    h.className = '__hl';
    h.style.left = `${box.x - pad}px`;
    h.style.top = `${box.y - pad}px`;
    h.style.width = `${box.width + pad * 2}px`;
    h.style.height = `${box.height + pad * 2}px`;
    document.documentElement.appendChild(h);
    requestAnimationFrame(() => h.classList.add('on'));
    await new Promise((r) => setTimeout(r, ms));
    h.classList.remove('on');
    setTimeout(() => h.remove(), 300);
  }, { box, ms, pad });
}

async function lowerThird(page, title, sub) {
  await page.evaluate(({ title, sub }) => {
    const lt = document.getElementById('__lt');
    lt.querySelector('.t').textContent = title;
    lt.querySelector('.s').textContent = sub || '';
    lt.querySelector('.s').style.display = sub ? '' : 'none';
    lt.classList.add('on');
  }, { title, sub });
}
async function hideLowerThird(page) {
  await page.evaluate(() => document.getElementById('__lt').classList.remove('on'));
}

// 카메라 푸시인: body를 요소 중심으로 확대한다 (앱은 창 스크롤이 없어 뷰포트 좌표를 그대로 쓸 수 있다)
async function zoom(page, scale, locator) {
  let origin = '50% 50%';
  if (locator) {
    const box = await locator.boundingBox();
    if (box) origin = `${box.x + box.width / 2}px ${box.y + box.height / 2}px`;
  }
  await page.evaluate(({ scale, origin }) => {
    document.body.style.transformOrigin = origin;
    document.body.style.transform = scale === 1 ? '' : `scale(${scale})`;
  }, { scale, origin });
  await sleep(800);
}

async function scrollMain(page, y, ms = 600) {
  await page.evaluate(({ y, ms }) => new Promise((res) => {
    const m = document.querySelector('main');
    const from = m.scrollTop;
    const t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      const e = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
      m.scrollTop = from + (y - from) * e;
      if (p < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  }), { y, ms });
}
async function scrollToEl(page, locator, offset = 24, ms = 600) {
  const y = await locator.evaluate((el, offset) => {
    const m = document.querySelector('main');
    const r = el.getBoundingClientRect();
    const mr = m.getBoundingClientRect();
    return m.scrollTop + (r.top - mr.top) - offset;
  }, offset);
  await scrollMain(page, Math.max(0, y), ms);
}

async function login(page, id, { typing = false } = {}) {
  if (typing) {
    await typeInto(page, page.getByPlaceholder('사번 입력'), id, 70);
    await typeInto(page, page.getByPlaceholder('비밀번호 입력'), PW, 45);
    await click(page, page.locator('button[type=submit]'));
  } else {
    await page.getByPlaceholder('사번 입력').fill(id);
    await page.getByPlaceholder('비밀번호 입력').fill(PW);
    await page.locator('button[type=submit]').click();
  }
  await page.waitForTimeout(1800);
}
const menu = (page, label) => page.locator('aside button', { hasText: label }).first();
const upload = async (page, file) => {
  await page.locator('input[type=file]').setInputFiles({ name: path.basename(file), mimeType: XLSX_MIME, buffer: fs.readFileSync(file) });
  await page.waitForResponse((r) => r.url().includes('/api/fee/uploads'), { timeout: 30000 });
  await page.waitForTimeout(600);
};
const calcAndWait = async (page) => {
  // 응답이 클릭 직후 바로 올 수 있으므로 대기를 먼저 건다
  const resp = page.waitForResponse((r) => r.url().includes('/api/v1/fees/calculate'), { timeout: 60000 });
  await page.locator('button', { hasText: /AI 회비 초안/ }).click();
  await resp;
  await page.waitForTimeout(3000);
};

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

  // ── 사전 준비 (녹화 전): CD공동망·타행환·금거정(기업회계)·CMS(예시 파일) 산출을 미리 만들어 둔다 ──
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await login(page, 'admin');
  await menu(page, '회비 산출 및 대사').click();
  await page.waitForTimeout(1200);
  const sel = page.locator('select').first();
  const pre = [
    ['cd', `${DEMO}/CD공동망 테스트 실적.xlsx`, ['한빛은행 공동망 장애로 재처리된 2,000건 차감해 줘', '미래온은행 자체 ATM 장애로 고객이 다시 시도한 300건도 빼 줘']],
    ['interbank', `${DEMO}/타행환 테스트 실적.xlsx`, []],
    ['fininfo', `${DEMO}/기업회계 테스트 실적.xlsx`, []],
    ['cms', SAMPLE, []],
  ];
  for (const [biz, file, issues] of pre) {
    await sel.selectOption(biz);
    await page.waitForTimeout(700);
    await upload(page, file);
    for (const text of issues) {
      await page.locator('#calc-input textarea').fill(text);
      await page.locator('#calc-input button', { hasText: '이슈 등록' }).click();
      await page.waitForTimeout(300);
    }
    await calcAndWait(page);
    console.log('pre-run done:', biz);
  }
  await sel.selectOption('openbanking');
  await page.waitForTimeout(500);
  await page.locator('header button', { hasText: '로그아웃' }).click();
  await page.waitForTimeout(1500);
  await page.mouse.move(960, 700);

  // ── 녹화 시작: B2 로그인 → 기준 문서 ──
  await installOverlay(page);
  const rec = new Recorder(page, WORK, 'demo');
  await rec.start();
  await sleep(600);
  rec.mark('B2 규칙 문서');
  await login(page, 'admin', { typing: true });
  await installOverlay(page);
  await lowerThird(page, '규칙은 문서 한 장', 'skill.md · 4섹션 표준');
  await click(page, menu(page, '① 기준 문서 편집'));
  await page.waitForTimeout(900);
  const heads = ['## 1. 비즈니스 규칙 요약', '## 2. AI 예외 차감 지침', '## 3. 정산 수식', '## 4. 최종 정산 특이사항'];
  for (const h of heads) {
    const el = page.locator('main', { hasText: h }).locator(`text=${h}`).first();
    await scrollToEl(page, el, 90, 700);
    await sleep(250);
    await highlight(page, el, 1000, 10);
    await sleep(250);
  }
  await hideLowerThird(page);
  await sleep(300);

  // ── B3 AI 계산식 빌더 ──
  rec.mark('B3 AI 수식');
  await click(page, menu(page, '② AI 계산식 빌더'));
  await page.waitForTimeout(900);
  await lowerThird(page, '문장이 수식이 된다', '1번 규칙 → 3번 정산 수식 · 3단계 검증');
  const gen = page.locator('main button', { hasText: '계산식 자동 생성' }).first();
  await click(page, gen, { settle: 400 });
  await page.waitForTimeout(1800);
  const panel2 = page.locator('main section', { hasText: 'AI 생성 수식 및 해석 결과' }).first();
  await scrollToEl(page, panel2, 24, 700);
  await sleep(300);
  await zoom(page, 1.22, panel2.locator('div', { hasText: '감지된 산정 유형' }).first());
  await sleep(2200);
  await zoom(page, 1, null);
  const panel3 = page.locator('main section', { hasText: '3단계 검증' }).first();
  await scrollToEl(page, panel3, 24, 700);
  await sleep(400);
  for (const t of ['① 섹션 유효성', '② 수식 구문 검사', '③ 시험 계산 2벌']) {
    await highlight(page, panel3.locator(`text=${t}`).first(), 700, 10);
  }
  const confirmBtn = panel3.locator('button', { hasText: '확정 반영' }).first();
  await hover(page, confirmBtn, 600);
  await highlight(page, confirmBtn, 900, 6);
  await hideLowerThird(page);
  await sleep(300);

  // ── B4 업로드 ──
  rec.mark('B4 업로드');
  await click(page, menu(page, '회비 산출 및 대사'));
  await page.waitForTimeout(900);
  await lowerThird(page, '어떤 엑셀이든', '형식 자유 업로드 · 50개 기관 · 3개월 · 150행');
  await highlight(page, page.locator('#calc-period').locator('text=산출 기간').first(), 900, 10);
  const dropzone = page.locator('#calc-input button.border-dashed').first();
  await scrollToEl(page, page.locator('#calc-input'), 24, 700);
  await hover(page, dropzone, 700);
  await sleep(300);
  await upload(page, `${DEMO}/오픈뱅킹 테스트 실적.xlsx`);
  await sleep(700);
  const badge = page.locator('#calc-input', { hasText: '판별' }).locator('div.rounded-md.border').first();
  await zoom(page, 1.3, badge);
  await sleep(2000);
  await zoom(page, 1, null);
  await sleep(200);
  for (const h of ['거래내역조회', '계좌실명조회', '잔액조회']) {
    await click(page, page.locator('#calc-input button[aria-pressed=true]', { hasText: h }), { ms: 450, settle: 350 });
  }
  await highlight(page, page.locator('#calc-input p', { hasText: '합계' }).first(), 1200, 8);
  await hideLowerThird(page);
  await sleep(300);

  // ── B5 AI 이슈 ──
  rec.mark('B5 AI 이슈');
  await lowerThird(page, '말로 하는 예외 처리', '지침에 맞는 이슈만 차감');
  await sleep(700);
  const ta = page.locator('#calc-input textarea');
  await typeInto(page, ta, '한빛은행 시스템 장애로 중복 전송된 1,500건은 실적에서 제외해 줘', 52);
  await sleep(400);
  await click(page, page.locator('#calc-input button', { hasText: '이슈 등록' }), { ms: 450 });
  await highlight(page, page.locator('#calc-input :text("1,500건")').last(), 1100, 6);
  await typeInto(page, ta, '가온은행 이용기관 쪽 잘못된 계좌번호로 실패한 800건도 빼 줘', 40);
  await sleep(400);
  await click(page, page.locator('#calc-input button', { hasText: '이슈 등록' }), { ms: 450 });
  await highlight(page, page.locator('#calc-input :text("800건")').last(), 1300, 6);
  await hideLowerThird(page);
  await sleep(300);

  // ── B6 산출·검증 ──
  rec.mark('B6 산출·검증');
  await lowerThird(page, '1원까지 맞는 결과', '2단계 정산 · 수식 → 특이사항 스크립트 → 검증');
  const calcResp = page.waitForResponse((r) => r.url().includes('/api/v1/fees/calculate'), { timeout: 60000 });
  await click(page, page.locator('button', { hasText: /AI 회비 초안/ }), { settle: 200 });
  await scrollToEl(page, page.locator('#calc-result'), 24, 600);
  await calcResp;
  await sleep(2800);
  const hanbit = page.locator('#calc-result tr', { hasText: '한빛은행' }).first();
  await highlight(page, hanbit, 1300, 4);
  const excluded = page.locator('#calc-result', { hasText: '차감하지 않은 이슈' }).locator('div.rounded-lg', { hasText: '차감하지 않은 이슈' }).first();
  await scrollToEl(page, excluded, 500, 600);
  await highlight(page, excluded, 1400, 8);
  // CD공동망 결과로 컷
  await scrollMain(page, 0, 500);
  await click(page, sel, { ms: 500, settle: 150 });
  await sel.selectOption('cd');
  await sleep(700);
  await lowerThird(page, '합계 300,000,000원 ✓', 'CD공동망 · 30% 균등 + 70% 실적 비례 · 10원 절상 · 차이분 절삭');
  await scrollToEl(page, page.locator('#calc-result'), 24, 600);
  await sleep(300);
  const special = page.locator('#calc-result div', { hasText: '최종 정산 특이사항 반영' }).locator('xpath=ancestor-or-self::div[contains(@class,"rounded-lg")]').first();
  await highlight(page, special, 1500, 8);
  const plus = page.locator('#calc-result span', { hasText: '특이사항 보정' }).first();
  await hover(page, plus, 600);
  await sleep(1500);
  const minus = page.locator('#calc-result span', { hasText: '절삭' }).first();
  await hover(page, minus, 600);
  await sleep(1300);
  await hideLowerThird(page);
  await sleep(200);

  // ── B7 대사: 엑셀 2종 → 타행환·기업회계 몽타주 → 참가기관 회신 ──
  rec.mark('B7 대사');
  await lowerThird(page, '대사까지 한 번에', '대사용 · 수입결의용 엑셀 2종 → 참가기관 회신');
  await scrollMain(page, 0, 300);
  await scrollToEl(page, page.locator('#calc-result'), 24, 500);
  const dl1 = page.locator('#calc-result button', { hasText: '대사용 Excel' }).first();
  const dl2 = page.locator('#calc-result button', { hasText: '수입결의용 Excel' }).first();
  const [d1] = await Promise.all([page.waitForEvent('download').catch(() => null), click(page, dl1, { ms: 500, settle: 400 })]);
  const [d2] = await Promise.all([page.waitForEvent('download').catch(() => null), click(page, dl2, { ms: 450, settle: 400 })]);
  if (d1) await d1.saveAs(path.join(WORK, '대사용.xlsx')).catch(() => {});
  if (d2) await d2.saveAs(path.join(WORK, '수입결의용.xlsx')).catch(() => {});
  await sleep(300);
  await scrollMain(page, 0, 300);
  await sel.selectOption('interbank');
  await sleep(500);
  await scrollToEl(page, page.locator('#calc-result'), 24, 400);
  await sleep(1300);
  await scrollMain(page, 0, 300);
  await sel.selectOption('fininfo');
  await sleep(500);
  await scrollToEl(page, page.locator('#calc-result'), 24, 400);
  await sleep(1300);
  await hideLowerThird(page);
  await sleep(400);
  rec.mark('B7b 참가기관');
  await click(page, page.locator('header button', { hasText: '로그아웃' }), { ms: 500 });
  await page.waitForTimeout(900);
  await installOverlay(page);
  await login(page, 'shinhan', { typing: true });
  await installOverlay(page);
  await lowerThird(page, '참가기관은 자기 회비만', '신한은행 담당자 · 이상 없음 / 이의 제기');
  await click(page, page.locator('select').first(), { ms: 500, settle: 150 });
  await page.locator('select').first().selectOption('cms');
  await sleep(700);
  await scrollToEl(page, page.locator('#calc-result'), 24, 600);
  await sleep(600);
  const ok = page.locator('#calc-result button', { hasText: '이상 없음' }).first();
  await click(page, ok, { ms: 650, settle: 300 });
  await sleep(1800);
  await hideLowerThird(page);
  await sleep(700);
  rec.mark('END');
  const meta = await rec.stop();
  console.log('demo frames', meta.frames, 'duration', meta.duration.toFixed(2));
  console.log(JSON.stringify(meta.markers, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
