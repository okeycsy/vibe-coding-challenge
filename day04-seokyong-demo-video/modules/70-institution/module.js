// 화면 모듈: 참가기관 뷰. "참가기관은 자기 회비만 확인하고 버튼 하나로 회신"
// b1 참가기관 로그인 → 자기 기관 행만 / b2 이상 없음 회신
module.exports = {
  id: '70-institution',
  kind: 'screen',
  async setup({ page, app, sample }) {
    await app.login(page, 'admin');
    await app.openMenu(page, '회비 산출 및 대사');
    await app.prepareRun(page, 'cms', sample);
    await app.logout(page);
    await page.mouse.move(960, 760);
  },
  async run({ page, beat, ov, app, sleep }) {
    await beat('b1', async () => {
      const card = page.locator('button[type=submit]').locator('xpath=ancestor::div[contains(@class,"rounded-2xl")]').first();
      await ov.focus(page, card, { scale: 1.12, pad: 14, badge: 1, scroll: false, anchorY: 0.42 });
      await ov.typeInto(page, page.getByPlaceholder('사번 입력'), 'shinhan', 45);
      await ov.typeInto(page, page.getByPlaceholder('비밀번호 입력'), app.PW, 28);
      await ov.unfocus(page, { settle: 400 });
      await ov.click(page, page.locator('button[type=submit]'));
      await page.waitForTimeout(1600);
      await ov.installOverlay(page);
      const sel = page.locator('#calc-period select').first();
      await ov.click(page, sel, { ms: 500, settle: 150 });
      await sel.selectOption('cms');
      await sleep(800);
      await ov.focus(page, page.locator('#calc-result table').first(), { badge: 1, pad: 10, maxScale: 1.3, scrollOffset: 160 });
      await sleep(1800);
    });
    await beat('b2', async () => {
      const ok = page.locator('#calc-result button', { hasText: '이상 없음' }).first();
      await ov.focus(page, ok.locator('xpath=..'), { badge: 2, pad: 14, scale: 1.5, scrollOffset: 200 });
      await sleep(500);
      await ov.click(page, ok, { ms: 650, settle: 400 });
      await sleep(3200);
    });
  },
};
