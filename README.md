# 🎨 Vibe Coding Challenge

바이브코딩 챌린지 산출물 모음입니다.

## 산출물 목록

| Day | 날짜 | 제목 | 설명 | 링크 |
|-----|------|------|------|------|
| 01 | 2026-10-14 | 회비자동산출시스템 (경식) | 업무·분기별 회비를 AI 이슈 반영해 산출하고 Excel로 내려받는 React 프론트엔드 + Spring Boot 백엔드 API | [day01-gyeongsik-fee-calculator](day01-gyeongsik-fee-calculator/) |
| 01 | 2026-10-17 | 금융정보업무 회비 산출 (대용) | 업무별 산출 옵션(분기 배분·균등회비 방식·실적 인정 항목·우체국 처리)으로 기관별 회비와 산출 근거·검증 결과 생성 | [day01-daeyong-fee-calculator](day01-daeyong-fee-calculator/) |
| 01 | 2026-10-17 | 회비자동산출 AI툴 (우성) | 업무별 분담기준을 AI로 규칙화해 버전 관리하고, Excel·HWP 실적으로 기관별 분기 회비를 산출해 Excel로 내려받기 | [day01-woosung-fee-ai](day01-woosung-fee-ai/) |
| 02 | 2026-10-22 | 회비 산출 규칙 프로토타입 (대용) | 공통 규칙 초안(R-1~R-15, D-1~D-15)만 보고 다시 쓴 두 번째 구현. v4와 같은 입력으로 결과를 맞춰 보는 병행검증(화면·결과 엑셀·무작위 500건) 포함 | [day02-daeyong-fee-rules-proto](day02-daeyong-fee-rules-proto/) |
| 03 | 2026-10-27 | 최종 발표 시나리오 + 시연 영상 (대용) | 회비자동산출시스템 배포본의 기능을 실제 화면으로 분석해 심사 기준별 핵심 포인트를 정리하고, 2분 30초 키노트 문법의 발표 시나리오와 자막 입힌 시연 영상(1080p)을 Playwright 녹화로 제작 | [day03-daeyong-final-pitch](day03-daeyong-final-pitch/) |
| 04 | 2026-10-27 | 시연 영상 v2 · 모듈형 제작 체계 (석용) | 시연 영상을 화면(기능) 단위 모듈 11개로 나눠 고칠 모듈만 다시 찍고 이어 붙이는 체계. C-level용 자막 패널(번호 배지로 강조 영역과 일치), 사업 효과 코멘트, 스포트라이트·줌 재설계 | [day04-seokyong-demo-video](day04-seokyong-demo-video/) |
| 05 | 2026-10-29 | 시연 영상 · 공통 제작 파이프라인 (공통) | 회비자동산출시스템을 관리자 계정으로 돌려 보며 Playwright 로 장면을 녹화하고, 타이틀 카드·자막·배경음·더빙(문장 단위 자동 배치)을 입혀 2분 55초 애플 제품 영상 문법의 시연 영상을 만드는 스크립트 | [day05-common-demo-video](day05-common-demo-video/) |

## 폴더 구조

```
day01-<slug>/   각 산출물 (코드 + README)
templates/      새 산출물 시작용 템플릿
```

새 산출물 추가: `cp -r templates/day-template dayNN-<slug>` 후 위 표에 한 줄 추가.
