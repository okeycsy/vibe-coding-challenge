// 화면 모듈: 회비 산출 STEP 1~2 업로드. "실적 파일은 형식 그대로 — 머리글·기관·기준월 자동 판별, 제외 항목은 칩 하나로"
// b1 업무·기간 선택 / b2 드롭존 → 판별 결과 / b3 열 칩 끄기 → 합계 재계산
module.exports = {
  id: '30-upload',
  kind: 'screen',
  async setup({ page, app }) {
    await app.login(page, 'admin');
    await app.openMenu(page, '회비 산출 및 대사');
    await app.selectBusiness(page, 'openbanking');
    await page.mouse.move(960, 760);
  },
  async run({ page, beat, ov, app, demo, sleep }) {
    await beat('b1', async () => {
      await ov.focus(page, page.locator('#calc-period'), { badge: 1, pad: 8, maxScale: 1.1, scrollOffset: 80 });
      await sleep(200);
      await ov.click(page, page.locator('#calc-period button', { hasText: '2026년 3분기' }).first(), { settle: 500 });
      await ov.pulse(page, page.locator('#calc-period :text("산출 기간")').first().locator('xpath=..'), 900, 8);
      await sleep(500);
    });
    await beat('b2', async () => {
      const dropzone = page.locator('#calc-input button.border-dashed').first();
      await ov.focus(page, dropzone, { badge: 2, pad: 14, maxScale: 1.3, scrollOffset: 120 });
      await ov.hover(page, dropzone, 700);
      await sleep(400);
      // 업로드가 끝나면 드롭존 자리에 파일 카드가 들어오므로, 스포트라이트를 곧바로 판별 결과 줄로 옮긴다 (옛 영역에 머물지 않게)
      await app.upload(page, demo('오픈뱅킹'));
      const badge = page.locator('#calc-input', { hasText: '판별' }).locator('div.rounded-md.border').first();
      await ov.focus(page, badge, { badge: 2, pad: 12, scale: 1.5, scroll: false, settle: 1000 });
      await ov.pulse(page, badge, 1400, 8);
      await sleep(1200);
    });
    await beat('b3', async () => {
      const fileCard = page.locator('#calc-input div.rounded-lg.border-emerald-200').first();
      await ov.focus(page, fileCard, { badge: 3, pad: 10, maxScale: 1.3, scrollOffset: 110 });
      await sleep(400);
      for (const h of app.OB_CHIPS) {
        await ov.click(page, app.chip(page, h), { ms: 450, settle: 450 });
      }
      await ov.pulse(page, page.locator('#calc-input p', { hasText: '합계' }).first(), 1600, 8);
      await sleep(1400);
    });
  },
};
