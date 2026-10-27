// 화면 모듈: STEP 2 AI 이슈 입력. "예외는 문장으로 등록, 지침에 맞는 이슈만 차감"
// b1 첫 문장 타이핑·등록 / b2 둘째 문장 → 태그 2개
module.exports = {
  id: '40-ai-issue',
  kind: 'screen',
  async setup({ page, app, demo }) {
    await app.login(page, 'admin');
    await app.openMenu(page, '회비 산출 및 대사');
    await app.selectBusiness(page, 'openbanking');
    await app.pickPeriod(page);
    await app.upload(page, demo('오픈뱅킹'));
    await app.toggleChips(page, app.OB_CHIPS);
    await page.mouse.move(960, 760);
  },
  async run({ page, beat, ov, app, sleep }) {
    const ta = page.locator('#calc-input textarea');
    const box = ta.locator('xpath=..');
    const submit = page.locator('#calc-input button', { hasText: '이슈 등록' });
    await beat('b1', async () => {
      await ov.focus(page, box, { badge: 1, pad: 14, scale: 1.4, scrollOffset: 150 });
      await sleep(300);
      await ov.typeInto(page, ta, app.OB_ISSUES[0], 50);
      await sleep(400);
      await ov.click(page, submit, { ms: 450, settle: 500 });
      await ov.pulse(page, page.locator('#calc-input :text("1,500건")').last(), 1300, 6);
      await sleep(500);
    });
    await beat('b2', async () => {
      await ov.typeInto(page, ta, app.OB_ISSUES[1], 40);
      await sleep(350);
      await ov.click(page, submit, { ms: 450, settle: 500 });
      const tags = page.locator('#calc-input :text("800건")').last().locator('xpath=../..');
      await ov.focus(page, tags, { badge: 2, pad: 14, scale: 1.5, scrollOffset: 150 });
      await ov.pulse(page, page.locator('#calc-input :text("800건")').last(), 1500, 6);
      await sleep(1500);
    });
  },
};
