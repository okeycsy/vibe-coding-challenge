# Day05 — 회비자동산출시스템 시연 영상 (공통)

- **날짜**: 2026-10-29
- **도구**: Claude Code (Playwright + ffmpeg + Pillow)
- **한 줄 소개**: 회비자동산출시스템(경식 폴더, main 코드)을 관리자 계정으로 돌려 보며 핵심 기능을 녹화하고, 애플 제품 영상 문법의 타이틀 카드·자막·배경음·나레이션을 입혀 2분 55초 시연 영상으로 만드는 제작 파이프라인

## 만든 것
사내 공모전용 시연 영상. 완성본(mp4)·자막(srt)·나레이션 대본은 용량 때문에 저장소가 아니라 프로젝트 Library(`demo-video/`)에 두었고, 여기에는 다시 만들 수 있는 스크립트만 둔다.

| 파일 | 역할 |
|------|------|
| `src/rec.js` | Playwright(CDP screencast)로 장면 9개를 녹화. 장면마다 프레임(JPEG)과 이벤트 마크(`meta.json`)를 남겨 편집 때 "업로드 직후", "산출 결과" 같은 순간을 시각으로 잡을 수 있음 |
| `src/compose.py` | 타임라인(타이틀 카드 + 장면별 구간 속도·줌·자막)을 1920×1080 30fps 영상으로 합성. `--plan`(장면별 시작 시각), `--subs`(자막 목록), `--narration`(나레이션 대본 시각), `--still t…`(특정 시각 스틸) |
| `src/music.py` | 저작권 걱정 없는 배경음(패드·플럭 아르페지오·소프트 킥)을 직접 합성 |
| `src/dub_mix.py` | 사람이 대본을 순서대로 읽은 더빙 mp3를 문장 단위로 잘라 장면 시각에 배치하고, 말소리 구간에서 배경음을 자동으로 낮춰(사이드체인) 합침 |
| `src/tts_mix.py` | 더빙 대신 Google Cloud TTS로 나레이션을 만들 때 쓰는 같은 흐름 (`GOOGLE_TTS_API_KEY` 환경변수 필요) |
| `src/narration.json` | 나레이션 대본 22줄과 각 줄이 들어갈 시각(`compose.py --narration` 출력) |

영상 구성(2분 55초): 타이틀 → 문제 제기 → 관리자 로그인 → ① 관리자 설정(가입 승인·잠금 해제, 업무 권한 승인·부여, 업무 추가·삭제) → ② 회비 산출(CD공동망 실적 업로드·이슈 차감·3억 원 정산, 오픈뱅킹 월별 API 실적에서 미등록 기관 감지 → 기관 관리 등록 → 재업로드 → 조회성 API 제외 → 산출·엑셀 2종) → ③ 회비 기준 관리(기준 문서, AI 계산식 빌더) → ④ 내 정보 관리 → 일반 담당자 화면(권한별 접근) → 마무리.

## 실행 방법
앱은 공개 주소 대신 같은 main 코드를 로컬에 띄워 녹화한다(작업 환경에서 vercel.app·onrender.com 접속이 막혀 있었음).

```bash
# 1) 앱 띄우기 (day01-gyeongsik-fee-calculator)
cd day01-gyeongsik-fee-calculator
(cd backend && mvn -q -DskipTests package)
CORS_ALLOWED_ORIGINS=http://localhost:4173 java -jar backend/target/fee-calc-backend-0.0.1-SNAPSHOT.jar &
VITE_API_BASE_URL=http://localhost:8080 npx vite build && npx vite preview --port 4173 &

# 2) 녹화 → 합성 → 배경음 → 더빙 (day05-common-demo-video/src)
cd ../day05-common-demo-video/src
APP_PW='<관리자 비밀번호>' node rec.js          # 비밀번호는 환경변수로만, 파일에 두지 않는다
python3 compose.py --plan                      # 총 길이 확인 (2:30~3:00)
python3 compose.py                             # out/video_noaudio.mp4
python3 music.py <총길이초> out/music.wav
python3 compose.py --narration > narration.json
python3 dub_mix.py <더빙.mp3>                   # 완성본 mp4
```

필요한 것: Node 18+ 와 `playwright`(Chromium), Python 3 + `numpy`·`Pillow`·`openpyxl`, `ffmpeg`, Pretendard 글꼴(`~/.fonts`). 실적 엑셀 2종(CD공동망·오픈뱅킹 테스트 데이터)은 `rec.js` 의 `FILES` 경로에 둔다(저장소에는 넣지 않음. CD공동망 파일은 업로드 규칙상 맨 위에 `2026년 3분기 이용실적` 제목 행이 필요).

## 사용한 프롬프트 / 과정
- John: 관리자 계정으로 접속해 중요 기능 위주 시연 영상, 애플·테크 기업 문법, 2분 30초~3분, 자막/나레이션, 평가 기준(① 엑셀 넣으면 자동 산출 ② 모든 부서·담당자가 쓸 수 있는가)에 맞출 것. 첨부 실적 파일(CD공동망·오픈뱅킹)로 산정.
- 1차(10/27): 자막 + 배경음. 2차(10/29): John 이 직접 녹음한 더빙 mp3를 문장 단위로 잘라 배치. 3차(10/29): 오픈뱅킹 테스트 데이터를 교체(우체국 → 미등록 기관 울릉도)하고 최신 main(10/28 AI 변수 생성 반영)으로 전 장면 재녹화. 미등록 기관을 감지해 기관 관리에서 등록하고 다시 올리는 흐름을 영상에 추가.

## 배운 점
- Playwright `setInputFiles` 에 한글 경로를 주면 조용히 실패한다. `{ name, mimeType, buffer }` 로 넘기면 파일명도 한글로 보인다.
- 사이드 메뉴를 누르면 해당 섹션으로 부드럽게 스크롤되므로, 직후의 휠 스크롤이 덮어써진다. 클릭 헬퍼에서 대상이 화면 밖이면 스스로 스크롤하게 두는 편이 안전했다.
- 더빙 파일은 문장 사이를 0.6초 이상 쉬어 읽으면 무음 구간으로 잘라 자동 배치할 수 있어, 대본 시각이 바뀌어도 다시 녹음할 필요가 없다.

## 스크린샷
완성본과 자막은 프로젝트 Library `demo-video/` 에 있다.
