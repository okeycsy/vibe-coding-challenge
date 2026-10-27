// 화면 모듈: STEP 3 산출·검증. "1원까지 맞춘 결과, 검증까지 자동"
// b1 산출 → 차감된 기관 행 / b2 차감하지 않은 이슈와 근거 / b3 CD공동망: 특이사항 보정 배지 · 합계 3억 검증 ✓
module.exports = {
  id: '50-calc-verify',
  kind: 'screen',
  async setup({ page, app, demo }) {
    await app.login(page, 'admin');
    await app.openMenu(page, '회비 산출 및 대사');
    await app.prepareRun(page, 'cd', demo('CD공동망'), { issues: app.CD_ISSUES }); // b3 에서 보여 줄 결과를 미리 만든다
    await app.selectBusiness(page, 'openbanking');
    await app.pickPeriod(page);
    await app.upload(page, demo('오픈뱅킹'));
    await app.toggleChips(page, app.OB_CHIPS);
    for (const t of app.OB_ISSUES) await app.addIssue(page, t);
    await page.mouse.move(960, 760);
  },
  async run({ page, beat, ov, app, sleep }) {
    await beat('b1', async () => {
      const btn = app.calcButton(page);
      await ov.focus(page, btn, { badge: 1, pad: 16, scale: 1.25, scrollOffset: 300 });
      const resp = page.waitForResponse((r) => r.url().includes('/api/v1/fees/calculate'), { timeout: 60000 });
      await ov.click(page, btn, { settle: 300 });
      await ov.unfocus(page, { settle: 300 });
      await resp;
      await page.waitForTimeout(2600); // 진행 메시지 → 결과 표
      const hanbit = page.locator('#calc-result tr', { hasText: '한빛은행' }).first();
      await ov.focus(page, hanbit, { badge: 1, pad: 8, scale: 1.25, scrollOffset: 220 });
      await ov.pulse(page, hanbit.locator('td').nth(2), 1500, 6);
      await sleep(1500);
    });
    await beat('b2', async () => {
      const excluded = page.locator('#calc-result div.rounded-lg', { hasText: '차감하지 않은 이슈' }).last();
      await ov.focus(page, excluded, { badge: 2, pad: 12, scale: 1.4, scrollOffset: 260 });
      await sleep(3200);
    });
    await beat('b3', async () => {
      await ov.unfocus(page, { settle: 300 });
      await ov.scrollMain(page, 0, 500);
      const sel = app.businessSelect(page);
      await ov.click(page, sel, { ms: 500, settle: 150 });
      await sel.selectOption('cd');
      await sleep(900);
      const special = page.locator('#calc-result div', { hasText: '최종 정산 특이사항 반영' })
        .locator('xpath=ancestor-or-self::div[contains(@class,"rounded-lg")]').first();
      await ov.focus(page, special, { badge: 3, pad: 12, maxScale: 1.3, scrollOffset: 110 });
      await sleep(1200);
      const plus = page.locator('#calc-result span', { hasText: '특이사항 보정' }).first();
      if (await plus.count()) {
        await ov.focus(page, plus.locator('xpath=ancestor::tr[1]'), { badge: 3, pad: 8, scale: 1.3, scrollOffset: 200, settle: 800 });
        await ov.hover(page, plus, 600);
        await sleep(1200);
        const minus = page.locator('#calc-result span', { hasText: '절삭' }).first();
        if (await minus.count()) {
          await ov.hover(page, minus, 600);
          await sleep(1100);
        }
      }
      const totalRow = page.locator('#calc-result tr', { hasText: '합계' }).last();
      await ov.focus(page, totalRow, { badge: 3, pad: 8, scale: 1.3, scrollOffset: 420, settle: 900 });
      await ov.pulse(page, totalRow.locator('td', { hasText: '원' }).last(), 1600, 6); // 산출 회비 합계 300,000,000원
      await sleep(1100);
    });
  },
};
