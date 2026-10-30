"""나레이션(Google Cloud TTS) 생성 → 배경음 덕킹 믹스 → 시연 영상에 합치기.

필요: 환경변수 GOOGLE_TTS_API_KEY (Text-to-Speech API를 켠 Google Cloud 프로젝트의 API 키)
     또는 gcloud 로그인(ADC). 키는 파일에 저장하지 않는다.

python3 tts_mix.py                      # 기본 목소리로 생성·합성
python3 tts_mix.py --voice ko-KR-Neural2-A --rate 1.05
python3 tts_mix.py --test               # TTS 대신 신호음으로 믹스 경로만 시험
"""
import argparse, base64, io, json, os, subprocess, sys, urllib.request, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 48000


def synth(text, voice, rate, key):
    body = {
        'input': {'text': text},
        'voice': {'languageCode': 'ko-KR', 'name': voice},
        'audioConfig': {'audioEncoding': 'LINEAR16', 'sampleRateHertz': SR, 'speakingRate': rate},
    }
    url = 'https://texttospeech.googleapis.com/v1/text:synthesize'
    headers = {'Content-Type': 'application/json'}
    if key:
        url += '?key=' + key
    else:
        tok = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
        headers['Authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(url, json.dumps(body).encode(), headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = base64.b64decode(json.load(r)['audioContent'])
    with wave.open(io.BytesIO(data)) as w:
        pcm = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float32) / 32768
        assert w.getframerate() == SR and w.getnchannels() == 1
    return pcm


def tone(text):
    n = int(SR * min(6.0, 0.17 * len(text)))
    t = np.arange(n) / SR
    return (0.3 * np.sin(2 * np.pi * 220 * t) * np.minimum(1, t / 0.05)).astype(np.float32)


def trim(x, thr=0.004):
    idx = np.where(np.abs(x) > thr)[0]
    return x[idx[0]:idx[-1] + 1] if len(idx) else x


def stretch(x, factor):
    """factor>1 이면 빨라짐(ffmpeg atempo, 음높이 유지)"""
    p = subprocess.run(['ffmpeg', '-loglevel', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
                        '-af', f'atempo={factor:.4f}', '-f', 'f32le', '-'], input=x.tobytes(), capture_output=True, check=True)
    return np.frombuffer(p.stdout, np.float32)


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--voice', default='ko-KR-Neural2-C')
    ap.add_argument('--rate', type=float, default=1.0)
    ap.add_argument('--test', action='store_true')
    ap.add_argument('--video', default=os.path.join(HERE, 'out', 'video_noaudio.mp4'))
    ap.add_argument('--music', default=os.path.join(HERE, 'out', 'music.wav'))
    ap.add_argument('--out', default=os.path.join(HERE, 'out', '회비자동산출시스템_시연영상_나레이션.mp4'))
    a = ap.parse_args()
    key = os.environ.get('GOOGLE_TTS_API_KEY', '').strip()
    lines = json.load(open(os.path.join(HERE, 'narration.json')))
    dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', a.video]))
    track = np.zeros(int(dur * SR) + SR, np.float32)
    report = []
    for ln in lines:
        if ln.get('skip'):
            continue
        x = tone(ln['text']) if a.test else trim(synth(ln['text'], a.voice, a.rate, key))
        win = ln['until'] - ln['at']
        d = len(x) / SR
        if d > win:
            f = d / win
            if f > 1.25:
                print(f'!! 너무 김 ({d:.1f}s > {win:.1f}s, {f:.2f}배): {ln["text"]}', file=sys.stderr)
            x = stretch(x, min(f, 1.25))
        i = int(ln['at'] * SR)
        seg = x[: len(track) - i]
        track[i:i + len(seg)] += seg
        report.append(f'{ln["at"]:6.1f}s  {d:4.1f}s/{win:4.1f}s  {ln["text"]}')
    print('\n'.join(report))
    work = os.path.join(HERE, 'out', 'work'); os.makedirs(work, exist_ok=True)
    nar = os.path.join(work, 'narration.wav')
    write_wav(nar, track / max(1e-6, np.abs(track).max()) * 0.9)
    # 나레이션이 나올 때 배경음을 자동으로 낮춘다(사이드체인 덕킹)
    fc = ('[1:a]lowpass=f=7000,highpass=f=35,volume=0.55[m];'
          '[2:a]aformat=channel_layouts=stereo,asplit=2[v][k];'
          '[m][k]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[duck];'
          '[duck][v]amix=inputs=2:weights=1 1.6:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[a]')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', a.video, '-i', a.music, '-i', nar, '-filter_complex', fc,
                    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', a.out], check=True)
    print('done', a.out)


if __name__ == '__main__':
    main()
