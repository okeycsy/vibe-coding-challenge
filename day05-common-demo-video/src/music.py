"""잔잔한 테크 제품 영상용 배경음(패드 + 플럭 아르페지오 + 소프트 킥)을 직접 합성한다. 저작권 문제 없음."""
import sys, wave
import numpy as np

SR = 48000
DUR = float(sys.argv[1])
OUT = sys.argv[2]
BPM = 100
BEAT = 60 / BPM
BAR = BEAT * 4

n = int(DUR * SR)
t = np.arange(n) / SR
L = np.zeros(n); R = np.zeros(n)


def midi(m):
    return 440 * 2 ** ((m - 69) / 12)


# Cmaj9 – Am9 – Fmaj9 – G6(sus)  (2마디씩)
CHORDS = [
    [48, 55, 64, 67, 71, 74],
    [45, 52, 60, 64, 67, 71],
    [41, 48, 57, 60, 64, 67],
    [43, 50, 59, 62, 64, 69],
]
ARP = [
    [72, 76, 79, 83, 86, 83, 79, 76],
    [69, 72, 76, 79, 83, 79, 76, 72],
    [69, 72, 77, 79, 84, 79, 77, 72],
    [71, 74, 79, 81, 86, 81, 79, 74],
]
CH_LEN = BAR * 2

# 패드
for ci in range(int(DUR / CH_LEN) + 2):
    s0 = ci * CH_LEN - 0.6
    e0 = s0 + CH_LEN + 1.6
    i0, i1 = max(0, int(s0 * SR)), min(n, int(e0 * SR))
    if i0 >= i1:
        continue
    tt = t[i0:i1] - s0
    env = np.minimum(1, tt / 1.2) * np.minimum(1, (e0 - s0 - tt) / 1.4)
    env = np.clip(env, 0, 1) ** 1.5
    for k, m in enumerate(CHORDS[ci % 4]):
        f = midi(m)
        for det, pan in ((-0.12, 0.3), (0.12, 0.7)):
            ff = f * 2 ** (det / 12 * 0.5)
            w = np.sin(2 * np.pi * ff * tt + k) * 0.6 + np.sin(2 * np.pi * ff * 2 * tt) * 0.12
            amp = 0.05 if m > 50 else 0.07
            L[i0:i1] += w * env * amp * (1 - pan)
            R[i0:i1] += w * env * amp * pan

# 플럭 아르페지오 (8분음표), 8초 이후 시작
step = BEAT / 2
k = 0
while k * step < DUR:
    st = k * step
    if st >= 8.0:
        ci = int(st // CH_LEN) % 4
        m = ARP[ci][k % 8]
        f = midi(m)
        i0 = int(st * SR); i1 = min(n, i0 + int(1.6 * SR))
        tt = t[i0:i1] - st
        env = np.exp(-tt * 5.0) * np.minimum(1, tt / 0.004)
        w = np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * f * 2 * tt) * np.exp(-tt * 9)
        pan = 0.35 + 0.3 * ((k % 4) / 3)
        a = 0.055
        L[i0:i1] += w * env * a * (1 - pan)
        R[i0:i1] += w * env * a * pan
    k += 1

# 소프트 킥 (4분음표), 16초 이후 ~ 끝 8초 전
k = 0
while k * BEAT < DUR:
    st = k * BEAT
    if 16.0 <= st <= DUR - 8:
        i0 = int(st * SR); i1 = min(n, i0 + int(0.35 * SR))
        tt = t[i0:i1] - st
        f = 50 + 70 * np.exp(-tt * 30)
        ph = 2 * np.pi * np.cumsum(f) / SR
        w = np.sin(ph) * np.exp(-tt * 9) * 0.16
        L[i0:i1] += w; R[i0:i1] += w
    k += 1

# 간단한 리버브(피드백 딜레이 몇 개)
def reverb(x):
    y = x.copy()
    for d, g in ((0.031, 0.35), (0.047, 0.3), (0.071, 0.25), (0.113, 0.2), (0.173, 0.15)):
        dn = int(d * SR)
        z = np.zeros_like(x)
        z[dn:] = x[:-dn] * g
        y += z
    return y

L, R = reverb(L), reverb(R)
# 저역통과(1차)
def lp(x, fc=6500):
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x); acc = 0.0
    from scipy.signal import lfilter  # noqa
    return lfilter([1 - a], [1, -a], x)

try:
    L, R = lp(L), lp(R)
except Exception:
    pass

fade = np.minimum(1, t / 2.0) * np.minimum(1, (DUR - t) / 3.0)
L *= fade; R *= fade
peak = max(np.abs(L).max(), np.abs(R).max())
L = L / peak * 0.5; R = R / peak * 0.5
data = (np.stack([L, R], 1) * 32767).astype('<i2')
with wave.open(OUT, 'wb') as wv:
    wv.setnchannels(2); wv.setsampwidth(2); wv.setframerate(SR)
    wv.writeframes(data.tobytes())
print('ok', OUT)
