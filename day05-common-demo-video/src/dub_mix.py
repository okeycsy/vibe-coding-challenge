"""더빙 mp3(나레이션 대본을 순서대로 읽은 파일)를 문장 단위로 잘라 장면 시각에 맞춰 넣는다.

python3 dub_mix.py 더빙.mp3
- 무음 구간으로 말소리 구간을 찾고, 0.5초 이상 쉬는 곳을 문장 경계로 본다.
- 문장 수가 narration.json 대본 문장 수(마침표 기준)와 같아야 진행한다.
"""
import json, os, re, subprocess, sys
import numpy as np
from tts_mix import HERE, SR, write_wav, stretch

GAP = 0.55


def load(path):
    p = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True)
    return np.frombuffer(p.stdout, np.float32)


def speech_spans(x, thr_db=-35, min_sil=0.3):
    win = int(SR * 0.01)
    n = len(x) // win
    rms = np.sqrt((x[: n * win].reshape(n, win) ** 2).mean(1) + 1e-12)
    loud = 20 * np.log10(rms) > thr_db
    spans, start, quiet = [], None, 0
    for i, v in enumerate(loud):
        if v:
            if start is None:
                start = i
            quiet = 0
        elif start is not None:
            quiet += 1
            if quiet * 0.01 >= min_sil:
                spans.append((start * 0.01, (i - quiet + 1) * 0.01))
                start, quiet = None, 0
    if start is not None:
        spans.append((start * 0.01, n * 0.01))
    return [s for s in spans if s[1] - s[0] > 0.15]


def main():
    dub = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'out', '회비자동산출시스템_시연영상_나레이션.mp4')
    lines = json.load(open(os.path.join(HERE, 'narration.json')))
    x = load(dub)
    spans = speech_spans(x)
    # 문장 경계로 묶기
    sents = [list(spans[0])]
    for a, b in spans[1:]:
        if a - sents[-1][1] >= GAP:
            sents.append([a, b])
        else:
            sents[-1][1] = b
    counts = [len([s for s in re.split(r'(?<=\.)\s+', ln['text']) if s.strip()]) for ln in lines]
    if len(sents) != sum(counts):
        sys.exit(f'더빙 문장 {len(sents)}개, 대본 문장 {sum(counts)}개로 맞지 않습니다.')
    video = os.path.join(HERE, 'out', 'video_noaudio.mp4')
    dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]))
    track = np.zeros(int(dur * SR) + SR, np.float32)
    k = 0
    for ln, c in zip(lines, counts):
        a, b = sents[k][0], sents[k + c - 1][1]
        k += c
        clip = x[max(0, int((a - 0.04) * SR)): int((b + 0.12) * SR)].copy()
        f = int(0.02 * SR)
        clip[:f] *= np.linspace(0, 1, f); clip[-f:] *= np.linspace(1, 0, f)
        win = ln['until'] - ln['at']
        d = len(clip) / SR
        if d > win + 0.3:
            clip = stretch(clip, min(d / win, 1.2))
        i = int(ln['at'] * SR)
        seg = clip[: len(track) - i]
        track[i:i + len(seg)] += seg
        print(f'{ln["at"]:6.1f}s  {d:4.1f}s/{win:4.1f}s  {ln["text"]}')
    work = os.path.join(HERE, 'out', 'work'); os.makedirs(work, exist_ok=True)
    nar = os.path.join(work, 'narration.wav')
    write_wav(nar, track / max(1e-6, np.abs(track).max()) * 0.9)
    fc = ('[1:a]lowpass=f=7000,highpass=f=35,volume=0.5[m];'
          '[2:a]highpass=f=70,aformat=channel_layouts=stereo,asplit=2[v][k];'
          '[m][k]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=450[duck];'
          '[duck][v]amix=inputs=2:weights=1 1.6:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[a]')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', video, '-i', os.path.join(HERE, 'out', 'music.wav'), '-i', nar, '-filter_complex', fc,
                    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], check=True)
    print('done', out)


if __name__ == '__main__':
    main()
