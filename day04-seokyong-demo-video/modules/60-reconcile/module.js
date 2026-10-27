// 화면 모듈: 결과 내보내기 + 다른 업무 몽타주. "대사용·수입결의용 엑셀 즉시 출력, 업무 5종을 같은 흐름으로"
// b1 엑셀 2종 다운로드 / b2 타행환 → 금융거래정보 결과
module.exports = {
  id: '60-reconcile',
  kind: 'screen',
  async setup({ page, app, demo }) {
    await app.login(page, 'admin');
    await app.openMenu(page, '회비 산출 및 대사');
    await app.prepareRun(page, 'interbank', demo('타행환'));
    await app.prepareRun(page, 'fininfo', demo('기업회계'));
    await app.prepareRun(page, 'openbanking', demo('오픈뱅킹'), { chips: app.OB_CHIPS, issues: app.OB_ISSUES });
    await page.mouse.move(960, 760);
  },
  async run({ page, beat, ov, app, out, sleep }) {
    const path = require('path');
    await beat('b1', async () => {
      const dl1 = page.locator('#calc-result button', { hasText: '대사용 Excel' }).first();
      const dl2 = page.locator('#calc-result button', { hasText: '수입결의용 Excel' }).first();
      await ov.focus(page, dl1.locator('xpath=..'), { badge: 1, pad: 16, scale: 1.45, scrollOffset: 160 });
      await sleep(600);
      const [d1] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), ov.click(page, dl1, { ms: 500, settle: 600 })]);
      const [d2] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), ov.click(page, dl2, { ms: 450, settle: 600 })]);
      if (d1) await d1.saveAs(path.join(out, '대사용.xlsx')).catch(() => {});
      if (d2) await d2.saveAs(path.join(out, '수입결의용.xlsx')).catch(() => {});
      await sleep(900);
    });
    await beat('b2', async () => {
      await ov.unfocus(page, { settle: 300 });
      const sel = app.businessSelect(page);
      for (const biz of ['interbank', 'fininfo']) {
        await ov.scrollMain(page, 0, 450);
        await ov.click(page, sel, { ms: 500, settle: 150 });
        await sel.selectOption(biz);
        await sleep(700);
        await ov.focus(page, page.locator('#calc-result'), { badge: 2, pad: 6, scale: 1, scrollOffset: 70, settle: 900 });
        await sleep(1500);
      }
    });
  },
};
