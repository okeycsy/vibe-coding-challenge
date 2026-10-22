// app/ 을 esbuild로 묶어 단일 HTML 두 개를 만든다.
// - release/fee-rules-proto.html : 더블클릭으로 여는 오프라인 프로그램
// - release/artifact.html        : claude.ai 웹 페이지 게시용 본문
import { build, context } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const opts = {
  entryPoints: ['app/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: ['es2022'],
  logLevel: 'silent',
  loader: { '.txt': 'text' },
};

function emit(js) {
  const css = readFileSync('app/styles.css', 'utf8');
  const safeJs = js.replace(/<\/script/gi, '<\\/script');
  const head = `<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>회비 산출 규칙 프로토타입</title>`;
  mkdirSync('release', { recursive: true });
  writeFileSync('release/fee-rules-proto.html', `<!doctype html>\n<html lang="ko">\n<head>\n${head}\n<style>${css}</style>\n</head>\n<body>\n<div id="app"></div>\n<script>${safeJs}</script>\n</body>\n</html>\n`);
  writeFileSync('release/artifact.html', `<title>회비 산출 규칙 프로토타입</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>${css}</style>\n<div id="app"></div>\n<script>${safeJs}</script>\n`);
  console.log(`${new Date().toLocaleTimeString('ko-KR')} release/fee-rules-proto.html, release/artifact.html 생성 (${(js.length / 1024).toFixed(0)} KB)`);
}

if (watch) {
  const ctx = await context({ ...opts, plugins: [{ name: 'emit', setup(b) { b.onEnd((r) => { if (r.errors.length) console.error(r.errors); else emit(r.outputFiles[0].text); }); } }] });
  await ctx.watch();
  console.log('변경을 감시합니다. release/fee-rules-proto.html을 브라우저로 열어 새로고침하세요.');
} else {
  const r = await build(opts);
  emit(r.outputFiles[0].text);
}
