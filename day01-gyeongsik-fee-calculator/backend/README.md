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
    fee/        업무별 회비 기준, 엑셀 업로드/다운로드(POI), AI 예외 차감 산출
    reconcile/  참가기관 대사·연동 테스트 결과, 수행률 집계, Mattermost 알림
```
각 도메인은 `controller / service / entity / repository / dto`로 나눴습니다.

## 시연 데이터
| 구분 | 내용 |
|------|------|
| 계정 (비밀번호 모두 `1234`) | `hong` 사용자(오픈뱅킹·금거정 권한), `admin` 관리자, `shinhan` 참가기관, `kimms` 사용자(CMS·타행환), 잠긴 계정 `woori01`·`ibk02`, 승인대기 `hana01`·`toss01`·`choisy`, 반려 `kakao01` |
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
| POST | `/password-reset/{loginId}` | 비밀번호를 `1234`로 초기화 (관리자) |
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
| GET | `/institutions` | 참가기관과 별칭 |
| POST | `/uploads` | 실적 엑셀 업로드(multipart `file`). '기관명/기관코드'와 '건수' 열을 찾아 기관별 합산 |
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
- 건당 단가: 최종 인정 건수 × 단가 / 총액 분담: 총액 × 기관 인정 건수 비율, 원 미만은 최대잔여법으로 배정해 **합계 = 총액**을 보장 (프론트는 기관별 반올림이라 1원 단위 차이가 날 수 있음)
- `requestedBy`를 주면 업무 산출 권한을 확인합니다(사용자는 부여받은 업무만, 참가기관은 불가)

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
- 인증 토큰(세션 또는 JWT)과 API별 역할 검사. 지금은 로그인 응답만 주고, 관리자 API도 누구나 호출할 수 있습니다
- 회비 산출·대사 화면과 회원 추가·삭제·역할 변경을 API에 연결 (로그인·회원 승인·업무 권한은 연결됨)
- AI 이슈 해석을 규칙 기반에서 LLM 기반으로 교체 (`AiIssueParser`)
- 운영 DB(예: Oracle/PostgreSQL)와 스키마 관리(Flyway)
