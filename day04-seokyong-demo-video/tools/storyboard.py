#!/usr/bin/env python3
"""modules/order.json + 각 모듈의 captions.json + docs/timeline.json 으로 docs/storyboard.md 를 만든다.
자막을 고치면 이 문서도 같이 갱신되도록(assemble.py 뒤에) 돌린다. 사용: python3 storyboard.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
MODULES = os.path.join(ROOT, 'modules')
DOCS = os.path.join(ROOT, 'docs')

KIND = {'card': '카드', 'screen': '화면'}


def mmss(t):
    return f'{int(t // 60)}:{int(t % 60):02d}'


def main():
    order = json.load(open(os.path.join(MODULES, 'order.json')))
    tl_path = os.path.join(DOCS, 'timeline.json')
    timeline = json.load(open(tl_path)) if os.path.exists(tl_path) else {'modules': [], 'total': 0}
    tmods = {m['id']: m for m in timeline['modules']}
    lines = ['# 시연 영상 v2 스토리보드 (모듈별)', '',
             '`tools/storyboard.py` 가 `modules/*/captions.json` 과 `docs/timeline.json` 에서 자동 생성한다. 문구는 captions.json 을 고친다.', '']
    if timeline['total']:
        lines += [f'전체 길이 **{mmss(timeline["total"])}** ({timeline["total"]:.0f}초), 모듈 {len(order)}개, 모듈 사이 크로스페이드 {timeline.get("xfade", 0)}초', '']
    lines += ['| 시작 | 모듈 | 종류 | 길이 | 비트 수 | 효과 코멘트 |', '|---|---|---|---|---|---|']
    for o in order:
        mid = o['id']
        caps = json.load(open(os.path.join(MODULES, mid, 'captions.json')))
        tm = tmods.get(mid)
        effects = [b['effect'] for b in caps.get('beats', []) if b.get('effect')]
        lines.append(f'| {mmss(tm["start"]) if tm else "-"} | `{mid}` | {KIND.get(tm["kind"] if tm else "", "")} | {f"{tm["duration"]:.0f}초" if tm else "-"} | '
                     f'{len(caps.get("beats", [])) or 1} | {" / ".join(effects) if effects else ""} |')
    lines.append('')
    for o in order:
        mid = o['id']
        caps = json.load(open(os.path.join(MODULES, mid, 'captions.json')))
        tm = tmods.get(mid)
        lines += [f'## {mid}' + (f'  ({mmss(tm["start"])} – {mmss(tm["start"] + tm["duration"])})' if tm else ''), '']
        if 'beats' not in caps:
            lines += ['카드 (내레이션 자막만):', ''] + [f'- {l}' for l in caps.get('narration', [])] + ['']
            continue
        beats = {b['id']: b for b in (tm['beats'] if tm else [])}
        for n, b in enumerate(caps['beats'], 1):
            t = beats.get(b['id'])
            when = f' ({mmss(t["start"])}–{mmss(t["end"])})' if t else ''
            lines += [f'### {n}. {b["title"]}{when}', '', f'- 무자막판 요약: {b.get("sub", "")}']
            if b.get('effect'):
                lines.append(f'- **효과 코멘트**: {b["effect"]}')
            if b.get('narration'):
                lines.append('- 내레이션: ' + ' '.join(b['narration']))
            lines.append('')
    os.makedirs(DOCS, exist_ok=True)
    open(os.path.join(DOCS, 'storyboard.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print('wrote docs/storyboard.md')


if __name__ == '__main__':
    main()
