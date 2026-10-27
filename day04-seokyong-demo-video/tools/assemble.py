#!/usr/bin/env python3
"""모듈 클립을 순서대로 이어 붙이고(크로스페이드), 자막 패널(ASS)을 굽는다.

사용: python3 assemble.py [--screen-speed 1.0] [--subs-only] [--no-module-clips]
입력: modules/order.json, modules/<id>/captions.json, tools/out/modules/<id>.mp4 + <id>.json (record.js 결과)
출력: video/시연영상_v2_자막.mp4, video/시연영상_v2_무자막.mp4, video/modules/<id>.mp4 (모듈별 자막 클립),
      docs/narration.srt, docs/narration.txt, docs/timeline.json

자막은 영상에 굽기 전까지 전부 텍스트(captions.json)이므로, 문구만 고칠 때는 다시 찍지 않고 이 스크립트만 돌린다.
화면 모듈의 자막 패널: [번호 배지] 제목 / 내레이션 문장(자막판) 또는 요약 한 줄(무자막판) + 위쪽 '효과' 칩.
번호 배지는 녹화 때 화면의 스포트라이트에 붙인 번호와 같다 → 자막이 가리키는 영역이 곧 밝게 남은 영역.
"""
import argparse
import json
import os
import subprocess
import sys

from PIL import ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
MODULES = os.path.join(ROOT, 'modules')
OUT = os.path.join(HERE, 'out', 'modules')
VIDEO = os.path.join(ROOT, 'video')
DOCS = os.path.join(ROOT, 'docs')
XFADE = 0.45          # 모듈 사이 크로스페이드(초)
CPS_WARN = 6.5        # 초당 글자 수가 이보다 크면 자막이 너무 빨리 지나간다

# ── 자막 패널 디자인 (1920×1080 기준) ──
PX, PW, PH, PB = 56, 1180, 136, 50          # 패널 x, 너비, 높이, 아래 여백
PY = 1080 - PB - PH
BADGE_R = 23
TEXT_X = PX + 88
TITLE_SIZE, NARR_SIZE, BADGE_SIZE, CHIP_SIZE, CARD_SIZE = 40, 27, 24, 24, 42
CHIP_H, CHIP_GAP = 46, 14
NAVY = '&H2A1608&'       # 패널 바탕 (BBGGRR) ≈ #08162A
ACCENT = '&HFF8B3B&'     # #3B8BFF
GREEN = '&H99D334&'      # #34D399
WHITE = '&HFFFFFF&'


def fc_font(pattern):
    try:
        return subprocess.check_output(['fc-match', '-f', '%{file}', pattern]).decode().strip()
    except Exception:
        return None


class Measure:
    """libass 는 글꼴의 (ascent+descent) 가 Fontsize 가 되도록 크기를 잡는다. 같은 규칙으로 글자 너비를 잰다."""

    def __init__(self):
        self.cache = {}

    def width(self, text, size, weight='semibold'):
        path = fc_font(f'Pretendard:{weight}')
        if not path or not os.path.exists(path):
            return len(text) * size * 0.95
        key = (path, size)
        if key not in self.cache:
            probe = ImageFont.truetype(path, 1000)
            asc, desc = probe.getmetrics()
            em = size * 1000 / max(1, asc + desc)
            self.cache[key] = ImageFont.truetype(path, int(round(em)))
        return self.cache[key].getlength(text)


MEASURE = Measure()


def probe_duration(path):
    out = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path])
    return float(out.decode().strip())


def ass_time(t):
    t = max(0.0, t)
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return f'{h}:{m:02d}:{s:05.2f}'


def srt_time(t):
    t = max(0.0, t)
    h = int(t // 3600); m = int((t % 3600) // 60); s = int(t % 60); ms = int(round((t - int(t)) * 1000))
    return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'


def mmss(t):
    return f'{int(t // 60)}:{int(t % 60):02d}'


def spread(lines, start, end, gap=0.1, lead=0.2, tail=0.3):
    """구간 안에서 문장 길이에 비례해 자막 시간을 배분한다."""
    usable = max(0.5, end - start - lead - tail - gap * (len(lines) - 1))
    total = sum(len(l) for l in lines) or 1
    cues, t = [], start + lead
    for l in lines:
        d = max(1.0, usable * len(l) / total)
        cues.append((t, min(end - tail, t + d), l))
        t += d + gap
    return cues


# ── ASS 도형 ──
K = 0.5523


def rrect(x, y, w, h, r):
    """둥근 사각형 드로잉 명령 (절대 좌표, \\pos(0,0)\\an7 과 함께 쓴다)."""
    x2, y2 = x + w, y + h
    c = r * K
    return (f'm {x + r:.1f} {y:.1f} l {x2 - r:.1f} {y:.1f} b {x2 - r + c:.1f} {y:.1f} {x2:.1f} {y + r - c:.1f} {x2:.1f} {y + r:.1f} '
            f'l {x2:.1f} {y2 - r:.1f} b {x2:.1f} {y2 - r + c:.1f} {x2 - r + c:.1f} {y2:.1f} {x2 - r:.1f} {y2:.1f} '
            f'l {x + r:.1f} {y2:.1f} b {x + r - c:.1f} {y2:.1f} {x:.1f} {y2 - r + c:.1f} {x:.1f} {y2 - r:.1f} '
            f'l {x:.1f} {y + r:.1f} b {x:.1f} {y + r - c:.1f} {x + r - c:.1f} {y:.1f} {x + r:.1f} {y:.1f}')


def circle(cx, cy, r):
    return rrect(cx - r, cy - r, 2 * r, 2 * r, r)


class Ass:
    def __init__(self):
        self.lines = []

    def shape(self, s, e, path, color, alpha='&H00&', layer=0, border=None, fad=(180, 180), extra=''):
        tags = f'\\an7\\pos(0,0)\\bord0\\shad0\\1c{color}\\1a{alpha}\\fad({fad[0]},{fad[1]}){extra}'
        if border:
            bw, bc, ba = border
            tags = tags.replace('\\bord0', f'\\bord{bw}\\3c{bc}\\3a{ba}')
        self.lines.append(f'Dialogue: {layer},{ass_time(s)},{ass_time(e)},Shape,,0,0,0,,{{{tags}\\p1}}{path}{{\\p0}}')

    def text(self, s, e, style, x, y, text, an=7, layer=2, fad=(180, 180), extra=''):
        text = text.replace('\n', '\\N')
        self.lines.append(f'Dialogue: {layer},{ass_time(s)},{ass_time(e)},{style},,0,0,0,,{{\\an{an}\\pos({x:.0f},{y:.0f})\\fad({fad[0]},{fad[1]}){extra}}}{text}')

    def header(self):
        fmt = 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'
        return [
            '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080', 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
            '[V4+ Styles]', fmt,
            f'Style: Shape,Pretendard,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1',
            f'Style: Title,Pretendard,{TITLE_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,-1,0,1,0,0,7,0,0,0,1',
            f'Style: Narr,Pretendard,{NARR_SIZE},&H00F2F5FF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,-0.3,0,1,0,0,7,0,0,0,1',
            f'Style: Sub,Pretendard,{NARR_SIZE},&H00C9D4F0,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,-0.3,0,1,0,0,7,0,0,0,1',
            f'Style: Badge,Pretendard,{BADGE_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1',
            f'Style: ChipTag,Pretendard,{CHIP_SIZE},{GREEN.replace("&H", "&H00")},&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,4,0,0,0,1',
            f'Style: Chip,Pretendard,{CHIP_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,-0.3,0,1,0,0,4,0,0,0,1',
            f'Style: NarrCard,Pretendard,{CARD_SIZE},&H00FFFFFF,&H00FFFFFF,&H00101828,&H90000000,-1,0,0,0,100,100,-0.5,0,1,2.4,1.2,2,140,140,96,1',
            '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        ]

    def dump(self, path):
        with open(path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(self.header() + self.lines) + '\n')


def panel(ass, s, e, n, title, body_cues, body_style, effect):
    """화면 모듈의 자막 패널 한 비트 분량."""
    # 바탕 + 배지 (비트 전체 시간)
    ass.shape(s, e, rrect(PX, PY, PW, PH, 20), NAVY, '&H2C&', layer=0, border=(1.2, WHITE, '&HD8&'))
    ass.shape(s, e, circle(PX + 44, PY + PH / 2, BADGE_R), ACCENT, '&H00&', layer=1)
    ass.text(s, e, 'Badge', PX + 44, PY + PH / 2 + 1, str(n), an=5)
    ass.text(s, e, 'Title', TEXT_X, PY + 24, title)
    for cs, ce, line in body_cues:
        ass.text(cs, ce, body_style, TEXT_X, PY + 82, line, fad=(140, 140))
    if effect:
        tag = '효과'
        tag_w = MEASURE.width(tag, CHIP_SIZE, 'bold')
        txt_w = MEASURE.width(effect, CHIP_SIZE, 'bold')
        cx = PX
        cy = PY - CHIP_GAP - CHIP_H
        w = 22 + 14 + 10 + tag_w + 16 + txt_w + 24
        cs = s + 0.5
        ass.shape(cs, e, rrect(cx, cy, w, CHIP_H, CHIP_H / 2), NAVY, '&H20&', layer=0, border=(1.6, GREEN, '&H70&'), fad=(220, 180),
                  extra='\\t(0,220,\\fscx100\\fscy100)')
        ass.shape(cs, e, circle(cx + 22 + 7, cy + CHIP_H / 2, 7), GREEN, '&H00&', layer=1, fad=(220, 180))
        ass.text(cs, e, 'ChipTag', cx + 22 + 14 + 10, cy + CHIP_H / 2 + 1, tag, an=4, fad=(220, 180))
        ass.text(cs, e, 'Chip', cx + 22 + 14 + 10 + tag_w + 16, cy + CHIP_H / 2 + 1, effect, an=4, fad=(220, 180))


def build_events(ass, mod, t0, speed, with_narr):
    """모듈 하나의 자막 이벤트를 최종 영상 시각(t0 기준)으로 만든다. 반환: (srt cue 목록, 내레이션 txt 블록)"""
    caps = mod['captions']
    cues, txt = [], []
    if mod['kind'] == 'card':
        s, e = t0, t0 + mod['dur']
        lines = caps.get('narration', [])
        if with_narr and lines:
            for cs, ce, line in spread(lines, s + 0.4, e - 0.2, lead=0.2, tail=0.4):
                ass.text(cs, ce, 'NarrCard', 960, 1080 - 96, line, an=2, fad=(160, 160))
                cues.append((cs, ce, line))
        if lines:
            txt.append((s, e, mod['id'], ' '.join(lines)))
        return cues, txt
    beats = {b['id']: b for b in mod['beats']}
    for n, cap in enumerate(caps.get('beats', []), 1):
        b = beats.get(cap['id'])
        if not b:
            print(f'WARN {mod["id"]}: 녹화에 비트 {cap["id"]} 가 없다', file=sys.stderr)
            continue
        s = t0 + b['start'] / speed
        e = t0 + b['end'] / speed
        lines = cap.get('narration', [])
        if lines:
            cps = sum(len(l) for l in lines) / max(0.1, e - s)
            if cps > CPS_WARN:
                print(f'WARN {mod["id"]}/{cap["id"]}: {cps:.1f}자/초 — 구간 {e - s:.1f}s 가 짧다', file=sys.stderr)
        if with_narr and lines:
            body = spread(lines, s, e)
            cues += body
        else:
            body = [(s + 0.15, e - 0.1, cap.get('sub', ''))] if cap.get('sub') else []
        panel(ass, s, e, n, cap['title'], body, 'Narr' if with_narr else 'Sub', cap.get('effect'))
        if lines:
            txt.append((s, e, f'{mod["id"]} · {cap["title"]}', ' '.join(lines)))
    return cues, txt


def ffmpeg(args):
    subprocess.check_call(['ffmpeg', '-loglevel', 'error', '-y', *args])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--screen-speed', type=float, default=1.0, help='화면 모듈 기본 배속 (order.json 의 speed 가 우선)')
    ap.add_argument('--subs-only', action='store_true', help='자막·타임라인 파일만 쓰고 렌더링은 건너뛴다')
    ap.add_argument('--no-module-clips', action='store_true', help='모듈별 자막 클립(video/modules) 생성을 건너뛴다')
    ap.add_argument('--modules', help='이 모듈들만 이어 붙여 tools/out/preview_*.mp4 로 낸다 (쉼표 구분, 검토용)')
    args = ap.parse_args()
    preview = [m.strip() for m in args.modules.split(',')] if args.modules else None
    os.makedirs(VIDEO, exist_ok=True)
    os.makedirs(os.path.join(VIDEO, 'modules'), exist_ok=True)
    os.makedirs(DOCS, exist_ok=True)

    order = json.load(open(os.path.join(MODULES, 'order.json')))
    if preview:
        order = [o for o in order if o['id'] in preview]
    mods = []
    for o in order:
        mid = o['id']
        meta_path = os.path.join(OUT, f'{mid}.json')
        if not os.path.exists(meta_path):
            sys.exit(f'녹화 결과가 없다: {meta_path} (node record.js {mid})')
        meta = json.load(open(meta_path))
        caps = json.load(open(os.path.join(MODULES, mid, 'captions.json')))
        raw = probe_duration(os.path.join(OUT, f'{mid}.mp4'))
        speed = o.get('speed', 1.0 if meta['kind'] == 'card' else args.screen_speed)
        mods.append({'id': mid, 'kind': meta['kind'], 'file': os.path.join(OUT, f'{mid}.mp4'), 'raw': raw, 'speed': speed,
                     'dur': raw / speed, 'beats': meta.get('beats', []), 'captions': caps})

    # ── 최종 타임라인: T_k = Σ_{j<k} dur_j − k·XFADE ──
    t = 0.0
    for k, m in enumerate(mods):
        m['t0'] = t
        t += m['dur'] - (XFADE if k < len(mods) - 1 else 0)
    total = t

    # ── 자막 두 벌 + 모듈별 자막 ──
    outputs = {}
    for with_narr, name in ((True, '자막'), (False, '무자막')):
        ass = Ass()
        all_cues, all_txt = [], []
        for m in mods:
            cues, txt = build_events(ass, m, m['t0'], m['speed'], with_narr)
            all_cues += cues
            all_txt += txt
        path = os.path.join(OUT, f'final_{name}.ass')
        ass.dump(path)
        outputs[name] = (path, all_cues, all_txt)
    _, cues, txt = outputs['자막']
    if preview:
        DOCS_DIR, VIDEO_DIR, prefix = OUT, OUT, 'preview_'
    else:
        DOCS_DIR, VIDEO_DIR, prefix = DOCS, VIDEO, '시연영상_v2_'
    with open(os.path.join(DOCS_DIR, 'narration.srt'), 'w', encoding='utf-8') as f:
        for i, (s, e, text) in enumerate(sorted(cues), 1):
            f.write(f'{i}\n{srt_time(s)} --> {srt_time(e)}\n{text}\n\n')
    with open(os.path.join(DOCS_DIR, 'narration.txt'), 'w', encoding='utf-8') as f:
        f.write('회비자동산출시스템 시연 영상 내레이션 (v2)\n\n')
        for s, e, label, text in txt:
            f.write(f'[{mmss(s)}–{mmss(e)}] {label}\n{text}\n\n')
    json.dump({'total': total, 'xfade': XFADE,
               'modules': [{'id': m['id'], 'kind': m['kind'], 'start': m['t0'], 'duration': m['dur'], 'speed': m['speed'],
                            'beats': [{'id': b['id'], 'start': m['t0'] + b['start'] / m['speed'], 'end': m['t0'] + b['end'] / m['speed']} for b in m['beats']]}
                           for m in mods]},
              open(os.path.join(DOCS_DIR, 'timeline.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'total {mmss(total)} ({total:.1f}s)')
    for m in mods:
        print(f'  {mmss(m["t0"])} ({m["t0"]:6.1f})  {m["id"]:16s} {m["dur"]:5.1f}s ×{m["speed"]}')
    if args.subs_only:
        return

    # ── 모듈별 자막 클립 (검토·부분 교체용) ──
    if not args.no_module_clips and not preview:
        for m in mods:
            ass = Ass()
            build_events(ass, m, 0.0, m['speed'], True)
            path = os.path.join(OUT, f'{m["id"]}.ass')
            ass.dump(path)
            out = os.path.join(VIDEO, 'modules', f'{m["id"]}.mp4')
            print('render module', m['id'], '…', flush=True)
            ffmpeg(['-i', m['file'], '-filter_complex', f"[0:v]setpts=PTS/{m['speed']},fps=30,format=yuv420p,subtitles='{path}'[vo]",
                    '-map', '[vo]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])

    # ── 전체: 배속 → 크로스페이드 → 처음/끝 페이드 → 자막 → 무음 오디오 ──
    inputs, chains = [], []
    for i, m in enumerate(mods):
        inputs += ['-i', m['file']]
        chains.append(f'[{i}:v]setpts=PTS/{m["speed"]},fps=30,format=yuv420p[v{i}]')
    prev = '[v0]'
    for k in range(1, len(mods)):
        lab = f'[x{k}]'
        chains.append(f'{prev}[v{k}]xfade=transition=fade:duration={XFADE}:offset={mods[k]["t0"]:.3f}{lab}')
        prev = lab
    chains.append(f'{prev}fade=t=in:st=0:d=0.5,fade=t=out:st={max(0, total - 0.8):.3f}:d=0.8[vb]')
    base = ';'.join(chains)
    for name, (ass_path, _c, _t) in outputs.items():
        out = os.path.join(VIDEO_DIR, f'{prefix}{name}.mp4')
        print('render', os.path.basename(out), '…', flush=True)
        ffmpeg([*inputs, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
                '-filter_complex', base + f";[vb]subtitles='{ass_path}'[vo]", '-map', '[vo]', '-map', f'{len(mods)}:a', '-shortest',
                '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30',
                '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out])
    print('done')


if __name__ == '__main__':
    main()
