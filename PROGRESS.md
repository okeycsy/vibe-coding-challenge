# 진행 상황

> 세션마다 자동으로 읽힌다. 최신 내용을 위에 유지하고, 오래된 세션 로그는 아래로 쌓는다.

## 현재 상태
- 저장소 세팅 완료 (템플릿, GitHub 동기화 훅 — 로컬 main과 클라우드 `claude/*` 브랜치 모두 동작)
- 산출물: 아직 없음
- [경식] `day01-gyeongsik-fee-calculator/` 회비자동산출시스템 프론트엔드 1차 구현 완료 (Mock Data), `backend/`에 Spring Boot API 추가, 로그인·회원 승인·업무 권한 화면은 `VITE_API_BASE_URL` 설정 시 API와 연동 (백엔드 공개 주소 https://vibe-coding-challenge-bdm1.onrender.com, Render 무료 Web Service. Vercel `VITE_API_BASE_URL` 설정 완료)
- [대용] `day01-daeyong-fee-calculator/` 금융정보업무 회비 산출 v4 완료(통합 요구사항): 업무별 설정, 분기 배분 방식 A/B, 균등회비 방식 A/B, 실적 인정 항목, 우체국 10원 처리, 엑셀 열 매핑·검증·미리보기, 기관별 산출 근거·검증, 단일 HTML 프로그램 + claude.ai 웹 페이지. 확인 필요 기본값 목록은 `docs/DESIGN.md` 7장. 공통 규칙 초안 `docs/COMMON_RULES_DRAFT.md`(R-1~R-15, D-1~D-15)
- [대용] `day02-daeyong-fee-rules-proto/` 공통 규칙 초안만 보고 다시 쓴 두 번째 구현 + 병행검증(화면 7탭, v4 결과 엑셀 비교, `npm run crosscheck` 무작위 500건 일치). 단일 HTML `release/fee-rules-proto.html`
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
### 2026-10-25 (대용)
- 규칙 프로토타입: 새 업무는 예시 실적 항목(압류·추심·해제) 없이 시작, 실적 엑셀의 건수 열을 적용할 때 실적 항목으로 자동 등록해 산출 조건의 인정 항목에 연결 (글자 열은 자동으로 사용 안 함). `npm test` 22개
### 2026-10-25 (경식, 사이드바 접힘 공백 제거)
- 메뉴를 접으면 본문의 최대 폭(max-w-7xl) 가운데 정렬을 풀어, 넓은 화면에서도 본문이 아이콘 레일 바로 옆부터 채워지도록 수정(펼친 상태는 기존과 같음)
- `[` 단축키: 한글 입력 상태에서 e.key가 '['가 아니라 'Process'로 오는 경우가 있어 물리 키(e.code BracketLeft)로도 인식. 입력창·textarea·select·md 편집기 포커스 중, 조합키·키 반복은 무시. Playwright로 접기/펴기와 입력창 무시 확인
- 후속 수정: 접힌 64px 레일에서 숨김 처리한 메뉴 제목('사용자 메뉴')이 한 글자씩 줄바꿈돼 아이콘 위에 약 100px 빈칸이 생기던 문제 → 접힘 상태에선 제목을 그리지 않음
- `[` 단축키 후속: 업무 선택(select)·버튼에 포커스가 남아 있으면 무시되던 문제 → 글자 입력칸(input 텍스트류·textarea·contenteditable)에서만 무시. document 캡처 단계에서 수신
### 2026-10-24 (경식, 상단바 알림 팝업)
- 원인: 상단바 알림 버튼에 클릭 동작(onClick)이 없었고, 빨간 점은 알림 유무와 상관없이 항상 그려지는 장식이었음
- 알림 드롭다운 추가: 읽지 않은 알림이 있을 때만 빨간 숫자 배지, 버튼을 누르면 알림 목록 작은 창(최신순, 모두 읽음, 바깥 클릭·Esc로 닫기). 알림을 누르면 읽음 처리 후 관련 화면(회원 관리·업무 권한 관리·대사 현황 등)으로 이동
- 알림은 역할별 예시 데이터(`mockData.js`의 `INITIAL_NOTIFICATIONS`)로, 서버 연결 여부와 관계없이 동작. 읽음 상태는 새로고침 전까지만 유지(알림 API는 아직 없음)
### 2026-10-24 (경식, 업무 관리 페이지)
- 관리자 설정에 [업무 관리] 하위 메뉴 추가(기존 업무 권한 관리 화면은 그대로): 업무 조회(업무명·코드·매핑 md 파일명·기준 작성 상태·권한 보유자 수), 추가, 삭제(경고창 + 확인 체크 후 삭제)
- 업무 추가 시 md 파일명 지정(비우면 업무 코드), 한 파일은 한 업무에만 연결(대소문자 무관 중복 거부). 새 md 파일은 기본 템플릿 뼈대(# 제목, 업무명·산정 유형·표시 단위, ## 1~3 섹션 제목, 빈 formula 블록)만 들어가고 내용은 회비기준 관리에서 채워 저장 (John 확인: "타이틀" = #·## 제목과 formula 같은 필수 뼈대)
- 백엔드: `SkillFileService`가 고정 5개 업무 대신 `{SKILLS_DIR}/tasks.json` 업무 목록을 씀. API `GET/POST /api/v1/tasks`, `DELETE /api/v1/tasks/{taskCode}`(추가·삭제는 시스템관리자, 삭제 시 md 파일·업무 권한·대기 신청 정리). 섹션이 덜 찬 skill.md도 `parseError`와 함께 열람 가능. `mvn test` 23개 통과
- 회비 산출 화면은 실적 예시 데이터가 있는 기본 업무만(삭제한 업무는 빠짐). 새 업무를 산출에 쓰려면 실적·단가 데이터 연결이 추가로 필요
### 2026-10-24 (경식, 회비기준 skill.md 관리 페이지)
- 1업무 1파일: `SkillFileService`가 `data/skills/{업무코드}.md`(SKILLS_DIR)만 읽고 씀. 없으면 `resources/skills` 초기 기준 복사, 업무 코드 화이트리스트·경로 검사로 Path Traversal 차단, 저장 전 섹션·SpEL 구문·시험 계산 검증(구문 오류 400)
- 권한: `SkillAccessControlService` — 시스템관리자 전체, 일반담당자는 승인된 업무 권한만, 참가기관 불가. 사번은 `X-Employee-Id` 헤더(토큰이 없어 헤더 값을 그대로 믿는 한계). API `GET /api/v1/skills`, `GET/PUT /api/v1/skills/{taskCode}`, `POST /{taskCode}/reset`(관리자), `POST /api/v1/fees/calculate`도 권한 확인. 이전 `/api/v1/fees/skill/*`와 모달은 정리
- 화면: 사이드바 [회비기준(Skill.md) 관리] — 업무 목록(접근 가능/자물쇠), 줄 번호 편집기·미리보기·나란히 보기, 되돌리기·저장, 구문 오류 붉은 경고, 저장 즉시 산출 화면 반영(서버·Mock 모두 Playwright로 확인)
- 오픈뱅킹 수식을 구간 단가가 한 번씩만 나오게 바꿈(단가 숫자만 고치면 반영). `mvn test` 20개 통과
### 2026-10-24 (경식, skill.md 산출 엔진)
- 업무별 `skill.md`(OPEN_BANKING·FIN_INFO·CMS·CD_NET·INTERBANK, `backend/src/main/resources/skills/`)와 `SkillEngineService` 추가: 정규식으로 요약·AI 차감 지침·```formula 수식을 꺼내 SpEL로 계산. 수식 패턴은 구간 누진 단가 / 총액 비율 / 기본료+단가 / 30% 균등+70% 비례 / 단가+최저·최고 한도
- 보안상 요청서의 `StandardEvaluationContext` 대신 `SimpleEvaluationContext`(타입 참조·메서드·생성자 차단)로 평가, skill.md 수정(PUT)·되돌리기(DELETE)는 시스템관리자 ID만 허용(인증 토큰이 없어 ID만 확인)
- API `GET/PUT/DELETE /api/v1/fees/skill/{taskCode}`, `POST /api/v1/fees/calculate`. 기존 `/api/fee/calculations`도 같은 엔진 사용. 원 단위는 원 미만 버림 후 최대잔여법(총액 분담 합계 = 총액)
- 화면: STEP 1 요약 박스를 skill.md에서 읽고 [회비기준(skill.md) 원본 보기/수정] 모달(원문·섹션 보기·수식 시험 계산). 서버 연결 시 산출도 API로, 미연결 시 같은 skill.md를 브라우저 해석기로 계산(서버와 결과 일치 확인). `mvn test` 18개 통과
- 화면에서 고친 skill.md는 메모리 반영(`SKILLS_DIR` 주면 파일 저장). Render 무료 플랜은 재기동 시 원본으로 돌아감
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
- 규칙 프로토타입 `day02-daeyong-fee-rules-proto/`: 공통 규칙 초안 기준으로 엔진(rules/)을 새로 작성(규칙 번호를 코드에 표기), 순수 JS 화면, v4 엔진 복사본과 병행검증. `npm test` 22개 통과, crosscheck 502건 일치. 초안 보완점: D-8 '인정 실적 많은 기관부터' 선택지 추가
- 분기 실적 파일 기간 인식 수정: `1/4분기`·`제1분기`·`년도`·`Q1 2026`·기간 범위 표기, 연도 열 + 분기 열, 연도 없는 분기(산출 연도 사용), 셀 병합으로 빈 기간 칸(위 행 값 사용)
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
