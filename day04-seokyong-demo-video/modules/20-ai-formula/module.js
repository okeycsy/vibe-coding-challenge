// 화면 모듈: 회비기준 ② AI 계산식 빌더. "문장으로 쓴 규칙을 AI가 수식으로, 3단계 검증을 통과한 수식만 반영"
// b1 생성 버튼 / b2 생성 결과(산정 유형·근거) / b3 3단계 검증 → 확정 반영
module.exports = {
  id: '20-ai-formula',
  kind: 'screen',
  async setup({ page, app }) {
    await app.login(page, 'admin');
    await app.openMenu(page, '② AI 계산식 빌더');
    await page.mouse.move(960, 760);
  },
  async run({ page, beat, ov, sleep }) {
    const section = (text) => page.locator('main section:visible', { hasText: text }).first();
    await beat('b1', async () => {
      const card1 = section('계산식 자동 생성');
      await ov.focus(page, card1, { badge: 1, pad: 12, maxScale: 1.25, scrollOffset: 90 });
      await sleep(900);
      await ov.click(page, card1.locator('button', { hasText: '계산식 자동 생성' }).first(), { settle: 500 });
      await page.waitForTimeout(2000);
    });
    await beat('b2', async () => {
      const panel2 = section('AI 생성 수식 및 해석 결과');
      await ov.focus(page, panel2, { badge: 2, pad: 12, maxScale: 1.3, scrollOffset: 90 });
      await ov.pulse(page, panel2.locator(':text("감지된 산정 유형")').first().locator('xpath=..'), 1000, 8);
      await sleep(400);
      await ov.pulse(page, panel2.locator(':text("규칙-수식 매핑 설명")').first().locator('xpath=..'), 1200, 8);
      await sleep(600);
    });
    await beat('b3', async () => {
      const panel3 = section('3단계 검증');
      const checks = panel3.locator('p', { hasText: '저장 전 3단계 검증' }).locator('xpath=..').first();
      await ov.focus(page, checks, { badge: 3, pad: 12, maxScale: 1.45, scrollOffset: 140 });
      for (const t of ['① 섹션 유효성', '② 수식 구문 검사', '③ 시험 계산 2벌']) {
        await ov.pulse(page, panel3.locator(`:text("${t}")`).first().locator('xpath=..'), 900, 6);
        await sleep(250);
      }
      const confirmBtn = panel3.locator('button', { hasText: '확정 반영' }).first();
      await ov.focus(page, confirmBtn, { badge: 3, pad: 14, scale: 1.45, scrollOffset: 140, settle: 700 });
      await ov.hover(page, confirmBtn, 600);
      await ov.pulse(page, confirmBtn, 1200, 8);
      await sleep(900);
    });
  },
};
