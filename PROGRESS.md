# 진행 상황

> 세션마다 자동으로 읽힌다. 최신 내용을 위에 유지하고, 오래된 세션 로그는 아래로 쌓는다.

## 현재 상태
- 저장소 세팅 완료 (템플릿, GitHub 동기화 훅 — 로컬 main과 클라우드 `claude/*` 브랜치 모두 동작)
- 산출물: 아직 없음

## 다음 할 일
- [ ] Day01 챌린지 과제 받아서 시작

## 결정 사항
- 모노레포 1개 + `dayNN-<slug>/` 폴더 구조
- 세션 맥락은 GitHub의 `CLAUDE.md` / `PROGRESS.md`로 관리 (로컬 메모리 사용 안 함)
- 이 저장소가 모든 프레임워크·작업의 베이스. git 서브모듈은 두지 않는다
- `connect-link` 저장소와는 연결하지 않는다 (서브모듈·참조·수정 모두 금지)

## 세션 로그
### 2026-10-13
- 베이스 세팅 점검: 서브모듈 없음 확인, connect-link와 연결하지 않기로 결정
- SessionStart 훅 수정(#1): upstream 없는 클라우드 브랜치에서는 pull 대신 fetch 후 main과의 차이만 표시, Homebrew 경로는 macOS에서만 추가

### 2026-10-10
- GitHub 연동, 저장소 생성(okeycsy/vibe-coding-challenge, Public)
- SessionStart 훅으로 git pull + PROGRESS.md 주입 구성
