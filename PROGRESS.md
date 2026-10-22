# 진행 상황

> 세션마다 자동으로 읽힌다. 최신 내용을 위에 유지하고, 오래된 세션 로그는 아래로 쌓는다.

## 현재 상태
- 저장소 세팅 완료 (템플릿, GitHub 동기화 훅 — 로컬 main과 클라우드 `claude/*` 브랜치 모두 동작)
- 산출물: 아직 없음
- [경식] `day01-gyeongsik-fee-calculator/` 회비자동산출시스템 프론트엔드 1차 구현 완료 (Mock Data), `backend/`에 Spring Boot API 추가, 로그인·회원 승인·업무 권한 화면은 `VITE_API_BASE_URL` 설정 시 API와 연동 (백엔드 공개 주소 https://vibe-coding-challenge-bdm1.onrender.com, Render 무료 Web Service. Vercel `VITE_API_BASE_URL` 설정 완료)
- [대용] `day01-daeyong-fee-calculator/` 금융정보업무 회비 산출 v4 완료(통합 요구사항): 업무별 설정, 분기 배분 방식 A/B, 균등회비 방식 A/B, 실적 인정 항목, 우체국 10원 처리, 엑셀 열 매핑·검증·미리보기, 기관별 산출 근거·검증, 단일 HTML 프로그램 + claude.ai 웹 페이지. 확인 필요 기본값 목록은 `docs/DESIGN.md` 7장
- [우성] `day01-woosung-fee-ai/` 회비자동산출 AI툴 1차 구현 완료 (분담기준 AI 학습·버전 관리, xlsx/csv/hwp/hwpx 실적 업로드, 기관별 산출·Excel 다운로드)

- [경식] 회비자동산출시스템 공개 주소: https://vibe-coding-challenge-nine.vercel.app/ (Vercel, `main` push·병합 시 자동 재배포)

## 다음 할 일
- [ ] Day01 챌린지 과제 받아서 시작
- [ ] [경식] 회비자동산출시스템: 회비 산출·대사 화면 API 연결, 인증 토큰(세션/JWT)·API 역할 검사(지금 공개 API는 인증 없음), 업무별 분담기준 실제화
- [ ] [우성] 회비자동산출 AI툴: 실제 분담기준 문구로 Claude 학습 검증, 최저회비·상한 등 추가 산정 방식 필요 여부 확인

## 결정 사항
- 모노레포 1개 + `dayNN-<slug>/` 폴더 구조
- 세션 맥락은 GitHub의 `CLAUDE.md` / `PROGRESS.md`로 관리 (로컬 메모리 사용 안 함)
- 이 저장소가 모든 프레임워크·작업의 베이스. git 서브모듈은 두지 않는다
- `connect-link` 저장소와는 연결하지 않는다 (서브모듈·참조·수정 모두 금지)
- 공개 배포는 Vercel Git 연결로 한다 (Root Directory `day01-gyeongsik-fee-calculator`, Production Branch `main`). 토큰·GitHub Actions 배포는 쓰지 않는다

## 세션 로그
### 2026-10-22 (경식, 백엔드 배포)
- 시연 계정 기본 비밀번호를 `1234`에서 `kftc1234!!`로 변경(백엔드 DataInitializer·비밀번호 초기화, 프론트 mockData·로그인 안내, README)
- `backend/Dockerfile` 추가(Render 등 Docker 무료 호스팅용), `PORT`·`CORS_ALLOWED_ORIGINS`·`H2_CONSOLE_ENABLED` 환경변수, Vercel 주소 CORS 허용, `GET /api/health`. `mvn test` 11개 통과(Docker 빌드는 이 환경에서 Docker Hub 요청 제한으로 확인 못 함)
- Render 무료 Web Service `vibe-coding-challenge`(https://vibe-coding-challenge-bdm1.onrender.com)로 배포, Vercel에 `VITE_API_BASE_URL` 설정
- 프론트 `src/utils/api.js`: `VITE_API_BASE_URL`이 있으면 로그인·5회 잠금·잠금 해제·가입 승인/반려·비밀번호 변경/초기화·업무 권한 신청/승인/부여/해제를 서버와 연동, 없으면 기존 Mock 동작. 로그인 화면에 서버 깨우는 중/연결됨 표시
### 2026-10-22 (경식)
- `day01-gyeongsik-fee-calculator/backend/` 추가: Spring Boot 3.3 + Maven + H2, 도메인별 패키지(auth·user·fee·reconcile), 공통 응답 `ApiResponse`·전역 예외 처리, CORS(localhost:5173)
- 기동 시 프론트 mockData와 같은 시연 계정·업무·기관·테스트 결과와 3분기 오픈뱅킹 산출 1건을 자동 적재. 시연용 실적은 프론트와 같은 시드 해시라 같은 값이 나옴
- 로그인 5회 오류 잠금·잠금 초기화, 업무 권한 신청·승인(RBAC), 실적 엑셀 업로드·대사용/수입결의용 엑셀 다운로드(POI), AI 이슈 차감 산출(총액 분담은 최대잔여법으로 합계 = 총액), 대사 송부·수행률 집계, Mattermost 웹훅(미설정 시 로그만). `mvn test` 10개 통과
### 2026-10-22
- Vercel 공개 주소(vibe-coding-challenge-nine.vercel.app)가 경식 회비자동산출시스템임을 확인. push·병합 시 자동 재배포되도록 Vercel Git 연결 설정값을 경식 README에 기록
### 2026-10-20 (경식)
- 회비 산출 STEP 1을 연도·분기 선택에서 기간(From~To) 선택으로 변경: 달력 선택·숫자 직접 입력, 날짜 유효성과 From>To 경고, 분기가 아닌 기간은 일수 비례 환산
- 관리자 설정을 회원 관리(추가·수정·삭제, 가입 승인, 잠금 해제)와 업무 권한 관리(신청 승인·반려, 회원별 권한 부여·해제) 페이지로 분리. 회원 데이터를 로그인 계정과 하나로 합침
- 내 정보 관리를 항목별 페이지로 분리(기본 정보 / 담당 업무 및 산출 권한 / Mattermost 알림 설정 / 보안 설정 및 접속 이력)
- 헤더 역할 토글 제거: 로그인한 계정 권한(사용자 hong / 관리자 admin / 참가기관 shinhan)으로만 메뉴·첫 화면이 정해지도록 분리
- 역할 3종 분리(일반담당자 hong·시스템관리자 admin·참가기관 shinhan, 비밀번호 1234), 업무별 산출 권한(RBAC), 내 정보 관리(마이페이지), 관리자 설정의 업무 권한 승인·잠금 계정 해제 연동
### 2026-10-17 (우성)
- 테스트 산출(accounting 업무, 실 데이터일 수 있어 결과는 저장소 밖 공유 폴더에만 저장) 중 보완: 분담기준에 실적 기준 기간(`basis`: 직전 N분기 등) 추가, exceljs가 못 여는 xlsx 자체 판독, '금융회사명'·'전체 합계' 인식
- `day01-woosung-fee-ai/` 추가: Express API + React/Tailwind/lucide 화면. 분담기준 문구 → Claude 구조화 출력으로 산출 규칙(JSON) 변환, 관리자 확인 후 버전 저장·되돌리기 (API 키 없으면 규칙 기반 해석기)
- 산출은 결정적 코드(BigInt 최대잔여법, 합계 = 총회비 보장). 방식: 균등·실적비례·구간가중, 항목 가중치, 1/10/100/1000원 단위
- 실적 파일: xlsx·csv(CP949 포함)·hwp(5.0 바이너리 표)·hwpx. 결과 Excel(회비산출내역·산출기준 시트). `npm test` 21개 통과
### 2026-10-22 (대용)
- 공통 규칙 초안 `day01-daeyong-fee-calculator/docs/COMMON_RULES_DRAFT.md` 작성(통합 요구사항 기준 R-1~R-15, 담당자 확인 항목 D-1~D-15). 공용 규칙 확정은 "공통_회비 산출" 프로젝트에서
- 엑셀 기관명 자동 등록: 실적 업로드 시 미등록 기관을 적용할 때 참가기관으로 등록(기본 켬, 업무별 설정), 참가기관 화면에 "엑셀에서 기관명 불러오기" 추가
- v4: 통합 요구사항으로 재구성. 계산 엔진(`src/engine/`)을 화면과 분리, BigInt 정수 계산, 계산 중 기관별 산출 근거(trace) 기록, 검증 9종. `npm test` 14개 통과
- 요구사항에 없는 원 단위·차액 배정 규칙은 기본값으로 계산하되 "확인 필요"로 표시하고 담당자가 업무별로 확정(목록은 `docs/DESIGN.md`)
### 2026-10-17 (대용)
- 3차: 회비는 3개월마다 산출(달력 분기). 기간 열(년월·일자·분기, 연도+월, 시트 이름)을 읽어 분기별로 묶고, 같은 분기 안 같은 기관명은 합산. 분기 회비 총액은 공통 입력 + 분기별 수정. 결과 엑셀은 분기별요약·기관별분기회비·분기별 시트·산출기준
- 2차: 화면 개편(요약 카드, 기관별 구성 막대, 정렬·검색 표, 끌어다 놓기, 다크 모드, 예시 데이터로 첫 화면 채움), `npm run build`로 단일 HTML 프로그램 생성, claude.ai 웹 페이지로 게시(파일 저장은 downloads 기능)
- `day01-daeyong-fee-calculator/` 추가: Vite+React+SheetJS. 회비 총액 입력 + 건수 엑셀 업로드 → 25% 균등·75% (압류+추심+해제) 비율 안분 → 결과 엑셀(결과·산출기준 시트) 생성
- 원 단위: 풀별 원 미만 버림 후 최대잔여법으로 단수 배정, 합계 = 총액 보장. `npm test`로 검증
### 2026-10-14 (경식)
- 좌측 내비게이션 수정: ☰ 버튼·`[` 키로 접기/펴기(접으면 아이콘만, 호버 시 플라이아웃), 메뉴 번호 제거, 하위 메뉴 추가(누르면 해당 영역으로 스크롤)
- 로그인 화면 추가: `isLoggedIn` 상태로 대시보드 진입, 헤더 로그아웃, 반응형 5:5 분할(lg 미만은 폼만), CSS 3D 로고 회전·반짝임, 시연 계정 admin/1234와 5회 오입력 잠금
- 헤더 로고·파비콘을 금융결제원 CI 심벌마크로 교체하고, 팔레트를 심벌 색상(주색 #0E45AA, 보조색 #178CDC)으로 보정
- 화면 색상을 금융결제원 CI 계열(주색 #005BAC, 보조색 #00A0E9, 추정값)로 변경. `tailwind.config.js`의 `brand`·`accent` 팔레트에서 관리
- `day01-gyeongsik-fee-calculator/` 추가: Vite+React+Tailwind, 헤더 권한 토글(결제원↔참가기관), 회비 산출 3단계(업무·분기 선택 → Excel 업로드 시뮬레이션·AI 이슈 차감 → 결과 테이블·Excel 2종 다운로드), 테스트/대사 결과 관리, 회원승인
### 2026-10-13
- 베이스 세팅 점검: 서브모듈 없음 확인, connect-link와 연결하지 않기로 결정
- SessionStart 훅 수정(#1): upstream 없는 클라우드 브랜치에서는 pull 대신 fetch 후 main과의 차이만 표시, Homebrew 경로는 macOS에서만 추가

### 2026-10-10
- GitHub 연동, 저장소 생성(okeycsy/vibe-coding-challenge, Public)
- SessionStart 훅으로 git pull + PROGRESS.md 주입 구성
