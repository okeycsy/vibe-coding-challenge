# E2E 시연 스크립트 (가짜 AI 서버 + 브라우저 자동화)

AI 키 없이도 "AI 가 1번 비즈니스 규칙을 읽고 변수·SpEL 수식을 만들고, 실적 엑셀의 건수 열을 그 변수에 연결해 산출"하는 흐름 전체를 로컬에서 확인한다.

| 파일 | 역할 |
| --- | --- |
| `fake-ai.cjs` | OpenAI Chat Completions 호환 가짜 AI 서버(127.0.0.1:18080). 프롬프트 내용에 따라 정해진 JSON 을 돌려준다 (수식 생성·엑셀 판독·후처리) |
| `run-e2e.cjs` | Playwright 로 로그인 → ② AI 계산식 빌더에서 오픈뱅킹 변수·수식 생성 → 확정 반영 → 회비 산출에서 엑셀 업로드·열 연결 확인 → 산출 결과·대사 엑셀 검증 |
| `openbanking-api-2026q3.xlsx` | 예시 실적(기준월·기관명·거래내역조회·계좌실명조회·잔액조회·출금이체·입금이체, 2026-06~10, 8개 기관) |

## 실행

```bash
# 1) 가짜 AI 서버
node e2e/fake-ai.cjs

# 2) 백엔드 (가짜 AI 를 OpenAI 호환 주소로 지정, skill.md 저장 폴더는 임시 폴더)
cd backend
AI_API_KEY=test AI_BASE_URL=http://127.0.0.1:18080/v1 AI_MODEL=fake PORT=8085 SKILLS_DIR=/tmp/feecalc-e2e-skills mvn spring-boot:run

# 3) 프론트 (서버 모드)
VITE_API_BASE_URL=http://127.0.0.1:8085 npx vite --port 5173

# 4) 브라우저 시나리오 (Playwright + Chromium 필요: npm i -D playwright && npx playwright install chromium)
node e2e/run-e2e.cjs
```

환경변수 `E2E_BASE`(프론트 주소), `E2E_API`(백엔드 주소), `E2E_SHOTS`(화면 캡처 폴더, 기본 `e2e/shots/`)로 바꿀 수 있다.
스크립트는 시작할 때 오픈뱅킹 skill.md 를 초기 기준으로 되돌린 뒤 진행하며, 통과한 검사를 `✔` 로 출력하고 실패하면 종료 코드 1 로 끝난다.

## 검사 항목

- AI 가 `withdrawCount`·`depositCount` 실적 입력, `rawCount = #withdrawCount + #depositCount`, 구간 단가 상수를 변수로 정의하고 그 변수로 SpEL 수식을 씀 (패턴 안내 문구 없음)
- 확정 반영 후 서버 skill.md 에 ```` ```variables ```` 블록과 실적 입력 2개
- 엑셀 업로드 시 출금이체·입금이체 열이 각 실적 항목에 연결되고 조회성 열은 제외, 기관별 항목 건수 표시, 열을 손으로 옮기고 되돌리기
- 산출 결과 표에 실적 항목별 열, 구간 단가 적용 회비(신한은행 1,413,545건 → 26,203,175원), 대사 엑셀에 항목별 건수 열과 "3. 변수 정의(적용)"
