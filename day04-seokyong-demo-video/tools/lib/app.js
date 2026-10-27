// 회비자동산출시스템 조작 헬퍼. 녹화 전 상태 준비(setup)에 쓰는 빠른 동작들 — 연출 없이 바로 실행한다.
// 녹화 중 보이는 동작은 overlay.js 의 click/typeInto 로 한다.
const fs = require('fs');
const path = require('path');

const PW = 'kftc1234!!';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const APP = path.join(__dirname, '..', '..', '..', 'day01-gyeongsik-fee-calculator');
const SAMPLE = path.join(APP, 'public', 'samples', 'fee-performance-sample.xlsx');
const LOGO = path.join(APP, 'public', 'kftc-symbol.png');
const DEMO = process.env.DEMO_FILES_DIR || path.join(__dirname, '..', '..', 'demo-files');
const BASE = process.env.APP_URL || 'http://127.0.0.1:5173/';

const demoFile = (name) => path.join(DEMO, `${name} 테스트 실적.xlsx`);

async function login(page, id) {
  await page.getByPlaceholder('사번 입력').fill(id);
  await page.getByPlaceholder('비밀번호 입력').fill(PW);
  await page.locator('button[type=submit]').click();
  await page.waitForTimeout(1500);
}
async function logout(page) {
  await page.locator('header button', { hasText: '로그아웃' }).click();
  await page.waitForTimeout(1200);
}
const menu = (page, label) => page.locator('aside button', { hasText: label }).first();
async function openMenu(page, label) {
  await menu(page, label).click();
  await page.waitForTimeout(900);
}
const businessSelect = (page) => page.locator('#calc-period select').first();
async function selectBusiness(page, id) {
  await businessSelect(page).selectOption(id);
  await page.waitForTimeout(600);
}
// STEP 1 빠른 선택: '2026년 3분기' 같은 버튼
async function pickPeriod(page, label = '2026년 3분기') {
  await page.locator('#calc-period button', { hasText: label }).first().click();
  await page.waitForTimeout(400);
}
// 한글 파일명은 setInputFiles(경로)가 조용히 실패하므로 buffer 로 넘긴다
async function upload(page, file) {
  const resp = page.waitForResponse((r) => r.url().includes('/api/fee/uploads'), { timeout: 30000 });
  await page.locator('#calc-input input[type=file]').setInputFiles({ name: path.basename(file), mimeType: XLSX_MIME, buffer: fs.readFileSync(file) });
  await resp;
  await page.waitForTimeout(600);
}
const chip = (page, name) => page.locator('#calc-input button[aria-pressed=true]', { hasText: name }).first();
async function toggleChips(page, names) {
  for (const n of names) {
    await chip(page, n).click();
    await page.waitForTimeout(250);
  }
}
async function addIssue(page, text) {
  await page.locator('#calc-input textarea').fill(text);
  await page.locator('#calc-input button', { hasText: '이슈 등록' }).click();
  await page.waitForTimeout(300);
}
const calcButton = (page) => page.locator('#calc-input button', { hasText: /AI 회비 초안/ }).first();
// 응답이 클릭 직후 바로 올 수 있으므로 대기를 먼저 건다.
// 화면은 응답 뒤에도 진행 메시지를 몇 초 보여 준 다음 결과를 상태에 넣으므로(그 전에 화면을 떠나면 결과가 버려진다) 표가 뜰 때까지 기다린다.
async function calc(page, { settle = 800 } = {}) {
  const resp = page.waitForResponse((r) => r.url().includes('/api/v1/fees/calculate'), { timeout: 60000 });
  await calcButton(page).click();
  await resp;
  await page.locator('#calc-result tbody tr').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(settle);
}
// 업무 하나를 처음부터 산출까지 (녹화 전 준비용)
async function prepareRun(page, biz, file, { issues = [], chips = [] } = {}) {
  await selectBusiness(page, biz);
  await pickPeriod(page);
  await upload(page, file);
  if (chips.length) await toggleChips(page, chips);
  for (const t of issues) await addIssue(page, t);
  await calc(page);
}

// 시연에 쓰는 문장·파일 (모듈 사이에 같은 값을 쓰도록 한곳에)
const OB_CHIPS = ['거래내역조회', '계좌실명조회', '잔액조회'];
const OB_ISSUES = [
  '한빛은행 시스템 장애로 중복 전송된 1,500건은 실적에서 제외해 줘',
  '가온은행 이용기관 쪽 잘못된 계좌번호로 실패한 800건도 빼 줘',
];
const CD_ISSUES = [
  '한빛은행 공동망 장애로 재처리된 2,000건 차감해 줘',
  '미래온은행 자체 ATM 장애로 고객이 다시 시도한 300건도 빼 줘',
];

module.exports = {
  PW, BASE, DEMO, SAMPLE, LOGO, demoFile, login, logout, menu, openMenu, businessSelect, selectBusiness, pickPeriod,
  upload, chip, toggleChips, addIssue, calcButton, calc, prepareRun, OB_CHIPS, OB_ISSUES, CD_ISSUES,
};
