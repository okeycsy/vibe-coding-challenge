// vite build 결과를 파일 하나로 묶는다.
// - release/fee-calculator.html : 더블클릭으로 바로 여는 단일 HTML 프로그램
// - release/artifact.html       : claude.ai 웹 페이지 게시용 (문서 뼈대 없이 본문만)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const read = (p) => readFileSync(`dist/${p.replace(/^\.?\//, '')}`, 'utf8');

let css = '';
let js = '';
const page = html
  .replace(/<link rel="stylesheet" crossorigin href="([^"]+)">\s*/g, (_, href) => {
    css += read(href);
    return '';
  })
  .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>\s*/g, (_, src) => {
    js += read(src);
    return '';
  });
if (!css || !js) throw new Error('dist/index.html에서 CSS/JS를 찾지 못했습니다. 먼저 vite build를 실행하세요.');

const safeJs = js.replace(/<\/script/gi, '<\\/script');
const styleTag = `<style>${css}</style>`;
const scriptTag = `<script type="module">${safeJs}</script>`;

mkdirSync('release', { recursive: true });
writeFileSync('release/fee-calculator.html', page.replace('</head>', () => `${styleTag}</head>`).replace('</body>', () => `${scriptTag}</body>`));

const title = page.match(/<title>[\s\S]*?<\/title>/)[0];
const fonts = page.match(/<link rel="stylesheet"[^>]*fonts\.googleapis[^>]*>/)?.[0] ?? '';
writeFileSync(
  'release/artifact.html',
  `${title}\n<meta name="claude:viewport-fit-sides" content="cover">\n${fonts}\n${styleTag}\n<div id="root"></div>\n${scriptTag}\n`,
);
console.log('release/fee-calculator.html, release/artifact.html 생성');
