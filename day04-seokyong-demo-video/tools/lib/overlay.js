// 화면 위 연출 요소.
//  - 커서·클릭 리플: <html> 바로 아래(뷰포트 좌표, 줌 영향 없음)
//  - 스포트라이트(주변 어둡게 + 테두리)·번호 배지·펄스: <body> 안(줌과 함께 움직여 항상 대상 요소에 붙어 있음)
//  - 카메라 줌: body transform. focus()가 "대상 요소가 화면 위쪽 가운데에 오도록" 줌과 이동을 함께 계산한다
//    → 아래쪽 자막 패널과 겹치지 않고, 자막이 말하는 영역이 곧 밝게 남는 영역이 된다.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ACCENT = '#3B8BFF';
const EASE = 'cubic-bezier(.2,.8,.2,1)';

const CSS = `
#__cur { position: fixed; left: 0; top: 0; width: 30px; height: 30px; z-index: 2147483600; pointer-events: none; transform: translate(-3px,-2px); filter: drop-shadow(0 2px 4px rgba(0,0,0,.45)); }
#__ripple { position: fixed; width: 44px; height: 44px; border-radius: 50%; border: 3px solid ${ACCENT}; z-index: 2147483599; pointer-events: none; opacity: 0; transform: translate(-50%,-50%) scale(.4); }
#__ripple.go { animation: __rip 550ms ease-out forwards; }
@keyframes __rip { 0% { opacity: .9; transform: translate(-50%,-50%) scale(.4); } 100% { opacity: 0; transform: translate(-50%,-50%) scale(1.5); } }
#__spot { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 2147483500; pointer-events: none; border: 3px solid ${ACCENT}; border-radius: 14px;
  box-shadow: 0 0 0 9999px rgba(4,9,26,.58), 0 0 0 5px rgba(59,139,255,.28), 0 0 40px rgba(59,139,255,.55); opacity: 0;
  transition: left 650ms ${EASE}, top 650ms ${EASE}, width 650ms ${EASE}, height 650ms ${EASE}, opacity 320ms; }
#__spot.on { opacity: 1; }
#__badge { position: fixed; left: 0; top: 0; z-index: 2147483501; pointer-events: none; min-width: 36px; height: 36px; padding: 0 9px; box-sizing: border-box; border-radius: 18px; background: ${ACCENT}; color: #fff;
  font: 800 19px/36px 'Pretendard','Noto Sans KR',sans-serif; text-align: center; letter-spacing: -0.01em; box-shadow: 0 6px 18px rgba(0,0,0,.35); opacity: 0;
  transition: left 650ms ${EASE}, top 650ms ${EASE}, opacity 320ms; }
#__badge.on { opacity: 1; }
.__hl { position: fixed; z-index: 2147483502; pointer-events: none; border: 3px solid #FFB83B; border-radius: 10px; box-shadow: 0 0 0 4px rgba(255,184,59,.22), 0 0 26px rgba(255,184,59,.45); opacity: 0; transition: opacity 220ms; }
.__hl.on { opacity: 1; }
body { transform-origin: 0 0; transition: transform 750ms ${EASE}; }
html { overflow: hidden; }
`;

async function installOverlay(page) {
  await page.evaluate((css) => {
    if (!document.getElementById('__ovstyle')) {
      const style = document.createElement('style');
      style.id = '__ovstyle';
      style.textContent = css;
      document.head.appendChild(style);
    }
    const ensure = (id, parent, init) => {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        if (init) init(el);
        parent.appendChild(el);
      }
      return el;
    };
    const cur = ensure('__cur', document.documentElement, (el) => {
      el.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M5 3l14 8.5-6.2 1.3-3.4 5.6z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      el.style.left = '960px';
      el.style.top = '700px';
    });
    ensure('__ripple', document.documentElement);
    ensure('__spot', document.body);
    ensure('__badge', document.body);
    if (!window.__curPos) window.__curPos = { x: parseFloat(cur.style.left), y: parseFloat(cur.style.top) };
    if (!window.__zoom) window.__zoom = { s: 1, tx: 0, ty: 0 };
  }, CSS);
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

// 뷰포트 좌표(줌 반영된 실제 위치) — 커서·마우스용
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

// 요소의 "줌 전" 좌표 (body 안 요소 배치용). 현재 body transform 을 역산한다
const PRE_BOX = (el, pad) => {
  const r = el.getBoundingClientRect();
  const z = window.__zoom || { s: 1, tx: 0, ty: 0 };
  return { x: (r.left - z.tx) / z.s - pad, y: (r.top - z.ty) / z.s - pad, w: r.width / z.s + pad * 2, h: r.height / z.s + pad * 2 };
};

// main 영역 스크롤 (앱은 창 스크롤 없이 <main> 이 스크롤 컨테이너)
async function scrollMain(page, y, ms = 600) {
  await page.evaluate(({ y, ms }) => new Promise((res) => {
    const m = document.querySelector('main');
    if (!m) return res();
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
async function scrollToEl(page, locator, offset = 110, ms = 600) {
  const y = await locator.evaluate((el, offset) => {
    const m = document.querySelector('main');
    if (!m) return 0;
    const z = window.__zoom || { s: 1, tx: 0, ty: 0 };
    const r = el.getBoundingClientRect();
    const mr = m.getBoundingClientRect();
    return m.scrollTop + (r.top - mr.top) / z.s - offset;
  }, offset);
  await scrollMain(page, Math.max(0, y), ms);
}

// 스포트라이트 + 카메라: 대상 요소만 밝게 남기고, 요소가 화면 위쪽 가운데(anchorY)에 오도록 확대·이동한다.
// badge 를 주면 요소 왼쪽 위에 번호 배지를 붙인다 (자막 패널의 번호와 같은 번호).
async function focus(page, locator, {
  scale = 'auto', pad = 10, badge = null, anchorY = 0.43, settle = 900, maxScale = 1.6, minScale = 1, scroll = true, scrollOffset = 110,
} = {}) {
  if (scroll) await scrollToEl(page, locator, scrollOffset, 450).catch(() => {});
  const box = await locator.evaluate(PRE_BOX, pad);
  let s = scale === 'auto' ? Math.min(maxScale, (1920 * 0.8) / box.w, (1080 * 0.56) / box.h) : scale;
  s = Math.max(minScale, s);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let tx = 960 - s * cx;
  let ty = 1080 * anchorY - s * cy;
  tx = Math.min(0, Math.max(1920 - s * 1920, tx));
  ty = Math.min(0, Math.max(1080 - s * 1080, ty));
  await page.evaluate(({ box, s, tx, ty, badge }) => {
    const spot = document.getElementById('__spot');
    const b = document.getElementById('__badge');
    Object.assign(spot.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    spot.classList.add('on');
    if (badge != null) {
      b.textContent = String(badge);
      Object.assign(b.style, { left: `${box.x - 12}px`, top: `${box.y - 16}px` });
      b.classList.add('on');
    } else {
      b.classList.remove('on');
    }
    window.__zoom = { s, tx, ty };
    document.body.style.transform = s === 1 && tx === 0 && ty === 0 ? '' : `translate(${tx}px, ${ty}px) scale(${s})`;
  }, { box, s, tx, ty, badge });
  await sleep(settle);
  return { box, s, tx, ty };
}

// 스포트라이트를 끄고 카메라를 원위치 (zoom=false 면 줌은 유지)
async function unfocus(page, { zoom = true, settle = 700 } = {}) {
  await page.evaluate((zoom) => {
    document.getElementById('__spot')?.classList.remove('on');
    document.getElementById('__badge')?.classList.remove('on');
    if (zoom) {
      window.__zoom = { s: 1, tx: 0, ty: 0 };
      document.body.style.transform = '';
    }
  }, zoom);
  await sleep(settle);
}

// 스포트라이트 안의 세부 요소를 잠깐 강조 (노란 테두리)
async function pulse(page, locator, ms = 900, pad = 6) {
  const box = await locator.evaluate(PRE_BOX, pad).catch(() => null);
  if (!box) return;
  await page.evaluate(async ({ box, ms }) => {
    const h = document.createElement('div');
    h.className = '__hl';
    Object.assign(h.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    document.body.appendChild(h);
    requestAnimationFrame(() => h.classList.add('on'));
    await new Promise((r) => setTimeout(r, ms));
    h.classList.remove('on');
    setTimeout(() => h.remove(), 260);
  }, { box, ms });
}

module.exports = { sleep, installOverlay, moveTo, hover, click, typeInto, focus, unfocus, pulse, scrollMain, scrollToEl };
