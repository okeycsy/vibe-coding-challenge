// E2E: 가짜 AI 서버 + 백엔드(8085) + Vite(5173) 위에서 ① AI 생성 → ② 확정 반영 → ③ 실적 엑셀 업로드·열 연결 → ④ 산출 까지 돌려 본다.
const { chromium } = require('playwright');
const path = require('path');

const DIR = __dirname;
const SHOT = process.env.E2E_SHOTS || path.join(DIR, 'shots');
require('fs').mkdirSync(SHOT, { recursive: true });
const XLSX = path.join(DIR, 'openbanking-api-2026q3.xlsx');
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5173/';
const API = process.env.E2E_API || 'http://127.0.0.1:8085';

const EXPECT = {
  신한은행: { withdraw: 863285, deposit: 550260, fee: 26203175 },
  NH농협은행: { withdraw: 1071304, deposit: 589233, fee: 29908055 },
};

function check(cond, msg) {
  if (!cond) throw new Error('E2E 실패: ' + msg);
  console.log('  ✔ ' + msg);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  // 본문(main)이 스크롤 영역이라 전체 화면을 찍을 때는 잠시 펼친다
  const expand = (on) =>
    page.evaluate((on) => {
      const main = document.querySelector('main');
      const root = document.querySelector('.h-screen');
      if (main) main.style.overflow = on ? 'visible' : '';
      if (root) root.style.height = on ? 'auto' : '';
    }, on);
  const shot = async (name) => {
    await expand(true);
    await page.screenshot({ path: path.join(SHOT, name), fullPage: true });
    await expand(false);
  };

  // ── 매번 같은 출발점: 오픈뱅킹 기준을 초기 상태로 되돌린다 ──
  const reset = await page.request.post(`${API}/api/v1/skills/OPEN_BANKING/reset`, { headers: { 'X-Employee-Id': 'admin' } });
  check(reset.ok(), '오픈뱅킹 skill.md 초기화');

  // ── 로그인 ──
  await page.goto(BASE);
  await page.getByPlaceholder('사번 입력').fill('admin');
  await page.getByPlaceholder('비밀번호 입력').fill('kftc1234!!');
  await page.getByRole('button', { name: /로그인/ }).first().click();
  await page.getByRole('button', { name: '회비기준(Skill.md) 관리', exact: true }).waitFor({ timeout: 20000 });
  console.log('1) 로그인 OK');

  // ── 계산식 빌더 ──
  await page.getByRole('button', { name: '회비기준(Skill.md) 관리', exact: true }).click();
  await page.getByRole('tab', { name: /② AI 계산식 빌더/ }).click();
  await page.getByRole('button', { name: /오픈뱅킹/ }).first().click();
  const gen = page.getByRole('button', { name: /1번 비즈니스 규칙 읽고 변수·계산식 자동 생성/ });
  await gen.waitFor();
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('변수·계산식 자동 생성'));
    return b && !b.disabled;
  }, null, { timeout: 20000 });
  await shot('01-builder-before.png');
  await gen.click();
  const varsBox = page.getByLabel('변수 정의');
  await page.waitForFunction(() => (document.querySelector('textarea[aria-label="변수 정의"]')?.value || '').includes('withdrawCount'), null, { timeout: 30000 });
  const varsText = await varsBox.inputValue();
  check(varsText.includes('withdrawCount = input("출금이체 성공 건수")'), 'AI 가 실적 입력 변수 withdrawCount 를 정의');
  check(varsText.includes('rawCount = #withdrawCount + #depositCount'), 'AI 가 rawCount 파생 수식을 정의');
  check(varsText.includes('tier2Unit = 15'), 'AI 가 단가 상수를 변수로 정의');
  const body = await page.textContent('body');
  check(body.includes('#tier1Limit'), '수식 편집기에 변수 기반 SpEL 이 들어감');
  check(!body.includes('지원 패턴'), '패턴 안내 문구 없음');
  await page.waitForTimeout(500);
  await shot('02-builder-generated.png');
  console.log('2) AI 생성 OK');

  // 시뮬레이션 결과(첫 기관 회비)가 표시되는지
  check(body.includes('시뮬레이션') || body.includes('시험'), '시뮬레이션 영역 표시');

  // ── 확정 반영 ──
  await page.getByRole('button', { name: /이 변수·수식을 확정 반영/ }).click();
  await page.getByText(/변수 정의와 정산 수식을 반영했습니다/).waitFor({ timeout: 20000 });
  await shot('03-builder-applied.png');
  console.log('3) 확정 반영 OK');

  // 서버에 저장된 skill.md 확인
  const detail = (await (await page.request.get(`${API}/api/v1/skills/OPEN_BANKING`, { headers: { 'X-Employee-Id': 'admin' } })).json()).data;
  check(detail.content.includes('```variables'), '저장된 skill.md 에 ```variables 블록');
  check(detail.inputs.length === 2, '저장된 기준의 실적 입력 2개');

  // ── 회비 산출 ──
  await page.getByRole('button', { name: '회비 산출 및 대사', exact: true }).click();
  await page.getByLabel('업무 선택').waitFor();
  await page.getByLabel('업무 선택').selectOption({ label: '오픈뱅킹' });
  const dates = page.getByPlaceholder('YYYY-MM-DD');
  await dates.nth(0).fill('2026-07-01');
  await dates.nth(1).fill('2026-09-30');
  await page.keyboard.press('Escape');
  await page.getByText(/산출 기간 2026년 3분기/).waitFor();
  await page.locator('input[type="file"]').setInputFiles(XLSX);
  await page.getByText('openbanking-api-2026q3.xlsx', { exact: true }).waitFor({ timeout: 30000 });
  await page.getByText(/실적 항목별로 더할 열/).waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  await shot('04-upload-mapping.png');
  // 연결 상태: 출금이체 성공 건수 → 출금이체 열, 입금이체 성공 건수 → 입금이체 열, 조회성 열은 제외
  const rows = await page.evaluate(() => {
    const out = {};
    for (const row of document.querySelectorAll('div.flex.flex-wrap.items-center.gap-1')) {
      const label = row.querySelector('span')?.textContent?.trim();
      const pressed = [...row.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent.replace(/건수$/, '').trim());
      if (label) out[label] = pressed;
    }
    return out;
  });
  console.log('   mapping =', JSON.stringify(rows));
  const w = Object.entries(rows).find(([k]) => k.startsWith('출금이체 성공 건수'));
  const d = Object.entries(rows).find(([k]) => k.startsWith('입금이체 성공 건수'));
  check(w && w[1].length === 1 && w[1][0].startsWith('출금이체'), '출금이체 성공 건수 ← 출금이체 열');
  check(d && d[1].length === 1 && d[1][0].startsWith('입금이체'), '입금이체 성공 건수 ← 입금이체 열');
  const body2 = await page.textContent('body');
  check(body2.includes('863,285') && body2.includes('550,260'), '신한은행 항목별 건수(863,285 / 550,260) 표시');
  console.log('4) 업로드·열 연결 OK');

  // 열을 손으로 옮겨 보고(거래내역조회 → 출금이체 항목) 다시 되돌린다
  const wRow = page.locator('div.flex.flex-wrap.items-center.gap-1', { hasText: '출금이체 성공 건수' });
  await wRow.getByRole('button', { name: /^거래내역조회/ }).click();
  await page.waitForTimeout(300);
  const after = await wRow.locator('button[aria-pressed="true"]').count();
  check(after === 2, '열을 손으로 추가하면 항목에 2개 연결');
  await wRow.getByRole('button', { name: /^거래내역조회/ }).click();
  await page.waitForTimeout(300);
  check((await wRow.locator('button[aria-pressed="true"]').count()) === 1, '다시 빼면 1개');

  // ── 산출 ──
  await page.getByRole('button', { name: /AI 회비 초안 산출하기/ }).click();
  await page.getByText('회비 초안을 산출했습니다').or(page.getByText(/산출 결과/)).first().waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.body.textContent.includes('26,203,175'), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await shot('05-result.png');
  const heads = await page.$$eval('thead th', (ths) => ths.map((t) => t.textContent.trim()));
  check(heads.includes('출금이체 성공 건수') && heads.includes('입금이체 성공 건수'), '결과 표에 실적 항목별 열');
  const body3 = await page.textContent('body');
  for (const [name, e] of Object.entries(EXPECT)) {
    check(body3.includes(e.fee.toLocaleString('en-US')), `${name} 회비 ${e.fee.toLocaleString('en-US')}원 (구간 단가 적용)`);
  }
  check(body3.includes('출금이체 성공 건수: 출금이체'), '실적 출처에 항목별 연결 열 표시');
  console.log('5) 산출 OK');

  // 결과 엑셀 내려받기
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.getByRole('button', { name: /참가기관 송부 대사용 Excel 다운로드/ }).click(),
  ]);
  const xlsxOut = path.join(SHOT, 'result-reconcile.xlsx');
  await download.saveAs(xlsxOut);
  console.log('6) 결과 엑셀 저장:', xlsxOut);

  await browser.close();
  // 글꼴 CDN 등 바깥 자원 차단은 무시한다
  const real = errors.filter((e) => !e.includes('Failed to load resource'));
  if (real.length) {
    console.log('브라우저 오류:', real.slice(0, 10));
  }
  console.log('E2E 완료');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
