# 🎨 Vibe Coding Challenge

바이브코딩 챌린지 산출물 모음입니다.

## 산출물 목록

| Day | 날짜 | 제목 | 설명 | 링크 |
|-----|------|------|------|------|
| 01 | 2026-10-14 | 회비자동산출시스템 (경식) | 업무·분기별 회비를 AI 이슈 반영해 산출하고 Excel로 내려받는 React 프론트엔드 + Spring Boot 백엔드 API | [day01-gyeongsik-fee-calculator](day01-gyeongsik-fee-calculator/) |
| 01 | 2026-10-17 | 금융정보업무 회비 산출 (대용) | 업무별 산출 옵션(분기 배분·균등회비 방식·실적 인정 항목·우체국 처리)으로 기관별 회비와 산출 근거·검증 결과 생성 | [day01-daeyong-fee-calculator](day01-daeyong-fee-calculator/) |
| 01 | 2026-10-17 | 회비자동산출 AI툴 (우성) | 업무별 분담기준을 AI로 규칙화해 버전 관리하고, Excel·HWP 실적으로 기관별 분기 회비를 산출해 Excel로 내려받기 | [day01-woosung-fee-ai](day01-woosung-fee-ai/) |
| 02 | 2026-10-22 | 회비 산출 규칙 프로토타입 (대용) | 공통 규칙 초안(R-1~R-15, D-1~D-15)만 보고 다시 쓴 두 번째 구현. v4와 같은 입력으로 결과를 맞춰 보는 병행검증(화면·결과 엑셀·무작위 500건) 포함 | [day02-daeyong-fee-rules-proto](day02-daeyong-fee-rules-proto/) |

## 폴더 구조

```
day01-<slug>/   각 산출물 (코드 + README)
templates/      새 산출물 시작용 템플릿
```

새 산출물 추가: `cp -r templates/day-template dayNN-<slug>` 후 위 표에 한 줄 추가.
