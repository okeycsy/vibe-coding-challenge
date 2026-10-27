// 화면 모듈: 로그인 → 회비기준 ① 기준 문서 편집. "업무별 산출 기준은 문서 한 장"
// b1 로그인 카드 / b2 문서 편집 화면 머리 / b3 4개 섹션을 차례로 비춤
module.exports = {
  id: '10-rules-doc',
  kind: 'screen',
  async setup({ page }) {
    await page.mouse.move(960, 760);
  },
  async run({ page, beat, ov, app, sleep }) {
    await beat('b1', async () => {
      const card = page.locator('button[type=submit]').locator('xpath=ancestor::div[contains(@class,"rounded-2xl")]').first();
      await ov.focus(page, card, { scale: 1.12, pad: 14, badge: 1, scroll: false, anchorY: 0.42 });
      await ov.typeInto(page, page.getByPlaceholder('사번 입력'), 'admin', 45);
      await ov.typeInto(page, page.getByPlaceholder('비밀번호 입력'), app.PW, 28);
      await sleep(300);
      await ov.unfocus(page, { settle: 500 });
      await ov.click(page, page.locator('button[type=submit]'));
      await page.waitForTimeout(1600);
      await ov.installOverlay(page);
    });
    await beat('b2', async () => {
      await ov.click(page, app.menu(page, '① 기준 문서 편집'));
      await page.waitForTimeout(1000);
      const tabsRow = page.locator('main button', { hasText: '섹션별 폼 편집 모드' }).locator('xpath=../..').first();
      await ov.focus(page, tabsRow, { badge: 2, pad: 12, maxScale: 1.25, scrollOffset: 90 });
      await sleep(1600);
    });
    await beat('b3', async () => {
      for (const n of [1, 2, 3, 4]) {
        // 섹션 제목(## n.) 두 단계 위가 섹션 블록 (1·2·4는 label, 3은 수식 상자 div)
        const block = page.locator(`main :text("## ${n}.")`).first().locator('xpath=../..');
        await ov.focus(page, block, { badge: 3, pad: 10, maxScale: 1.3, scrollOffset: 120, settle: 1500 });
      }
      await sleep(1400);
    });
  },
};
