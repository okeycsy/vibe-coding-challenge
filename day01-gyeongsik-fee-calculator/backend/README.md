# 회비자동산출시스템 백엔드 API (경식)

금융결제원 회비자동산출시스템 프론트엔드(`../`, React+Vite)와 짝을 이루는 Spring Boot API 서버입니다. 프론트 폴더와 분리된 독립 Maven 프로젝트이며, 서버를 띄우면 인메모리 H2 DB에 시연용 예시 데이터가 자동으로 적재됩니다.

> 계정·기관 실적·단가·총액은 모두 프론트 `src/data/mockData.js`와 같은 가상의 예시입니다. 실제 회원·실적과 무관합니다.

## 실행 방법
JDK 17 이상, Maven 3.9 이상이 필요합니다.

```bash
cd day01-gyeongsik-fee-calculator/backend
mvn spring-boot:run          # http://localhost:8080
mvn test                     # 통합 테스트 11개
mvn package                  # target/fee-calc-backend-0.0.1-SNAPSHOT.jar
```

- CORS: `http://localhost:5173`, `http://127.0.0.1:5173`(Vite 개발 서버), `https://vibe-coding-challenge-nine.vercel.app`(Vercel 공개 주소) 허용. 환경변수 `CORS_ALLOWED_ORIGINS`(쉼표 구분)로 바꿉니다.
- H2 콘솔: http://localhost:8080/h2-console (JDBC URL `jdbc:h2:mem:feecalc`, 사용자 `sa`, 비밀번호 없음). 재기동하면 데이터가 초기화됩니다. Docker 이미지에서는 꺼져 있습니다(`H2_CONSOLE_ENABLED=false`).
- 포트: 환경변수 `PORT`(기본 8080). 헬스 체크는 `GET /api/health`.

## 공개 배포 (Render)
- 운영 중인 주소: https://vibe-coding-challenge-bdm1.onrender.com (서비스 이름 `vibe-coding-challenge`, 이름이 겹쳐 Render가 `-bdm1`을 붙임). Vercel `VITE_API_BASE_URL`에 이 주소가 들어가 있습니다.

Docker 지원 무료 호스팅인 [Render](https://render.com)에 이 폴더의 `Dockerfile`로 올립니다. 카드 등록 없이 무료 플랜(512MB)을 쓸 수 있고, `main`에 이 폴더 변경이 병합되면 자동으로 다시 배포됩니다.

1. render.com에서 GitHub 계정으로 가입·로그인합니다.
2. **New → Web Service** → GitHub 저장소 `okeycsy/vibe-coding-challenge`를 연결·선택합니다.
3. 설정값
   | 항목 | 값 |
   |------|----|
   | Name | `vibe-coding-challenge` (주소가 `https://vibe-coding-challenge.onrender.com`이 됨. 이미 쓰는 이름이면 Render가 뒤에 글자를 붙이니 실제 주소를 확인) |
   | Branch | `main` |
   | Root Directory | `day01-gyeongsik-fee-calculator/backend` |
   | Language | `Docker` (Dockerfile Path는 기본값 `./Dockerfile`) |
   | Instance Type | `Free` |
   | Health Check Path (Advanced) | `/api/health` |
4. **Deploy Web Service**를 누르고 로그에 `Started FeeCalcApplication`이 보이면 `https://<이름>.onrender.com/api/health`가 `{"success":true,"message":"UP"...}`를 돌려주는지 확인합니다.
5. Vercel 프로젝트 Settings → Environment Variables에 `VITE_API_BASE_URL` = 위 주소(끝에 `/` 없이)를 넣고 Deployments에서 Redeploy합니다.

주의
- 무료 서버는 15분 동안 요청이 없으면 잠들고, 다음 첫 요청 때 깨어나는 데 1분 안팎 걸립니다. 로그인 화면에 "서버를 깨우는 중" 안내가 뜹니다.
- DB가 인메모리 H2라 서버가 잠들거나 다시 배포되면 시연 데이터로 초기화됩니다.
- **인증이 없습니다.** 주소를 아는 누구나 회원 목록 조회, 가입 승인, 권한 부여, 비밀번호 초기화 같은 관리자 API를 호출할 수 있습니다. 예시 데이터만 넣고, 실제 회원·실적은 절대 올리지 마세요.
- Vercel 주소가 바뀌거나 미리보기 주소에서도 쓰려면 Render 환경변수 `CORS_ALLOWED_ORIGINS`에 쉼표로 이어 적습니다(기본값을 덮어쓰므로 localhost 주소도 함께).
- Mattermost: 환경변수 `MATTERMOST_WEBHOOK_URL`에 Incoming Webhook 주소를 넣으면 실제로 발송하고, 비어 있으면 로그만 남깁니다.
- AI(LLM): Render Environment에 `AI_API_KEY`를 넣으면 회비 산출의 이슈 판별, 실적 엑셀의 표 구조 판별·열 연결, AI 계산식 빌더의 3번 변수·수식 생성(**AI 전용**: 키가 없으면 400으로 직접 작성을 안내)·4번 후처리 스크립트 생성에 AI를 씁니다. 4번 특이사항은 산출 때 AI를 부르지 않고 확정된 스크립트만 실행합니다. 금액 계산 자체는 AI가 하지 않습니다. **키는 저장소에 절대 커밋하지 않고 환경변수로만** 넣습니다. 비어 있으면 이슈 판별·엑셀 판별·4번 스크립트는 규칙 기반으로 동작합니다(아래 "2단계 정산 파이프라인").
  | 환경변수 | 기본값 | 설명 |
  |------|----|----|
  | `AI_API_KEY` | (없음) | OpenAI, Gemini 또는 Claude(Anthropic) API 키. 이름을 `OPENAI_API_KEY`·`GEMINI_API_KEY`·`GOOGLE_API_KEY`로 넣어도 읽음(앞뒤 따옴표는 뗌) |
  | `AI_MODEL` | 키에 따라 | 비우면 Claude 키(`sk-ant-...`)는 `claude-opus-5-5`, Gemini 키(`AIza...`)는 `gemini-2.5-flash`, 그 밖은 `gpt-4o-mini` |
  | `AI_BASE_URL` | 키에 따라 | Claude 키는 비워 두면 됨(Messages API `https://api.anthropic.com/v1/messages`를 직접 호출, OpenAI 호환 주소는 쓰지 않음). 비우면 Gemini 키는 `https://generativelanguage.googleapis.com/v1beta/openai`, 그 밖은 `https://api.openai.com/v1` |
  | `AI_TIMEOUT_SECONDS` | Claude 90, 그 밖 30 | 호출 한 번의 제한 시간. 넘으면 규칙 기반으로 이어서 산출 |

  - 환경변수는 서버가 켜질 때만 읽습니다. Render에서 키를 넣거나 바꾸면 저장 후 재배포(Manual Deploy → Deploy latest commit)해야 반영됩니다. Vercel(프론트)에 넣은 키는 서버가 읽지 못합니다.
  - 확인: 기동 로그에 `AI 사용: Gemini · gemini-2.5-flash · ...` 또는 `AI 키(AI_API_KEY)가 없어 규칙 기반으로 동작합니다.`가 찍힙니다. `GET /api/v1/ai/status?check=true`(화면: AI 계산식 빌더의 [연결 시험])는 실제로 짧은 요청을 보내 성공 여부와 실패 원인(HTTP 상태·제공자 오류 문구, 키는 가림)을 돌려줍니다.
  - AI가 실패해 규칙 기반으로 바뀌면 생성 결과에 'AI 실패 → 규칙 기반 생성'과 원인이 표시됩니다.

## 기술 스택
Java 17, Spring Boot 3.3 (Web, Data JPA, Validation), H2, Apache POI 5.3(엑셀), spring-security-crypto(BCrypt), Lombok

## 패키지 구조
```
src/main/java/com/kftc/feecalc/
  FeeCalcApplication.java
  common/
    config/WebConfig.java            CORS, PasswordEncoder
    config/AppProperties.java        app.* 설정 (CORS, 잠금 횟수, Mattermost)
    config/DataInitializer.java      기동 시 시연용 더미 데이터 적재
    dto/ApiResponse.java             공통 응답 { success, message, data }
    exception/                       GlobalExceptionHandler, BusinessException, ErrorCode
    event/FeeCalculatedEvent.java    산출 완료 → 대사 내역 생성 (fee → reconcile 느슨한 연결)
  domain/
    auth/       로그인, 5회 비밀번호 오류 잠금, 잠금 초기화, 접속 이력
    user/       회원 정보, 가입 승인, 담당 업무 권한(RBAC) 조회·추가 신청·관리자 승인
    fee/        업무별 회비 기준, 엑셀 업로드/다운로드(POI), AI 예외 차감 산출, skill.md 수식 엔진(SkillEngineService)
    reconcile/  참가기관 대사·연동 테스트 결과, 수행률 집계, Mattermost 알림
```
각 도메인은 `controller / service / entity / repository / dto`로 나눴습니다.

## 시연 데이터
| 구분 | 내용 |
|------|------|
| 계정 (비밀번호 모두 `kftc1234!!`) | `hong` 사용자(오픈뱅킹·금거정 권한), `admin` 관리자, `shinhan` 참가기관, `kimms` 사용자(CMS·타행환), 잠긴 계정 `woori01`·`ibk02`, 승인대기 `hana01`·`toss01`·`choisy`, 반려 `kakao01` |
| 업무 5종 | 오픈뱅킹(20원/건), 금거정(분기 1.2억 분담), CMS(8원/건), CD공동망(분기 3억 분담), 타행환(12원/건) |
| 기관 8곳 | 신한·KB국민·우리·하나·NH농협·IBK기업·카카오뱅크·토스뱅크 (A~H은행 가명 별칭) |
| 그 밖 | 업무 권한 신청 2건, `hong` 접속 이력 4건, 연동 테스트 결과 7건, 2026년 3분기 오픈뱅킹 산출 1건(AI 이슈 2건 반영, 대사 내역 8건) |

## API
모든 응답은 `{ "success": true, "message": "OK", "data": ... }` 형태이고, 오류는 `success: false`와 HTTP 상태(400/401/403/404/409/423)로 돌려줍니다.

### auth — `/api/auth`
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/login` | `{ id, password }`. 성공 시 회원 정보(role·home·tasks). 실패 시 `data.remainingAttempts`, 5회째 잠금(423) |
| POST | `/logout/{loginId}` | 로그아웃 이력 기록 |
| GET | `/locks` | 잠긴 계정 목록 (관리자) |
| DELETE | `/locks/{loginId}` | 잠금 초기화·해제 |
| POST | `/password-reset/{loginId}` | 비밀번호를 `kftc1234!!`로 초기화 (관리자) |
| GET | `/history/{loginId}` | 최근 접속 이력 20건 |

### user — `/api/users`, `/api/task-requests`
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/users?status=&keyword=` | 회원 목록 (관리자) |
| GET·PUT | `/api/users/{loginId}` | 내 정보 조회·수정(부서·이메일·내선) |
| PUT | `/api/users/{loginId}/password` | 비밀번호 변경 |
| POST | `/api/users/{loginId}/approve`, `/reject` | 가입 승인·반려 |
| GET | `/api/users/{loginId}/tasks` | 산출 가능한 업무 (관리자는 전체) |
| POST·DELETE | `/api/users/{loginId}/tasks/{businessCode}` | 업무 권한 직접 부여·해제 (관리자) |
| GET·POST | `/api/users/{loginId}/task-requests` | 내 권한 신청 내역·추가 신청 `{ businessCode, reason }` |
| GET | `/api/task-requests?status=PENDING` | 권한 신청 목록 (관리자) |
| POST | `/api/task-requests/{id}/approve`, `/reject` | 권한 신청 승인·반려 |

### fee — `/api/fee`
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/businesses`, `/businesses/{code}` | 업무별 회비 기준(방식·단가·총액·분담기준 요약) |
| PUT | `/businesses/{code}/rate` | 단가(건당 방식)·총액(분담 방식) 변경 |
| GET | `/institutions` | 참가기관과 별칭 (사용 중지 기관 포함): `{ id, name, code, aliases, type, active, uploadOnly }` |
| POST | `/uploads` | 실적 엑셀 업로드(multipart `file`, 선택 `from`·`to`·`taskCode`). 형식 고정 없음: AI 키가 있으면 시트 앞부분 미리보기로 AI가 머리글 행·기관 열·날짜 위치(COLUMN 날짜 열 / HEADER 날짜 머리글 가로형 / TITLE 표 위 제목)·수치 열(kind COUNT·AMOUNT·NUMBER, use)을 판별하고 시트로 검증, 키가 없거나 실패·검증 탈락하면 규칙 기반(`RuleLayoutDetector`, analysis.mode RULE/RULE_FALLBACK + note). 날짜는 최소 년월(2026-07, 2026년 7월, 202607, 날짜 서식, 2026년 3분기 등), 빈 날짜 칸은 위 행 날짜. `from`~`to`와 겹치지 않는 날짜 행은 `excluded`(날짜별 행 수·합계), 날짜 불명 행은 `unreadableRows`. 기관별 열 합계 `values`. `taskCode`(업무 코드 또는 업무 ID)를 주면 그 업무 skill.md 의 실적 입력 변수(```` ```variables ````의 `input`, 없으면 `rawCount` 하나)마다 어느 수치 열을 더할지 연결: AI 가 열마다 `variable`을 정하고(프롬프트에 `[실적 항목]` 목록을 함께 보냄, 모르는 이름은 버림), AI 가 정하지 않은 열은 머리글과 입력 설명의 핵심 낱말이 서로 포함되는 쪽으로(`RuleLayoutDetector.assignVariables`, 공백·괄호·'건수'·'실적' 등은 뗌, 금액 열은 설명에 '금액'이 있을 때만). 응답 `columns[].variable`, `mapping[{ variable, label, columns[](columns 안의 위치) }]`, `counts[].inputs`(변수별 건수)와 `counts[].baseCount`(변수 정의로 계산한 rawCount, 계산 불가면 입력 합). 연결된 열이 없는 항목은 `message`로 알려 줌. 원본은 저장하지 않음 |
| GET | `/uploads/template` | 업로드 양식 엑셀 |
| POST | `/issues/parse` | AI 이슈 문장 미리보기 해석 `{ text }` → 기관·건수·일자·사유 |
| POST | `/calculations` | 산출 `{ businessId, from, to, issues[], counts?, uploadFileName?, requestedBy? }` |
| GET | `/calculations`, `/calculations/{id}` | 산출 이력·상세 |
| GET | `/calculations/{id}/excel/reconcile` | 참가기관 송부 대사용 엑셀(대사내역·산출기준·AI 이슈 이력) |
| GET | `/calculations/{id}/excel/revenue` | 수입결의용 엑셀(결의일자·수입과목·거래처·금액·적요) |

산출 규칙
- 실적: `counts`(업로드 결과)가 있으면 그 값, 없으면 업무·기간·기관을 시드로 한 시연용 실적(프론트 Mock과 같은 값)
- 기간: 정확히 한 분기가 아니면 분기 기준 실적·총액을 `일수 ÷ 91일`로 환산
- AI 이슈: 기관 이름·별칭과 `N건`을 모두 찾은 문장만 차감(기관 실적보다 많이 빼지 않음). 못 찾은 문장은 `applied: false`로 남김
- 회비: 업무별 skill.md의 SpEL 수식으로 계산합니다 (아래 fee v1 참고). `PUT /businesses/{code}/rate`로 바꾼 단가·총액은 더 이상 산출에 쓰이지 않습니다
- `requestedBy`를 주면 업무 산출 권한을 확인합니다(사용자는 부여받은 업무만, 참가기관은 불가)

### 2단계 정산 파이프라인 (`domain/fee/service`, `domain/fee/ai`)
`POST /api/v1/fees/calculate`(와 `/api/fee/calculations`)는 아래 순서로 산출합니다. AI는 이슈 판별과 빌더의 문장 해석에만 쓰고, 금액은 늘 코드가 계산합니다.

skill.md 표준 4섹션: `## 1. 비즈니스 규칙 요약`(필수) · `## 2. AI 예외 차감 지침`(선택) · `## 3. 정산 수식`(필수) · `## 4. 최종 정산 특이사항`(선택). 3번 섹션은 다음 `## ` 제목 앞에서 끝납니다.

- **3번 변수 정의 블록**(선택, 6000자 이하): ```` ```variables ```` 안에 한 줄에 하나 `이름 = 값`(이름은 영문 소문자로 시작하는 camelCase 40자 이하, `#`·`//` 줄은 주석, 30줄 이하). 값은 `input("엑셀 열 설명")`(기관별 실적 입력, 10개 이하), `sum(#기관별변수)`(전 기관 합계), 숫자(상수), 앞에서 정의한 변수와 예약 변수로 만든 SpEL 수식(기관별 값을 쓰면 기관별 변수). 예약 변수 `deductedCount`·`finalCount`·`totalCount`·`institutionCount`·`periodScale`는 정의할 수 없고, `rawCount`(기준 실적)는 input 또는 input 을 쓰는 수식으로 정의합니다(없으면 input 이 0개일 때 `rawCount = input("기본 건수")`, 1개일 때 `rawCount = #그입력`을 보충, 2개 이상이면 정의 필수). rawCount 줄 앞에서는 `#deductedCount`·`#finalCount`·`#totalCount`를 쓸 수 없습니다. 블록이 없는 예전 문서는 `rawCount = input("기본 건수")` 하나와 같습니다. 응답: `variables`(원문), `variableList`, `inputs`
- **3번 수식 블록** (각 2000자 이하): ```` ```formula ````(회비 총액) 하나, 또는 ```` ```formula:equal ````(균등분담회비) + ```` ```formula:perf ````(실적분담회비) 분리형. 분리형이면 ```` ```formula ```` 통합식은 선택(표시용, 없으면 `(균등) + (실적)`). 수식에는 정의한 변수와 예약 변수만 쓸 수 있습니다. 블록 사이의 `### 3-1.` 같은 소제목·설명은 그대로 둡니다. 응답: `formula`, `equalFormula`, `perfFormula`(분리형이 아니면 null)
- **4번**: 자연어 문장(`specialRules`·`specialRulesRaw`) + ```` ```postprocess ```` 후처리 스크립트 블록(`postprocess`, 빌더에서 만들어 확정)

1. **이슈 차감 판별**: 이슈 문장의 기관·건수는 기존 해석기로 찾고, AI(키가 없으면 규칙 기반 `RuleBasedFeeRules`)가 `## 2. AI 예외 차감 지침`에 비춰 차감 대상인지만 정합니다. 응답 `issues[].applied`·`judgement`, `aiMode`(`AI`/`RULE`/`RULE_FALLBACK`)는 이 판별에만 해당
2. **Step 1 원시값**: `SkillEngineService.computeRaw`가 기관별 균등분담분·실적분담분을 원 미만까지(백만분의 1원 정수) 계산. 분리형은 각 수식, 단일 수식은 `#institutionCount`·`#finalCount`가 함께 있으면 실적 0일 때 값을 균등분으로 봅니다
3. **Step 2 후처리 스크립트** (`PostprocessScript` 파서 + `PostprocessEngine` 실행기, 프론트 `src/utils/postprocess.js`와 동일): 스크립트를 위에서 아래로 실행 → `items[].equalFee`·`perfFee`·`fee`·`beforeSpecialFee`(처음 모든 금액이 정수가 된 시점)·`specialAdjustment`·`specialReason`
   - 실행할 스크립트(`postprocessSource`): `SCRIPT`(skill.md 블록) / `AUTO_RULE`(블록 없이 자연어만 있으면 내장 변환기 `SpecialRuleConverter`로 바꿔 실행) / `DEFAULT`(4번 없음 → `allocate(fee)`, 이전 Step 1 배분과 같은 결과)
   - 연산: `allocate(comp)` 원 단위 배분 · `roundUp|roundDown|roundHalf(comp[, 단위][, 대상][, addTo=equal|perf])` · `fixSum(comp, 금액|N%, over=정렬, under=정렬)` 합계를 목표에 1원씩 보정 · `spreadDiff(equal|perf[, 대상][, 정렬][, step=N])` 앞 단계에서 늘거나 준 금액을 되돌림 · `min|max|add|set(comp, 금액[, 대상])` · `assert sum(comp) == 금액|N%|before`, `assert comp("기관") % N == 0`, `assert all(comp >= N)`, `assert integer`. 구성요소 `equal`·`perf`·`fee`, 대상 `all`·`first`·`last`·`others`·`"기관명"`(이름·별칭·기관코드), 정렬 `perfDesc/perfAsc`·`countDesc/countAsc`·`feeDesc/feeAsc`·`equalDesc/equalAsc`·`codeAsc`(동률은 기관코드 오름차순). 최대 50줄
   - 예 (균등 25% + 실적 75%, 우체국 10원 절상):
     ```
     roundHalf(equal)
     roundHalf(perf)
     fixSum(equal, 25%, over=perfDesc, under=perfAsc)
     fixSum(perf, 75%, over=perfDesc, under=perfAsc)
     roundUp(fee, 10, "우체국", addTo=perf)
     spreadDiff(perf, others, perfDesc)
     assert sum(equal) == 25%
     assert fee("우체국") % 10 == 0
     assert sum(fee) == before
     ```
   - 응답: `postprocess`(실행한 스크립트), `postprocessSource`, `checks[]`(`expression`, `label`, `passed`, `actual`), `notes[]`(예: 산출 대상에 없는 기관이라 건너뜀). assert 실패는 산출을 막지 않고 화면·대사용 엑셀에 실패로 표시. 지정 기관(예: 우체국)은 기관 관리에 먼저 등록해야 합니다
   - 저장 검증: 수식 구문·시험 계산 2벌 + 스크립트 문법·시험 실행 2벌(`PostprocessEngine.trial`, 시험용 기관 7곳). 정수화 전에 `fixSum`을 쓰는 등 실행 오류는 `400 INVALID_FORMULA "후처리 스크립트 N행: …"`

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/v1/ai/status` | `{ enabled, model, mode }` (키 값은 내보내지 않음) |
| POST | `/api/v1/skills/{taskCode}/generate-postprocess` | `{ specialRulesText }`(4번 자연어) → `{ generatedScript, explanation[], unsupported[], validationPassed, validationMessage, sample[](시험용 기관 7곳 실행 결과), checks[], notes[], source(AI/RULE/RULE_FALLBACK), model, note }`. 권한 확인은 generate-formula와 같고(403), **파일은 저장하지 않음**. AI 스크립트도 문법·시험 실행을 통과해야 하고, 못 하면 내장 변환기(`SpecialRuleConverter`, 프론트 `convertSpecialRules`와 동일): 소수점 반올림 → roundHalf, "균등/실적 합계 … N% … 보정" → fixSum(총액 유지 문장이 있으면 다른 쪽도 나머지 %로), 최저/최고 회비, "N원 단위 절상/절사/반올림"(문장의 기관, 차이분 문장이 있으면 첫 번째 기관) + "차이분/증액분 … 실적 … 1원씩 차감" → spreadDiff, 총액 유지·0원 이상 → assert |
| POST | `/api/v1/skills/{taskCode}/generate-formula` | `{ businessRulesText }`(1번 비즈니스 규칙) → `{ variables(```variables 블록 텍스트), variableList[{ name, kind(INPUT/SUM/NUMBER/EXPR), label, expr, perInstitution, auto }], inputs[](실적 입력 변수), generatedFormula, equalFormula, perfFormula(혼합형이면 분리 수식, 아니면 null), detectedPattern, explanation[], validationPassed, validationMessage, sampleResultNormal, sampleResultZero, source('AI'), model, note, attempts }`. `X-Employee-Id`로 업무 권한 확인(없으면 403), **파일은 저장하지 않음**. **AI 전용**(`FormulaGeneratorService`, 패턴 변환기 없음): AI 가 1번 규칙을 읽고 필요한 변수(실적 항목 `input`, 총액·비율 상수, 합계, 파생 수식)를 스스로 정의하고 그 변수로 SpEL 을 씁니다. 답변은 저장과 같은 검증(변수 블록 파싱 → 수식 구문·미정의 변수 → 기관 8곳 시험 계산 2벌)을 통과해야 하고, 떨어지면 `[검증 오류]`를 붙여 한 번 더 묻습니다(최대 2회). 그래도 안 되면 400 `INVALID_FORMULA` 에 `data.draft`(마지막 초안)·`attempts`·`error`를 담아 돌려주고, AI 키가 없으면 400 으로 직접 작성을 안내합니다 |

### skills — `/api/v1/skills` (업무별 회비분담기준 skill.md 관리)
모든 요청에 `X-Employee-Id: <로그인 ID>` 헤더가 필요합니다(없으면 401). 시스템관리자는 전체 업무, 일반담당자는 승인된 업무 권한(신청 승인 또는 관리자 부여)이 있는 업무만, 참가기관은 접근할 수 없습니다(403 "해당 업무의 회비분담기준(skill.md) 접근 권한이 없습니다.").

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/v1/skills` | 전체 업무와 `accessible`(접근 가능 여부), 최종 수정 일시·크기·버전(내용 해시 8자리)·수정 여부. 내용은 주지 않음 |
| GET | `/api/v1/skills/{taskCode}` | `{ taskCode, taskName, content, formula, summary, aiGuide, specialRules, specialRulesRaw, calcType, rateUnit, lastModified, size, version, modified, updatedBy }`. `taskCode`는 `OPEN_BANKING` 또는 업무 ID `openbanking` |
| PUT | `/api/v1/skills/{taskCode}` | `{ content }` 저장. 섹션 확인 → 수식 SpEL 구문 검사 → 예시 값 시험 계산을 통과해야 파일을 덮어씀. 구문 오류는 400 "수식(formula) 구문 오류가 발견되었습니다." |
| POST | `/api/v1/skills/{taskCode}/reset` | 초기 기준(`resources/skills`)으로 되돌리기 (시스템관리자만) |
| POST | `/api/v1/fees/calculate` | skill.md 수식으로 산출. 헤더(또는 `requestedBy`)의 사번이 그 업무 권한이 있어야 함. 응답에 `skillCode`·`calcType`·`formula` |

### tasks — `/api/v1/tasks` (업무 관리)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/v1/tasks` | 업무 목록: `{ taskCode, businessId, name, fileName, builtIn, createdAt, createdBy, lastModified, size, ready, memberCount }`. `ready`는 요약·수식 섹션이 있어 산출에 쓸 수 있는지 |
| POST | `/api/v1/tasks` | `{ taskCode, name, fileName }`로 업무 추가 (시스템관리자만, `X-Employee-Id`). `fileName`은 `.md` 생략 가능, 비우면 `{업무코드}.md`. 업무 코드·업무명·파일명(대소문자 무관)이 겹치면 409. md 파일은 기본 템플릿 뼈대(`# {업무명} 회비 산정 기준 ({업무코드})`, 업무명·산정 유형·표시 단위 항목, `## 1~4` 섹션 제목, 빈 ```formula 블록)로 만듦 |
| DELETE | `/api/v1/tasks/{taskCode}` | 업무 삭제 (시스템관리자만). 연결된 md 파일 삭제, 회원의 그 업무 권한 해제, 승인 대기 신청 반려 |

- 새 업무의 skill.md는 섹션이 없어 `GET /api/v1/skills/{taskCode}`에서 `parseError`와 원문만 주고, 섹션을 채워 `PUT`으로 저장해야 산출에 쓸 수 있습니다. 회비 산출 화면은 실적 예시 데이터가 있는 기본 업무만 보여 줍니다

### institutions — `/api/v1/institutions` (기관 관리, 모두 시스템관리자만 · `X-Employee-Id`)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/v1/institutions` | 전체 기관(사용 중지 포함)과 사용 현황: `{ id, name, code, aliases, type, typeLabel, active, uploadOnly, calculationCount, reconcileCount, testCount, memberCount, deletable, updatedAt, updatedBy }` |
| POST | `/api/v1/institutions` | `{ id?, name, code, type?, aliases[] }`로 추가. `id` 비우면 기관코드 소문자, 새 기관은 시연 실적 가중치 0(업로드 전용) |
| PUT | `/api/v1/institutions/{id}` | 이름·기관코드·구분·별칭 수정(내부 ID는 못 바꿈). 이름을 바꾸면 연결 회원의 소속(org)도 바꿈 |
| POST | `/api/v1/institutions/{id}/deactivate` · `/activate` | 사용 중지·다시 사용 |
| DELETE | `/api/v1/institutions/{id}` | 산출 이력·대사·테스트 결과·연결 회원이 하나도 없을 때만 삭제, 아니면 409 |
| GET | `/api/v1/institutions/match?value=` | 매칭 시험: `{ excel, issue }` 각각 엑셀 기관 칸·AI 이슈 문장 규칙으로 잡히는 기관 |

- 검증(400/409, `data.field`로 칸 표시): 기관명 1~50자·공백 없음, 기관코드 영문 대문자·숫자 2~10자, 내부 ID 소문자 시작 2~30자, 별칭 공백 없이 30자·10개 이하. 기관코드·내부 ID끼리(대소문자 무시), 이름·별칭끼리, 별칭과 다른 기관 코드·ID가 겹치면 409. 사용 중지 기관도 겹침 검사에 포함
- 엑셀 매칭(`FeeExcelService.matchInstitution`)·AI 이슈 인식·산출은 요청마다 DB의 **사용 중인** 기관을 읽으므로 추가·수정이 다음 업로드부터 바로 반영. 사용 중지 기관이 든 실적으로 산출하면 400
- 산출 이력(`FeeCalculationItem`)·대사 내역은 산출 당시 기관명·코드를 따로 저장하므로 이름 변경·사용 중지 후에도 그대로

skill.md 저장 (`SkillFileService`)
- 1업무 = 1파일: 업무 목록은 `{SKILLS_DIR}/tasks.json`(없으면 기본 5개 업무로 생성), 업무마다 md 파일 하나(기본 업무는 `{업무코드}.md`, 추가한 업무는 지정한 파일명). 기본 `./data/skills`, Docker 이미지에서는 `/app/data/skills`. 목록에 연결되지 않은 `.md`는 읽지 않습니다(기동 로그에 경고)
- 기동 시 없는 파일은 `src/main/resources/skills/`의 초기 기준을 복사해 만듭니다
- 경로 보호: 업무 코드는 영문·밑줄만 받고 목록에 있어야 하며, 만든 경로가 저장 폴더 바로 아래가 아니면 거부합니다. 저장은 임시 파일에 쓴 뒤 바꿔 끼웁니다
- Render 무료 플랜은 디스크가 유지되지 않아 재배포·재기동 시 초기 기준으로 돌아갑니다. 계속 쓸 기준은 `src/main/resources/skills/`를 고쳐 배포하세요

산출 엔진 (`SkillEngineService`)
- 섹션: `## 1. 비즈니스 규칙 요약`(화면 요약 박스), `## 2. AI 예외 차감 지침`, `## 3. 정산 수식`(```` ```formula ```` 코드 블록 안 SpEL). 머리말의 `- 산정 유형:`·`- 표시 단위:`(원/건 또는 %)는 화면 배지와 결과 표 문구에 씁니다
- 수식 변수: 3번 ```` ```variables ````에서 정의한 변수(`SkillVariables`가 정의 순서대로 기관별로 계산: `input` 값은 산출 요청 `counts[].inputs`에서, 없으면 0) + 예약 변수 `#rawCount` 기준 실적(변수 정의의 rawCount), `#deductedCount` AI 차감건수(rawCount 를 넘지 않게), `#finalCount` 최종인정건수, `#totalCount` 전체 기관 인정건수 합계, `#institutionCount` 참가기관 수, `#periodScale` 기간 환산 비율(분기 = 1). 산출 요청에 `counts[].inputs`가 없으면 `baseCount`를 하나뿐인 입력 변수에 넣고, 입력이 둘 이상인 기준이면 400(엑셀 열 연결 필요). 시연용 실적도 입력이 하나인 기준에서만 만듭니다
- 혼합형 판정: 단일 수식이 `#institutionCount`와 기관별 변수를 함께 쓰면 기관별 변수가 모두 0 인 가상 기관의 값을 균등분담분으로 봅니다
- 기본 제공 업무 skill.md 는 변수 블록 없이 `#finalCount` 등 예약 변수만 쓰며(오픈뱅킹 구간별 누진 단가, 금거정 총액 × 건수 비율, CMS 기본료 + 건당 단가, CD공동망 30% 균등 + 70% 실적 비례, 타행환 건당 단가 + 최저·최고 한도), 이전과 같은 금액이 나옵니다
- 산출 결과에는 적용한 변수 정의(`variables`)와 기관별 입력값(`items[].inputs`)이 남고, 대사용 엑셀에는 실적 입력이 둘 이상이면 "실적 항목별 건수" 열과 "3. 변수 정의(적용)" 행이 들어갑니다
- 원 단위: 기관별 수식 결과의 원 미만을 버리고, (결과 합계 반올림 − 버린 합계)를 원 미만이 큰 기관부터 1원씩 배정합니다. 총액 분담은 합계 = 총액이 됩니다
- 보안: 수식은 `SimpleEvaluationContext.forReadOnlyDataBinding()`으로 평가해 `T(java.lang.Runtime)` 같은 타입 참조, 생성자, 메서드 호출, 빈 참조를 막습니다
- 정수끼리 나누면 SpEL은 소수점을 버립니다. 비율 계산은 `120000000.0`처럼 소수점을 붙여 씁니다

### reconcile — `/api/reconcile`
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/records?calculationId=&institutionId=` | 기관별 대사 현황 (참가기관 뷰는 `institutionId`) |
| PATCH | `/records/{id}` | 대사 상태 변경 `{ status: 대기/확인중/완료, comment }`. 완료 시 알림 |
| POST | `/calculations/{id}/send` | 참가기관 송부: 대기 → 확인중, 알림 |
| GET | `/summary` | 수행률 집계: 대사 완료율(전체·산출별), 테스트 성공률 |
| GET | `/tests?institutionId=` | 연동 테스트 결과 |
| PATCH | `/tests/{id}` | 테스트 결과 변경 `{ status: 성공/실패/진행중, comment }`. 실패 시 알림 |
| POST | `/tests/{id}/retest` | 재테스트 요청(진행중, 회차 증가), 알림 |
| POST | `/notifications/test` | Mattermost 테스트 발송 `{ text }` |

## 다음 단계 (아직 안 한 것)
- 인증 토큰(세션 또는 JWT)과 API별 역할 검사. 지금은 로그인 응답만 주고, 관리자 API도 누구나 호출할 수 있습니다. skill.md API는 `X-Employee-Id` 헤더로 권한을 확인하지만, 헤더 값을 그대로 믿으므로 다른 사람의 ID를 넣으면 막을 수 없습니다(토큰 도입 시 토큰에서 사번을 꺼내도록 교체)
- 회비 산출·대사 화면과 회원 추가·삭제·역할 변경을 API에 연결 (로그인·회원 승인·업무 권한은 연결됨)
- AI 이슈 해석을 규칙 기반에서 LLM 기반으로 교체 (`AiIssueParser`)
- 운영 DB(예: Oracle/PostgreSQL)와 스키마 관리(Flyway)
