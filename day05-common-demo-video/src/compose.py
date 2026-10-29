"""녹화 프레임 + 타이틀 카드 + 자막을 1920x1080 30fps 영상으로 합성한다.

python3 compose.py            # 전체 렌더 → out/video_noaudio.mp4
python3 compose.py --still 12.5 40 ...   # 해당 시각 프레임만 shots/still_*.png
python3 compose.py --plan     # 장면별 시작 시각·총 길이만 출력
"""
import json, os, sys, subprocess, math, re
from functools import lru_cache
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
REC = os.path.join(HERE, 'rec')
OUT = os.path.join(HERE, 'out')
FONT_DIR = os.path.expanduser('~/.fonts')
LOGO = os.path.join(HERE, '..', '..', 'day01-gyeongsik-fee-calculator', 'public', 'kftc-symbol.png')
W, H, FPS = 1920, 1080, 30
VW, VH = 1600, 900            # 녹화 뷰포트(좌표 기준)
WIN_X, WIN_Y = 160, 34        # 앱 창 위치
XF = 0.45                     # 장면 사이 크로스페이드(초)

BG_LIGHT = (245, 245, 247)
INK = (29, 29, 31)
GRAY = (134, 134, 139)
BLUE = (0, 113, 227)


def font(weight, size):
    return ImageFont.truetype(os.path.join(FONT_DIR, f'Pretendard-{weight}.otf'), size)


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def ease_out(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


# ───────── 리치 텍스트 ( *강조* 는 파란색 ) ─────────
def rich_parts(text):
    parts = re.split(r'(\*[^*]+\*)', text)
    return [(p[1:-1], True) if p.startswith('*') else (p, False) for p in parts if p]


def draw_rich(img, text, fnt, cx, y, color, accent, gradient=False):
    d = ImageDraw.Draw(img)
    parts = rich_parts(text)
    widths = [d.textlength(p, font=fnt) for p, _ in parts]
    x = cx - sum(widths) / 2
    for (p, hi), w in zip(parts, widths):
        if hi and gradient:
            grad_text(img, p, fnt, x, y)
        else:
            d.text((x, y), p, font=fnt, fill=accent if hi else color)
        x += w


def grad_text(img, text, fnt, x, y, c1=(41, 151, 255), c2=(94, 230, 255)):
    d0 = ImageDraw.Draw(img)
    x, y = int(round(x)), int(round(y))
    bbox = [int(v) for v in d0.textbbox((x, y), text, font=fnt)]
    w, h = bbox[2] - bbox[0] + 4, bbox[3] - bbox[1] + 4
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).text((x - bbox[0] + 2, y - bbox[1] + 2), text, font=fnt, fill=255)
    grad = Image.new('RGB', (w, h))
    gd = ImageDraw.Draw(grad)
    for i in range(w):
        k = i / max(1, w - 1)
        gd.line([(i, 0), (i, h)], fill=tuple(int(c1[j] + (c2[j] - c1[j]) * k) for j in range(3)))
    img.paste(grad, (bbox[0] - 2, bbox[1] - 2), mask)


# ───────── 앱 창(둥근 모서리·그림자) ─────────
def make_window_layers():
    r = 18
    mask = Image.new('L', (VW, VH), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, VW - 1, VH - 1], r, fill=255)
    bg = Image.new('RGB', (W, H), BG_LIGHT)
    sh = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sh).rounded_rectangle([WIN_X, WIN_Y + 14, WIN_X + VW, WIN_Y + VH + 14], r, fill=70)
    sh = sh.filter(ImageFilter.GaussianBlur(28))
    bg = Image.composite(Image.new('RGB', (W, H), (0, 0, 0)), bg, sh)
    border = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle([WIN_X - 1, WIN_Y - 1, WIN_X + VW, WIN_Y + VH], r + 1, outline=(0, 0, 0, 28), width=1)
    return mask, bg, border


WIN_MASK, WIN_BG, WIN_BORDER = make_window_layers()


@lru_cache(maxsize=None)
def scene_meta(name):
    m = json.load(open(os.path.join(REC, name, 'meta.json')))
    m['ts'] = [f[0] for f in m['frames']]
    return m


_frame_cache = {}


def scene_frame(name, t):
    m = scene_meta(name)
    ts = m['ts']
    lo, hi = 0, len(ts) - 1
    if t <= ts[0]:
        idx = 0
    else:
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if ts[mid] <= t:
                lo = mid
            else:
                hi = mid - 1
        idx = lo
    key = (name, idx)
    if key not in _frame_cache:
        if len(_frame_cache) > 6:
            _frame_cache.clear()
        _frame_cache[key] = Image.open(os.path.join(REC, name, m['frames'][idx][1])).convert('RGB')
    return _frame_cache[key]


def resolve(name, v):
    """'mark' 또는 'mark+1.2' 또는 숫자 → 장면 시각(초)"""
    if isinstance(v, (int, float)):
        return float(v)
    mm = re.match(r'^([a-z]+)([+-][\d.]+)?$', v)
    base = scene_meta(name)['marks'][mm.group(1)]
    return base + (float(mm.group(2)) if mm.group(2) else 0.0)


# ───────── 세그먼트 ─────────
class Demo:
    """parts: [(in, out, speed)], zoom: [(src_t, z, cx, cy)], subs: [(out_from, out_to, text)]"""

    def __init__(self, scene, parts, zoom=None, subs=None):
        self.scene = scene
        end = scene_meta(scene)['end']
        self.parts = [(min(resolve(scene, a), end), min(resolve(scene, b), end), s) for a, b, s in parts]
        self.zoom = sorted([(resolve(scene, t), z, cx, cy) for t, z, cx, cy in (zoom or [(0, 1, VW / 2, VH / 2)])])
        self.dur = sum((b - a) / s for a, b, s in self.parts)
        self.subs = []
        for a, b, txt in (subs or []):
            self.subs.append((self.out_of(a), self.out_of(b), txt))
        self.kind = 'demo'

    def out_of(self, v):
        """자막 시각: 숫자=세그먼트 출력 시각, 문자열=장면 마크(소스 시각) → 출력 시각"""
        if isinstance(v, (int, float)):
            return v if v >= 0 else self.dur + v
        st = resolve(self.scene, v)
        acc = 0.0
        for a, b, s in self.parts:
            if st <= b:
                return acc + max(0.0, st - a) / s
            acc += (b - a) / s
        return acc

    def src_time(self, t):
        acc = 0.0
        for a, b, s in self.parts:
            d = (b - a) / s
            if t <= acc + d:
                return a + (t - acc) * s
            acc += d
        return self.parts[-1][1]

    def zoom_at(self, st):
        kf = self.zoom
        if st <= kf[0][0]:
            return kf[0][1:]
        for (t0, z0, x0, y0), (t1, z1, x1, y1) in zip(kf, kf[1:]):
            if t0 <= st <= t1:
                k = ease((st - t0) / max(1e-6, t1 - t0))
                return (z0 + (z1 - z0) * k, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k)
        return kf[-1][1:]

    def render(self, t):
        st = self.src_time(t)
        src = scene_frame(self.scene, st)
        sw, sh = src.size
        sc = sw / VW
        z, cx, cy = self.zoom_at(st)
        cw, ch = VW / z, VH / z
        x0 = min(max(cx - cw / 2, 0), VW - cw)
        y0 = min(max(cy - ch / 2, 0), VH - ch)
        crop = src.resize((VW, VH), Image.LANCZOS, box=(x0 * sc, y0 * sc, (x0 + cw) * sc, (y0 + ch) * sc))
        img = WIN_BG.copy()
        img.paste(crop, (WIN_X, WIN_Y), WIN_MASK)
        img.paste(WIN_BORDER, (0, 0), WIN_BORDER)
        draw_subs(img, self.subs, t)
        return img


SUB_FONT = font('SemiBold', 40)
SUB_Y = WIN_Y + VH + 30


@lru_cache(maxsize=None)
def sub_layer(text):
    layer = Image.new('RGBA', (W, 90), (0, 0, 0, 0))
    draw_rich(layer, text, SUB_FONT, W / 2, 14, INK + (255,), BLUE + (255,))
    return layer


def draw_subs(img, subs, t):
    for a, b, txt in subs:
        if a - 0.05 <= t <= b + 0.05:
            k = min(ease((t - a) / 0.3), ease((b - t) / 0.3))
            if k <= 0:
                continue
            layer = sub_layer(txt)
            dy = int((1 - k) * 10)
            if k < 1:
                alpha = layer.getchannel('A').point(lambda v: int(v * k))
                layer = layer.copy()
                layer.putalpha(alpha)
            img.paste(layer, (0, SUB_Y + dy), layer)


class Card:
    """검은 배경 타이틀 카드. lines: [(text, style, appear_at)]"""

    STYLES = {
        'hero': (font('Bold', 104), (245, 245, 247)),
        'big': (font('Bold', 84), (245, 245, 247)),
        'mid': (font('SemiBold', 60), (245, 245, 247)),
        'sub': (font('Medium', 38), (161, 161, 166)),
        'num': (font('SemiBold', 40), (41, 151, 255)),
        'small': (font('Medium', 30), (134, 134, 139)),
    }

    def __init__(self, dur, lines, logo=False, gap=28, logo_at=0.0):
        self.dur, self.lines, self.logo, self.gap, self.logo_at = dur, lines, logo, gap, logo_at
        self.kind = 'card'
        self.subs = []

    def render(self, t):
        img = Image.new('RGB', (W, H), (0, 0, 0))
        d = ImageDraw.Draw(img)
        heights = []
        for text, style, _ in self.lines:
            f = self.STYLES[style][0]
            bb = d.textbbox((0, 0), text.replace('*', ''), font=f)
            heights.append(f.size * 1.18)
        logo_h = 150 if self.logo else 0
        total = sum(heights) + self.gap * (len(heights) - 1) + (logo_h + 40 if self.logo else 0)
        y = (H - total) / 2
        if self.logo:
            k = ease_out((t - self.logo_at) / 0.9)
            if k > 0:
                lg = logo_img(int(150 * (0.9 + 0.1 * k)))
                a = lg.getchannel('A').point(lambda v: int(v * k))
                lg2 = lg.copy(); lg2.putalpha(a)
                img.paste(lg2, (int(W / 2 - lg.width / 2), int(y + (150 - lg.height) / 2)), lg2)
            y += logo_h + 40
        for (text, style, at), hgt in zip(self.lines, heights):
            k = ease_out((t - at) / 0.7)
            if k > 0:
                f, col = self.STYLES[style]
                layer = Image.new('RGBA', (W, int(hgt) + 20), (0, 0, 0, 0))
                draw_rich(layer, text, f, W / 2, 0, col + (255,), BLUE + (255,), gradient=True)
                if k < 1:
                    layer.putalpha(layer.getchannel('A').point(lambda v: int(v * k)))
                img.paste(layer, (0, int(y + (1 - k) * 26)), layer)
            y += hgt + self.gap
        return img


@lru_cache(maxsize=None)
def logo_img(size):
    return Image.open(LOGO).convert('RGBA').resize((size, size), Image.LANCZOS)


# ───────── 타임라인 ─────────
def chapter(num, title, sub=None):
    lines = [(num, 'num', 0.0), (title, 'big', 0.15)]
    if sub:
        lines.append((sub, 'sub', 0.45))
    return Card(2.6, lines, gap=18)


TIMELINE = [
    Card(5.6, [
        ('회비 산출,', 'hero', 0.3),
        ('이제 *엑셀 한 장*이면 됩니다.', 'hero', 1.0),
        ('금융결제원 회비자동산출시스템', 'sub', 2.0),
    ], logo=False, gap=22),
    Card(5.4, [
        ('업무마다 다른 산정 기준.', 'mid', 0.2),
        ('수십 곳의 참가기관.', 'mid', 1.0),
        ('매 분기 반복되는 수작업.', 'mid', 1.8),
        ('이제, *자동으로.*', 'big', 3.0),
    ], gap=26),
    Demo('login', [(0.4, 'typing', 1.0), ('typing', 'in', 1.4), ('in', 'in+1.6', 1.0)],
         zoom=[(0, 1.0, 800, 450), ('typing-0.3', 1.0, 800, 450), ('typing+0.4', 1.45, 1190, 450), ('in-0.4', 1.45, 1190, 450), ('in+0.2', 1.0, 800, 450)],
         subs=[(0.3, 'in', '관리자 계정으로 로그인합니다.'), ('in+0.1', -0.1, '권한에 맞는 메뉴가 바로 열립니다.')]),
    chapter('01', '관리자 설정', '회원 · 업무 권한 · 업무 관리'),
    Demo('members', [(0.3, 'approve-0.2', 1.3), ('approve-0.2', 9.4, 1.1)],
         zoom=[(0, 1.0, 800, 450), (1.4, 1.0, 800, 450), (2.4, 1.18, 820, 330), ('approve-0.3', 1.18, 820, 330), ('approve+0.6', 1.3, 960, 700), ('unlock+3.0', 1.3, 960, 700), (9.2, 1.0, 800, 450)],
         subs=[(0.2, 'approve-0.1', '회원 현황을 한눈에 확인하고'), ('approve', 'unlock-0.1', '가입 신청은 *클릭 한 번*으로 승인합니다.'), ('unlock', -0.1, '잠긴 계정도 바로 해제합니다.')]),
    Demo('perm', [(0.3, 'approve-0.3', 1.3), ('approve-0.3', 8.6, 1.1)],
         zoom=[(0, 1.0, 800, 450), (1.2, 1.25, 900, 330), ('grant-0.6', 1.25, 900, 330), ('grant+0.4', 1.3, 920, 520), (8.4, 1.3, 920, 520)],
         subs=[(0.2, 'grant-0.2', '업무 권한 신청을 승인하고'), ('grant', -0.1, '담당자마다 필요한 업무 권한만 *차등 부여*합니다.')]),
    Demo('task', [(0.3, 'form', 1.3), ('form', 'create', 1.8), ('create', 'delete', 1.2), ('delete', 17.4, 1.5)],
         zoom=[(0, 1.0, 800, 450), ('form', 1.0, 800, 450), ('form+0.8', 1.3, 800, 330), ('create+0.3', 1.3, 800, 520), ('create+1.0', 1.0, 800, 450), ('added', 1.0, 800, 450), ('added+0.8', 1.35, 900, 560), ('delete+0.6', 1.35, 900, 560), ('delete+1.4', 1.0, 800, 450)],
         subs=[(0.2, 'create-0.1', '개발 없이도 *새 업무*를 직접 추가합니다.'), ('create', 'delete-0.1', '회비 기준 문서(md)가 함께 만들어집니다.'), ('delete', -0.1, '쓰지 않는 업무는 경고 확인 후 삭제합니다.')]),
    chapter('02', '회비 산출 및 대사', 'CD공동망 · 오픈뱅킹 실적으로 시연'),
    Demo('cd', [(0.4, 'rules+1.6', 1.3), ('rules+1.6', 'issue', 1.1), ('issue', 'calc', 2.4), ('calc', 'result', 1.1), ('result', 'badge+2.0', 1.3), ('total-0.6', 41.5, 1.1)],
         zoom=[(0, 1.0, 800, 450), ('period+0.3', 1.0, 800, 450), ('rules-0.2', 1.4, 1180, 300), ('rules+1.5', 1.4, 1180, 300), ('rules+2.4', 1.0, 800, 450),
               ('parsed-0.6', 1.0, 800, 450), ('parsed+0.2', 1.55, 640, 520), ('issue-0.2', 1.55, 640, 520), ('issue+0.6', 1.5, 1180, 420), ('calc-0.3', 1.5, 1180, 420),
               ('calc+0.5', 1.0, 800, 450), ('result+1.2', 1.0, 800, 450), ('badge-0.6', 1.45, 1160, 520), ('badge+2.0', 1.45, 1160, 520),
               ('total-0.6', 1.0, 800, 450), ('total+0.2', 1.0, 800, 450), ('total+1.0', 1.6, 1100, 760), (41.5, 1.6, 1100, 760)],
         subs=[(0.3, 'rules-0.4', '산출할 *업무*와 *기간*을 고르면'), ('rules-0.3', 'upload-0.2', '업무별 회비 기준이 한눈에 요약됩니다.'),
               ('upload', 'issue-0.1', '실적 엑셀을 올리면 *표 구조를 스스로 판별*합니다.'), ('issue', 'calc-0.1', '장애·재처리 같은 예외는 *문장으로* 입력하면 차감됩니다.'),
               ('calc', 'badge-0.6', '버튼 하나로 회비 초안을 산출합니다.'), ('badge-0.5', 'total-0.7', '10원 단위 절상 같은 *특이사항*도 자동 반영.'),
               ('total-0.5', -0.1, '50개 기관, 총 3억 원. *1원의 오차도 없이.*')]),
    Demo('ob', [(0.3, 'upload', 1.4), ('upload', 'goreg', 1.1), ('goreg', 'form', 1.6), ('form', 'reg', 2.0), ('reg', 'back', 1.6), ('back', 'reupload', 2.0),
                ('reupload', 'chips', 1.0), ('chips', 'calc', 1.2), ('calc', 'result', 1.4), ('result', 65.6, 1.2)],
         zoom=[(0, 1.0, 800, 450), ('upload+0.8', 1.0, 800, 450), ('unmatched-0.3', 1.2, 960, 640), ('goreg-0.4', 1.2, 960, 640), ('goreg+0.5', 1.0, 800, 450),
               ('form-0.6', 1.0, 800, 450), ('form-0.1', 1.5, 800, 470), ('reg+0.4', 1.5, 800, 470), ('reg+1.0', 1.0, 800, 450),
               ('reupload+0.8', 1.0, 800, 450), ('chips-0.3', 1.5, 640, 600), ('calc-0.4', 1.5, 640, 600), ('calc+0.3', 1.0, 800, 450),
               ('result+1.0', 1.0, 800, 450), ('result+2.0', 1.3, 1000, 560), ('excel-0.4', 1.3, 1000, 560), ('excel+0.4', 1.5, 1220, 420), (65.6, 1.5, 1220, 420)],
         subs=[(0.3, 'upload-0.1', '오픈뱅킹은 형식이 전혀 다른 *월별 API 실적*입니다.'), ('upload', 'unmatched-0.1', '기관·기준월·건수 열을 알아서 찾아냅니다.'),
               ('unmatched', 'goreg+0.3', '등록되지 않은 기관 *울릉도*는 바로 알려 줍니다.'), ('goreg+0.4', 'reg+0.3', '기관 관리에서 *새 기관을 등록*하면'),
               ('reg+0.4', 'reupload-0.1', '파일을 다시 올리기만 하면 됩니다. *개발자 없이도.*'), ('reupload', 'chips-0.1', '50개 기관 *모두 매칭*.'),
               ('chips', 'calc-0.1', '조회성 API를 빼면, 실적이 *즉시 다시 계산*됩니다.'), ('calc', 'excel-0.1', '구간별 차등 단가가 기관마다 자동 적용됩니다.'),
               ('excel', -0.1, '대사용 · 수입결의용 *엑셀*까지 바로 내려받습니다.')]),
    chapter('03', '회비 기준 관리', '업무별 기준 문서(md)로 AI와 함께'),
    Demo('skill', [(0.3, 'builder', 1.35), ('builder+3.6', 30.5, 1.3)],
         zoom=[(0, 1.0, 800, 450), ('doc+0.6', 1.0, 800, 450), ('doc+1.4', 1.35, 1030, 380), ('formula-0.3', 1.35, 1030, 380), ('formula+0.5', 1.3, 1030, 560), ('special+1.6', 1.3, 1030, 560),
               ('preview-0.2', 1.0, 800, 450), ('preview+0.8', 1.0, 800, 450), ('preview+1.6', 1.3, 1030, 560), ('builder', 1.3, 1030, 560), ('builder+3.6', 1.0, 800, 450), ('sim', 1.0, 800, 450), ('sim+1.0', 1.3, 1000, 620), (30.5, 1.3, 1000, 620)],
         subs=[(0.3, 'formula-0.1', '회비 기준은 업무별 *문서 하나*로 관리합니다.'), ('formula', 'special-0.1', '사람이 읽는 규칙과 정산 수식이 한곳에.'),
               ('special', 'preview-0.1', '특이사항은 스크립트로 바뀌어 *늘 같은 결과*를 냅니다.'), ('preview', 'builder-0.1', '누구나 읽을 수 있는 문서, 그대로가 계산 기준입니다.'),
               ('builder+3.6', -0.1, '*AI 계산식 빌더*로 수식을 만들고 시뮬레이션으로 검증합니다.')]),
    chapter('04', '내 정보 관리'),
    Demo('me', [(0.3, 10.0, 1.2)],
         zoom=[(0, 1.0, 800, 450), (0.9, 1.6, 560, 280), ('perm-0.3', 1.6, 560, 280), ('perm+0.6', 1.0, 800, 450), ('perm+1.2', 1.45, 760, 320), (10.0, 1.45, 760, 320)],
         subs=[(0.2, 'perm-0.1', '담당자는 자기 정보를 *직접* 수정하고'), ('perm', -0.1, '내 업무 권한도 한 화면에서 확인합니다.')]),
    Card(3.0, [('모든 부서, 모든 담당자가', 'big', 0.1), ('*같은 화면*에서 씁니다.', 'big', 0.6)], gap=18),
    Demo('user', [(0.3, 1.0, 1.0), (1.0, 'in', 1.9), ('in', 18.0, 1.1)],
         zoom=[(0, 1.0, 800, 450), ('in+0.2', 1.0, 800, 450), ('locks-0.5', 1.0, 800, 450), ('locks+0.3', 1.6, 470, 420), ('popup-0.3', 1.6, 470, 420), ('popup+0.5', 1.35, 1000, 520), (18.0, 1.35, 1000, 520)],
         subs=[(0.2, 'in', '일반 담당자로 로그인하면'), ('in', 'locks-0.1', '권한이 있는 업무만 산출할 수 있습니다.'),
               ('locks', 'popup-0.1', '방금 부여한 *CD공동망* 권한이 바로 반영되고'), ('popup', -0.1, '권한이 없으면 *신청 안내*로 이어집니다.')]),
    Card(7.0, [
        ('엑셀을 올리면,', 'hero', 0.6),
        ('*회비가 나옵니다.*', 'hero', 1.3),
        ('관리자 설정  ·  회비 산출  ·  회비 기준 관리  ·  내 정보 관리', 'sub', 2.4),
        ('금융결제원 회비자동산출시스템', 'small', 3.0),
    ], logo=True, logo_at=0.0, gap=20),
]


NARRATION = [
    (0, 0.5, 5.4, '회비 산출, 이제 엑셀 한 장이면 됩니다.'),
    (1, 0.55, 5.25, '업무마다 다른 기준, 매 분기 반복되는 수작업. 이제 자동으로.'),
    (2, 0.6, -0.4, '관리자 계정으로 로그인하면, 권한에 맞는 메뉴가 바로 열립니다.'),
    (3, 0.15, 2.2, '관리자 설정.'),
    (4, 0.4, -0.3, '가입 신청은 클릭 한 번으로 승인하고, 잠긴 계정도 바로 풀 수 있습니다.'),
    (5, 0.4, -0.3, '업무 권한은 담당자마다 필요한 만큼만 차등 부여합니다.'),
    (6, 0.4, -0.3, '개발 없이도 새 업무를 직접 추가합니다. 회비 기준 문서가 함께 만들어지고, 쓰지 않는 업무는 확인 후 삭제합니다.'),
    (7, 0.2, 2.3, '회비 산출.'),
    (8, 0.45, 'upload-0.2', '산출할 업무와 기간을 고르면, 업무별 회비 기준이 한눈에 요약됩니다.'),
    (8, 'upload+0.15', 'calc-0.1', '실적 엑셀을 올리면 표 구조를 스스로 읽고, 예외 상황은 문장 한 줄로 차감합니다.'),
    (8, 'calc+0.2', -0.3, '버튼 하나로 회비 초안이 나옵니다. 특이사항까지 반영해, 50개 기관 총 3억 원을 1원의 오차 없이 맞춥니다.'),
    (9, 0.45, 'unmatched-0.1', '오픈뱅킹은 형식이 전혀 다른 월별 실적이지만, 필요한 열을 알아서 찾아냅니다.'),
    (9, 'chips+0.1', 'excel-0.2', '조회성 API를 빼면 실적이 즉시 다시 계산되고, 구간별 차등 단가가 기관마다 자동으로 적용됩니다.'),
    (9, 'excel+0.1', -0.3, '대사용, 수입결의용 엑셀까지 바로 내려받습니다.'),
    (10, 0.4, 2.3, '회비 기준 관리.'),
    (11, 0.45, 'builder-0.1', '회비 기준은 업무별 문서 하나로 관리합니다. 사람이 읽는 규칙이 그대로 계산 기준이 되고, 특이사항은 늘 같은 결과를 내도록 스크립트로 바뀝니다.'),
    (11, 'builder+3.75', -0.3, 'AI 계산식 빌더로 수식을 만들고, 시뮬레이션으로 미리 검증합니다.'),
    (12, 0.25, 2.2, '내 정보 관리.'),
    (13, 0.3, -0.3, '담당자는 자기 정보를 직접 수정하고, 내 업무 권한도 한 화면에서 확인합니다.'),
    (14, 0.2, 4.3, '모든 부서, 모든 담당자가 같은 화면에서 씁니다.'),
    (15, 2.3, -0.3, '일반 담당자는 권한이 있는 업무만 쓸 수 있고, 방금 부여한 권한도 바로 반영됩니다. 권한이 없으면 신청 안내로 이어집니다.'),
    (16, 0.6, 6.9, '엑셀을 올리면, 회비가 나옵니다. 금융결제원 회비자동산출시스템.'),
]


def narration_json(starts):
    out = []
    for i, a, b, text in NARRATION:
        seg = TIMELINE[i]
        conv = seg.out_of if seg.kind == 'demo' else (lambda v: v if v >= 0 else seg.dur + v)
        out.append({'at': round(starts[i] + conv(a), 2), 'until': round(starts[i] + conv(b), 2), 'text': text})
    return out


def layout():
    starts, t = [], 0.0
    for i, seg in enumerate(TIMELINE):
        starts.append(t)
        t += seg.dur - (XF if i < len(TIMELINE) - 1 else 0)
    return starts, t


def frame_at(T, starts):
    active = [(i, T - s) for i, s in enumerate(starts) if s <= T < s + TIMELINE[i].dur]
    if not active:
        return TIMELINE[-1].render(TIMELINE[-1].dur - 1e-3)
    if len(active) == 1:
        i, t = active[0]
        img = TIMELINE[i].render(t)
    else:
        (i0, t0), (i1, t1) = active[-2], active[-1]
        k = ease(t1 / XF)
        img = Image.blend(TIMELINE[i0].render(t0), TIMELINE[i1].render(t1), k)
    # 처음·끝 페이드
    total = starts[-1] + TIMELINE[-1].dur
    fade = min(1.0, T / 0.5, (total - T) / 1.0)
    if fade < 1:
        img = Image.blend(Image.new('RGB', (W, H), (0, 0, 0)), img, max(0.0, fade))
    return img


def main():
    starts, total = layout()
    total = starts[-1] + TIMELINE[-1].dur
    if '--plan' in sys.argv:
        for seg, s in zip(TIMELINE, starts):
            name = seg.scene if seg.kind == 'demo' else 'card'
            print(f'{s:7.2f}  {seg.dur:6.2f}  {name}')
        print(f'TOTAL {total:.2f}s')
        return
    if '--still' in sys.argv:
        ts = [float(x) for x in sys.argv[sys.argv.index('--still') + 1:]]
        for T in ts:
            frame_at(T, starts).save(os.path.join(HERE, 'shots', f'still_{T:06.2f}.png'))
        return
    if '--narration' in sys.argv:
        print(json.dumps(narration_json(starts), ensure_ascii=False, indent=1))
        return
    if '--subs' in sys.argv:
        for seg, s in zip(TIMELINE, starts):
            for a, b, txt in seg.subs:
                print(f'{s + a:7.2f} {s + b:7.2f}  {txt}')
        return
    os.makedirs(OUT, exist_ok=True)
    n = int(round(total * FPS))
    out = os.path.join(OUT, 'video_noaudio.mp4')
    p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                          '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], stdin=subprocess.PIPE)
    for f in range(n):
        T = f / FPS
        p.stdin.write(frame_at(T, starts).tobytes())
        if f % 300 == 0:
            print(f'{f}/{n}', flush=True)
    p.stdin.close()
    p.wait()
    print('done', out, f'{total:.2f}s')


if __name__ == '__main__':
    main()
