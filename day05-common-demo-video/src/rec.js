// 시연 화면 녹화: CDP screencast로 장면별 프레임(JPEG)과 타임스탬프, 이벤트 마크를 저장한다.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'rec');
const URL = 'http://localhost:4173/';
const PW = process.env.APP_PW; // 저장소·파일에 남기지 않음
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const VW = 1600, VH = 900, DPR = 1.5;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// 실적 엑셀(저장소에 넣지 않음): CD_XLSX·OB_XLSX 환경변수로 경로를 준다. name 은 화면에 보일 파일명
const FILES = {
  cd: { name: 'CD공동망 테스트 실적.xlsx', path: process.env.CD_XLSX || path.join(__dirname, '..', 'data', 'cd.xlsx') },
  ob: { name: '오픈뱅킹 테스트 데이터.xlsx', path: process.env.OB_XLSX || path.join(__dirname, '..', 'data', 'ob.xlsx') },
};

const CURSOR = () => {
  const install = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div');
    c.id = '__cur';
    c.innerHTML = `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><path d="M2 2 L2 26 L8 20.5 L12.5 31 L17 29 L12.6 18.8 L21 18.8 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-100px,-100px)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))', transition: 'opacity .2s' });
    const r = document.createElement('div');
    r.id = '__rip';
    Object.assign(r.style, { position: 'fixed', left: '0', top: '0', width: '44px', height: '44px', marginLeft: '-22px', marginTop: '-22px', borderRadius: '50%', background: 'rgba(23,140,220,.35)', border: '2px solid rgba(23,140,220,.7)', zIndex: 2147483646, pointerEvents: 'none', opacity: '0', transform: 'scale(.3)' });
    document.documentElement.appendChild(r);
    document.documentElement.appendChild(c);
    let x = -100, y = -100;
    document.addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; c.style.transform = `translate(${x - 2}px,${y - 2}px)`; }, true);
    document.addEventListener('mousedown', () => {
      r.style.left = x + 'px'; r.style.top = y + 'px';
      r.animate([{ opacity: 1, transform: 'scale(.3)' }, { opacity: 0, transform: 'scale(1.4)' }], { duration: 550, easing: 'ease-out' });
      c.animate([{ transform: c.style.transform + ' scale(1)' }, { transform: c.style.transform + ' scale(.82)' }, { transform: c.style.transform + ' scale(1)' }], { duration: 220 });
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, acceptDownloads: true, locale: 'ko-KR' });
  const p = await ctx.newPage();
  await p.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await p.addInitScript(CURSOR);
  const cdp = await ctx.newCDPSession(p);

  let rec = null; // { name, frames: [], marks: {}, t0 }
  cdp.on('Page.screencastFrame', async (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    if (!rec) return;
    const i = rec.frames.length;
    const file = `${String(i).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(rec.dir, file), Buffer.from(f.data, 'base64'));
    rec.frames.push([f.metadata.timestamp, file]);
  });

  const mx = { x: VW / 2, y: VH / 2 };
  const start = async (name) => {
    const dir = path.join(OUT, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    rec = { name, dir, frames: [], marks: {}, t0: Date.now() / 1000 };
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
    // 첫 프레임을 확실히 받도록 커서를 살짝 움직인다
    await p.mouse.move(mx.x + 1, mx.y); await p.mouse.move(mx.x, mx.y);
    await sleep(150);
  };
  const mark = (k) => { if (rec) rec.marks[k] = Date.now() / 1000 - rec.t0; };
  const stop = async () => {
    await sleep(200);
    await cdp.send('Page.stopScreencast');
    await sleep(200);
    const meta = { name: rec.name, t0: rec.t0, end: Date.now() / 1000 - rec.t0, frames: rec.frames.map(([ts, f]) => [ts - rec.t0, f]), marks: rec.marks };
    fs.writeFileSync(path.join(rec.dir, 'meta.json'), JSON.stringify(meta));
    console.log(`[${rec.name}] ${meta.frames.length} frames, ${meta.end.toFixed(1)}s, marks`, JSON.stringify(rec.marks));
    rec = null;
  };

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const moveTo = async (x, y, ms = 650) => {
    const sx = mx.x, sy = mx.y;
    const n = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= n; i++) {
      const k = ease(i / n);
      await p.mouse.move(sx + (x - sx) * k, sy + (y - sy) * k);
      await sleep(ms / n);
    }
    mx.x = x; mx.y = y;
  };
  const center = async (loc, dx = 0.5, dy = 0.5) => {
    await loc.waitFor({ state: 'visible' });
    let b = await loc.boundingBox();
    // 화면 밖이면 보이는 위치까지 부드럽게 스크롤한 뒤 좌표를 다시 잰다
    if (b.y + b.height > VH - 40 || b.y < 90) {
      await wheel(b.y + b.height / 2 - VH * 0.6, 600);
      await sleep(250);
      b = await loc.boundingBox();
    }
    return [b.x + b.width * dx, b.y + b.height * dy];
  };
  const hover = async (loc, ms, dx, dy) => { const [x, y] = await center(loc, dx, dy); await moveTo(x, y, ms); };
  const click = async (loc, ms = 650, dx, dy) => {
    await hover(loc, ms, dx, dy);
    await sleep(120);
    await p.mouse.down(); await sleep(70); await p.mouse.up();
  };
  const type = async (loc, text, delay = 55) => { await click(loc); await sleep(150); await loc.pressSequentially(text, { delay }); };
  const wheel = async (dy, ms = 700) => {
    const n = Math.max(6, Math.round(ms / 16));
    let done = 0;
    for (let i = 1; i <= n; i++) {
      const target = dy * ease(i / n);
      await p.mouse.wheel(0, target - done); done = target;
      await sleep(ms / n);
    }
  };
  const nav = (t) => p.locator('aside button, aside a').filter({ hasText: t }).first();
  const upload = (key) => p.locator('input[type=file]').setInputFiles({ name: FILES[key].name, mimeType: XLSX_MIME, buffer: fs.readFileSync(FILES[key].path) });
  const scrollTop = async () => { await p.evaluate(() => { document.querySelectorAll('*').forEach((e) => { if (e.scrollTop) e.scrollTop = 0; }); window.scrollTo(0, 0); }); };
  const want = (n) => !ONLY || ONLY.includes(n);
  const login = async (id, slow) => {
    const idIn = p.locator('input').nth(0), pwIn = p.locator('input[type=password]');
    if (slow) {
      await type(idIn, id, 90); await sleep(200);
      await type(pwIn, PW, 70); await sleep(350);
      await click(p.getByRole('button', { name: /^로그인$/ }).first());
    } else {
      await idIn.fill(id); await pwIn.fill(PW); await p.keyboard.press('Enter');
    }
    await p.locator('aside').waitFor();
    await sleep(700);
  };

  // ───────── 장면 ─────────
  await p.goto(URL);
  await sleep(1500);

  // 01 로그인
  if (want('login')) {
    await moveTo(1180, 640, 10);
    await start('login');
    await sleep(1600);
    mark('typing');
    await login('admin', true);
    mark('in');
    await sleep(1200);
    await stop();
  } else {
    await login('admin', false);
  }

  // 02 회원 관리
  await click(nav('회원 관리'), 10); await scrollTop(); await sleep(600);
  if (want('members')) {
    await moveTo(900, 230, 10);
    await start('members');
    await sleep(900);
    await hover(p.getByText('가입 승인대기').first(), 700);
    await sleep(600);
    mark('approve');
    await click(p.locator('tr', { hasText: 'hana01' }).getByRole('button', { name: '승인' }), 900);
    await sleep(1600);
    mark('unlock');
    await click(p.locator('tr', { hasText: 'woori01' }).getByRole('button', { name: '잠금 해제' }), 800);
    await sleep(500);
    const ok = p.getByRole('dialog').getByRole('button', { name: /해제|확인/ });
    if (await ok.count()) { await click(ok.first(), 600); }
    await sleep(1800);
    await stop();
  }

  // 03 업무 권한 관리
  await click(nav('업무 권한 관리'), 10); await sleep(600);
  if (want('perm')) {
    await moveTo(800, 250, 10);
    await start('perm');
    await sleep(800);
    await hover(p.locator('tr', { hasText: 'kimms' }).first(), 700, 0.6);
    await sleep(500);
    mark('approve');
    await click(p.locator('tr', { hasText: 'kimms' }).first().getByRole('button', { name: '승인' }), 800);
    await sleep(1500);
    mark('grant');
    const hongRow = p.locator('tr', { hasText: 'hong' }).last();
    await click(hongRow.getByRole('button', { name: /부여/ }).nth(1), 900); // CD공동망
    await sleep(1800);
    await stop();
  }

  // 04 업무 관리
  await click(nav('업무 관리'), 10); await sleep(600);
  if (want('task')) {
    await moveTo(1100, 300, 10);
    await start('task');
    await sleep(700);
    await click(p.getByRole('button', { name: '업무 추가' }), 700);
    await sleep(500);
    mark('form');
    await type(p.getByPlaceholder('예: 지로'), '지로', 110);
    await sleep(250);
    await type(p.getByPlaceholder('예: GIRO'), 'GIRO', 90);
    await sleep(900);
    mark('create');
    await click(p.getByRole('button', { name: /업무 추가 및 md 파일 생성/ }), 800);
    await sleep(1800);
    mark('added');
    await hover(p.locator('tr', { hasText: 'GIRO' }).first(), 700, 0.3);
    await sleep(1000);
    mark('delete');
    await click(p.locator('tr', { hasText: 'GIRO' }).first().getByRole('button', { name: /삭제/ }), 800);
    await sleep(1200);
    await click(p.locator('input[type=checkbox]:visible').last(), 700);
    await sleep(400);
    await click(p.getByRole('button', { name: /삭제/ }).last(), 600);
    await sleep(1500);
    await stop();
  }

  // 05 CD공동망 산출
  await click(nav('업무 및 기간 선택'), 10); await scrollTop(); await sleep(800);
  if (want('cd')) {
    await moveTo(900, 300, 10);
    await start('cd');
    await sleep(700);
    await click(p.locator('select').first(), 700);
    await p.locator('select').first().selectOption({ label: 'CD공동망' });
    mark('task');
    await sleep(900);
    await click(p.getByText('2026년 3분기', { exact: true }), 700);
    mark('period');
    await sleep(600);
    await hover(p.getByText('CD공동망 회비분담기준 요약'), 800);
    mark('rules');
    await sleep(2400);
    await wheel(330, 800);
    await sleep(300);
    await click(p.getByText('Excel 파일을 끌어다'), 800);
    mark('upload');
    await upload('cd');
    await sleep(2600);
    mark('parsed');
    await hover(p.getByText('규칙 기반 판별').first(), 700);
    await sleep(1800);
    mark('issue');
    await type(p.locator('textarea').first(), '7월 15일 한빛은행 망 장애로 재처리된 12,000건은 실적에서 차감해 줘.', 38);
    await sleep(400);
    await click(p.getByRole('button', { name: /이슈 등록/ }), 600);
    await sleep(1600);
    mark('calc');
    await click(p.getByRole('button', { name: /AI 회비 초안/ }), 800);
    await sleep(4200);
    mark('result');
    await wheel(560, 1100);
    await sleep(1200);
    await hover(p.getByText(/특이사항 보정/).first(), 800);
    mark('badge');
    await sleep(2200);
    await wheel(2200, 1800);
    await sleep(300);
    mark('total');
    await hover(p.getByText('300,000,000원').last(), 900);
    await sleep(2200);
    await stop();
  }

  // 06 오픈뱅킹 산출 (미등록 기관 '울릉도' → 기관 관리 등록 → 다시 업로드)
  await scrollTop(); await sleep(400);
  if (want('ob')) {
    await moveTo(900, 300, 10);
    await start('ob');
    await sleep(600);
    await click(p.locator('select').first(), 700);
    await p.locator('select').first().selectOption({ label: '오픈뱅킹' });
    mark('task');
    await sleep(1200);
    await hover(p.getByText(/조회성 API/).first(), 700);
    await sleep(900);
    await wheel(330, 800);
    await sleep(200);
    await click(p.getByText('Excel 파일을 끌어다'), 700);
    mark('upload');
    await upload('ob');
    await sleep(2200);
    mark('unmatched');
    await hover(p.getByText(/기관을 찾지 못해 제외한/).first(), 800, 0.3);
    await sleep(1800);
    mark('goreg');
    await click(nav('기관 관리'), 800);
    await sleep(900);
    await click(p.getByRole('button', { name: '기관 추가' }).first(), 700);
    await sleep(500);
    mark('form');
    await type(p.getByPlaceholder('예: 새봄저축은행'), '울릉도', 110);
    await sleep(200);
    await type(p.getByPlaceholder('예: B099'), 'U001', 90);
    await sleep(700);
    mark('reg');
    await click(p.locator('button', { hasText: '기관 추가' }).last(), 700);
    await sleep(1600);
    mark('back');
    await click(nav('업무 및 기간 선택'), 800);
    await sleep(1200);
    await wheel(330, 700);
    await sleep(400);
    await click(p.getByTitle('파일 제거'), 600);
    await sleep(500);
    await click(p.getByText('Excel 파일을 끌어다'), 600);
    mark('reupload');
    await upload('ob');
    await sleep(2200);
    mark('chips');
    for (const name of ['거래내역조회', '계좌실명조회', '잔액조회']) {
      await click(p.getByRole('button', { name: new RegExp(`^${name}`) }).first(), 600);
      await sleep(500);
    }
    await sleep(1000);
    mark('calc');
    await click(p.getByRole('button', { name: /AI 회비 초안/ }), 800);
    await sleep(4200);
    mark('result');
    await wheel(560, 1100);
    await sleep(1500);
    mark('excel');
    const dl1 = p.waitForEvent('download').catch(() => null);
    await click(p.getByRole('button', { name: /참가기관 송부 대사용/ }).first(), 900);
    await dl1;
    await sleep(1300);
    const dl2 = p.waitForEvent('download').catch(() => null);
    await click(p.getByRole('button', { name: /수입결의용/ }).first(), 800);
    await dl2;
    await sleep(1800);
    await stop();
  }

  // 07 회비 기준 관리
  await click(nav('기준 문서 편집'), 10); await scrollTop(); await sleep(800);
  if (want('skill')) {
    await moveTo(450, 300, 10);
    await start('skill');
    await sleep(600);
    await click(p.getByText('CD_NET.md').first(), 700);
    mark('doc');
    await sleep(1600);
    await hover(p.getByText(/1\. 비즈니스 규칙 요약/).first(), 800);
    await sleep(1600);
    await wheel(450, 1000);
    mark('formula');
    await sleep(1800);
    await wheel(450, 1000);
    mark('special');
    await sleep(1800);
    await scrollTop();
    await sleep(300);
    mark('preview');
    await click(p.getByText('마크다운 확인 모드').first(), 800);
    await sleep(2400);
    mark('builder');
    await click(nav('AI 계산식 빌더'), 800);
    await sleep(800);
    await click(p.getByText('CD_NET.md').first(), 600);
    await sleep(900);
    await wheel(900, 1300);
    mark('sim');
    await sleep(2500);
    await wheel(700, 1000);
    await sleep(2500);
    await stop();
  }

  // 08 내 정보 관리
  await click(nav('기본 정보'), 10); await scrollTop(); await sleep(800);
  if (want('me')) {
    await moveTo(700, 250, 10);
    await start('me');
    await sleep(600);
    const ext = p.locator('input').filter({ hasNot: p.locator('[disabled]') }).nth(0);
    const extIn = p.locator('input[value*="02-531"]').first();
    await click(extIn, 700);
    await p.keyboard.press('Control+A');
    await sleep(150);
    await extIn.pressSequentially('02-531-1234', { delay: 80 });
    await sleep(400);
    mark('save');
    await click(p.getByRole('button', { name: '연락처 수정' }), 700);
    await sleep(1600);
    mark('perm');
    await click(nav('담당 업무 및 산출 권한'), 800);
    await sleep(2200);
    await stop();
  }

  // 09 일반 담당자 화면
  if (want('user')) {
    await click(p.getByRole('button', { name: /로그아웃/ }), 10);
    await sleep(1200);
    await moveTo(1180, 640, 10);
    await start('user');
    await sleep(500);
    await login('hong', true);
    mark('in');
    await sleep(900);
    await click(nav('기준 문서 편집'), 800);
    await sleep(1200);
    mark('locks');
    await hover(p.getByText('CD_NET.md').first(), 800);
    await sleep(1400);
    await click(p.getByText('CMS.md').first(), 700);
    mark('popup');
    await sleep(2400);
    await stop();
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
