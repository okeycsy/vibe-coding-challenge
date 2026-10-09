# Vibe Coding Challenge — 작업 규칙

바이브코딩 챌린지 산출물을 관리하는 모노레포. **GitHub(origin/main)이 원본**이며, 세션 맥락은 로컬 메모리가 아니라 이 저장소의 파일로 이어간다.

## 세션 맥락
- 세션 시작 시 `.claude/hooks/session-start.sh`가 `git pull` 후 `PROGRESS.md`를 맥락에 넣는다. 동기화 실패 메시지가 보이면 사용자에게 먼저 알린다.
- 이어갈 정보(진행 상황, 결정 사항, 다음 할 일)는 로컬 메모리(`~/.claude/...`)에 저장하지 말고 `PROGRESS.md`에 기록한다.
- 작업 단위를 마칠 때마다 `PROGRESS.md`를 갱신하고 커밋·push한다.
- 저장소가 Public이므로 개인정보·비밀값·사적인 메모는 어떤 파일에도 넣지 않는다.

## 산출물 규칙
- 새 산출물: `cp -r templates/day-template dayNN-<slug>` 후 README 채우기 (NN은 두 자리, slug는 영문 kebab-case).
- 루트 `README.md`의 산출물 표에 한 줄 추가.
- 산출물 폴더 안에서 독립적으로 실행 가능하게 만든다 (의존성·실행 방법을 해당 README에 기록).

## Git
- 브랜치는 `main` 하나로 운영, 커밋 후 바로 push.
- 커밋 메시지: `dayNN: <요약>` 또는 `chore: <요약>` 형식, 한국어 가능.
- git/gh는 Homebrew 버전(`/opt/homebrew/bin`) 사용 — 시스템 git은 Command Line Tools 누락으로 동작하지 않음.
