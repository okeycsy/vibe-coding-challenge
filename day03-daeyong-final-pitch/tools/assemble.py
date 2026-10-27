#!/usr/bin/env python3
"""카드 4장 + 시연 테이크를 이어 붙이고, 내레이션 자막(ASS)을 굽는다.

사용: python3 assemble.py [--demo-speed 1.0] [--beat-speed 'B5 AI 이슈=0.85' ...] [--out-dir out/final]
입력: out/c0.mp4 c1.mp4 demo.mp4(+demo.json: 비트 marker) c8.mp4 c9.mp4
출력: <out-dir>/시연영상_v1_자막.mp4, 시연영상_v1_무자막.mp4, narration.ass/.srt/.txt, timeline.json

--demo-speed 는 시연 전체 배속, --beat-speed 는 특정 비트만 배속(여러 번 지정 가능). 둘 다 곱해진다.
"""
import argparse, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
CPS_WARN = 6.5  # 초당 글자 수가 이보다 크면 자막이 너무 빨리 지나간다

# 비트별 내레이션 (docs/scenario.md 5장과 동일). 문장 단위로 자막을 쪼갠다.
NARRATION = {
    'c0': ['분기마다, 금융결제원은 수십 개 참가기관의 회비를 산출합니다.',
           '업무마다 기준이 다르고, 실적 파일의 모양도 다릅니다.',
           '지금까지 이 계산은 사람의 손과 엑셀에 있었습니다.'],
    'c1': ['그래서 만들었습니다. 회비자동산출시스템.',
           '규칙을 문장으로 쓰면, 시스템이 회비를 계산합니다.'],
    'B2 규칙 문서': ['모든 업무의 기준은 skill.md, 문서 한 장입니다.',
                  '비즈니스 규칙, AI 예외 지침, 정산 수식, 최종 정산 특이사항.',
                  '이 네 개 섹션이 전부입니다. 담당자는 코드가 아니라 문장을 고칩니다.'],
    'B3 AI 수식': ['수식은 AI가 씁니다.',
                 '1번 규칙을 읽은 AI가 정산 수식을 만들고,',
                 '구문 검사와 시험 계산 두 벌을 통과해야만 반영됩니다.',
                 '담당자는 확인하고, 확정만 누릅니다.'],
    'B4 업로드': ['실적 파일은 형식을 정하지 않습니다.',
                '월별 API 원본을 그대로 올리면, 머리글과 기관, 기준월을 스스로 찾아냅니다.',
                '조회성 API는 칩 하나로 뺍니다.',
                '50개 기관, 3개월의 실적이 바로 합산됩니다.'],
    'B5 AI 이슈': ['예외는 말로 합니다.',
                 "'한빛은행 장애로 중복 전송된 1,500건은 빼 줘.'",
                 '지침에 맞는 이슈만 차감하고,',
                 '이용기관 쪽 단순 오류는 근거와 함께 제외합니다.'],
    'B6 산출·검증': ['산출은 두 단계입니다.',
                  '수식으로 계산하고, 특이사항 스크립트로 끝전을 맞춥니다.',
                  '10원 단위 절상, 차이분은 실적 순으로 절삭.',
                  '합계는 정확히 3억 원. 검증까지 자동입니다.'],
    'B7 대사': ['결과는 대사용과 수입결의용, 엑셀 두 벌로 나갑니다.'],
    'B7b 참가기관': ['참가기관은 자기 회비만 보고,',
                  '이상 없음 또는 이의 제기로 회신합니다.'],
    'c8': ['이 모든 것을 바이브코딩으로, 2주 만에 만들었습니다.',
           'PR 38개, 자동 테스트 58개,',
           '서버와 브라우저의 계산 결과 1,320건 일치.'],
    'c9': ['규칙을 쓰면, 회비가 계산됩니다.',
           '회비자동산출시스템이었습니다.'],
}


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


def spread(lines, start, end, gap=0.12, lead=0.25, tail=0.35):
    """비트 구간 안에서 문장 길이에 비례해 자막 시간을 배분한다."""
    usable = max(0.5, end - start - lead - tail - gap * (len(lines) - 1))
    total = sum(len(l) for l in lines)
    cues, t = [], start + lead
    for l in lines:
        d = max(1.2, usable * len(l) / total)
        cues.append((t, min(end - tail, t + d), l))
        t += d + gap
    return cues


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--demo-speed', type=float, default=1.0, help='시연 테이크 전체 배속 (1.2 = 20% 빠르게)')
    ap.add_argument('--beat-speed', action='append', default=[], help="비트별 배속, 예: 'B5 AI 이슈=0.85'")
    ap.add_argument('--out-dir', default=os.path.join(OUT, 'final'))
    ap.add_argument('--fade', type=float, default=0.45)
    ap.add_argument('--font-size', type=int, default=44)
    ap.add_argument('--subs-only', action='store_true', help='자막·타임라인 파일만 쓰고 렌더링은 건너뛴다')
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)
    beat_speed = {}
    for item in args.beat_speed:
        k, v = item.rsplit('=', 1)
        beat_speed[k.strip()] = float(v)

    # ── 시연 테이크를 비트 구간으로 나누고 배속을 정한다 (원본 시각 기준) ──
    demo_file = os.path.join(OUT, 'demo.mp4')
    demo_meta = json.load(open(os.path.join(OUT, 'demo.json')))
    demo_dur_raw = probe_duration(demo_file)
    marks = [m for m in demo_meta['markers'] if m['label'] != 'END']
    demo_beats = []  # (label, s_raw, e_raw, factor)
    for i, m in enumerate(marks):
        s = 0.0 if i == 0 else m['t']  # 첫 비트는 0초부터
        e = marks[i + 1]['t'] if i + 1 < len(marks) else demo_dur_raw
        f = args.demo_speed * beat_speed.get(m['label'], 1.0)
        demo_beats.append((m['label'], s, e, f))
    demo_dur = sum((e - s) / f for _, s, e, f in demo_beats)

    # ── 세그먼트 순서와 시작 시각 ──
    segs = []  # (name, file, duration)
    for name in ['c0', 'c1']:
        f = os.path.join(OUT, f'{name}.mp4'); segs.append((name, f, probe_duration(f)))
    segs.append(('demo', demo_file, demo_dur))
    for name in ['c8', 'c9']:
        f = os.path.join(OUT, f'{name}.mp4'); segs.append((name, f, probe_duration(f)))
    starts, t = {}, 0.0
    for name, _, d in segs:
        starts[name] = t
        t += d
    total = t

    # ── 비트 경계 (최종 영상 시각) ──
    beats = [('c0', starts['c0'], starts['c0'] + segs[0][2]), ('c1', starts['c1'], starts['c1'] + segs[1][2])]
    t = starts['demo']
    for label, s, e, f in demo_beats:
        d = (e - s) / f
        beats.append((label, t, t + d))
        t += d
    beats.append(('c8', starts['c8'], starts['c8'] + segs[3][2]))
    beats.append(('c9', starts['c9'], starts['c9'] + segs[4][2]))

    cues = []
    for label, s, e in beats:
        lines = NARRATION.get(label)
        if not lines:
            print('WARN no narration for', label, file=sys.stderr); continue
        cps = sum(len(l) for l in lines) / max(0.1, e - s)
        if cps > CPS_WARN:
            print(f'WARN {label}: {cps:.1f}자/초 — 구간 {e - s:.1f}s 가 짧다 (--beat-speed 로 늦추기)', file=sys.stderr)
        style = 'NarrCard' if label in ('c0', 'c1', 'c8', 'c9') else 'Narr'
        cues += [(cs, ce, text, style) for cs, ce, text in spread(lines, s, e)]

    # ── ASS: 하단 중앙, 로어서드(좌하단) 위에 뜨도록 MarginV 를 올린다 ──
    fs = args.font_size
    ass = [
        '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080', 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        # 시연 구간은 로어서드(좌하단) 위로 올리고(MarginV 200), 카드 구간은 아래쪽(MarginV 120)에 둔다
        f'Style: Narr,Pretendard,{fs},&H00FFFFFF,&H00FFFFFF,&H00101828,&H90000000,-1,0,0,0,100,100,-0.5,0,1,2.6,1.4,2,140,140,200,1',
        f'Style: NarrCard,Pretendard,{fs},&H00FFFFFF,&H00FFFFFF,&H00101828,&H90000000,-1,0,0,0,100,100,-0.5,0,1,2.6,1.4,2,140,140,120,1',
        '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ]
    for s, e, text, style in cues:
        ass.append(f'Dialogue: 0,{ass_time(s)},{ass_time(e)},{style},,0,0,0,,{{\\fad(160,160)}}{text}')
    ass_path = os.path.join(args.out_dir, 'narration.ass')
    open(ass_path, 'w', encoding='utf-8').write('\n'.join(ass) + '\n')
    srt = []
    for i, (s, e, text, _style) in enumerate(cues, 1):
        srt += [str(i), f'{srt_time(s)} --> {srt_time(e)}', text, '']
    open(os.path.join(args.out_dir, 'narration.srt'), 'w', encoding='utf-8').write('\n'.join(srt))
    txt = ['회비자동산출시스템 시연 영상 내레이션 (v1)', '']
    for label, s, e in beats:
        if label in NARRATION:
            txt += [f'[{mmss(s)}–{mmss(e)}] {label}', ' '.join(NARRATION[label]), '']
    open(os.path.join(args.out_dir, 'narration.txt'), 'w', encoding='utf-8').write('\n'.join(txt))
    json.dump({'total': total, 'segments': [{'name': n, 'start': starts[n], 'duration': d} for n, _, d in segs],
               'beats': [{'label': l, 'start': s, 'end': e} for l, s, e in beats],
               'demo_speed': args.demo_speed, 'beat_speed': beat_speed},
              open(os.path.join(args.out_dir, 'timeline.json'), 'w'), ensure_ascii=False, indent=1)

    # ── ffmpeg 필터: 세그먼트마다 페이드 인/아웃(딥 투 블랙) → concat → (자막) → 무음 오디오 ──
    fade = args.fade
    inputs, chains = [], []
    for i, (name, f, d) in enumerate(segs):
        inputs += ['-i', f]
        src = f'[{i}:v]'
        if name == 'demo':
            n = len(demo_beats)
            chains.append(f'{src}split={n}' + ''.join(f'[a{k}]' for k in range(n)))
            for k, (_, s, e, fac) in enumerate(demo_beats):
                chains.append(f'[a{k}]trim=start={s:.3f}:end={e:.3f},setpts=(PTS-STARTPTS)/{fac}[d{k}]')
            chains.append(''.join(f'[d{k}]' for k in range(n)) + f'concat=n={n}:v=1:a=0[vd]')
            src = '[vd]'
        chains.append(f'{src}fade=t=in:st=0:d={fade},fade=t=out:st={max(0, d - fade):.3f}:d={fade},format=yuv420p[v{i}]')
    concat = ''.join(f'[v{i}]' for i in range(len(segs))) + f'concat=n={len(segs)}:v=1:a=0[vc]'
    base_filter = ';'.join(chains + [concat])

    def render(out_file, with_subs):
        vf = base_filter + (f";[vc]subtitles='{ass_path}'[vo]" if with_subs else ';[vc]copy[vo]')
        cmd = ['ffmpeg', '-loglevel', 'error', '-y', *inputs, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
               '-filter_complex', vf, '-map', '[vo]', '-map', f'{len(segs)}:a', '-shortest',
               '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30',
               '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out_file]
        print('render', os.path.basename(out_file), '…', flush=True)
        subprocess.check_call(cmd)

    if args.subs_only:
        print(f'subs only; total {total:.1f}s'); return
    render(os.path.join(args.out_dir, '시연영상_v1_자막.mp4'), True)
    render(os.path.join(args.out_dir, '시연영상_v1_무자막.mp4'), False)
    print(f'total {total:.1f}s; beats:')
    for l, s, e in beats:
        print(f'  {mmss(s)} ({s:6.1f}) – {mmss(e)} ({e:6.1f})  {l}')


if __name__ == '__main__':
    main()
