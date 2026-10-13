#!/bin/bash
# 세션 시작 시 GitHub 최신 상태로 맞추고 진행 상황을 Claude 맥락에 주입한다.
# 로컬(macOS, main 브랜치)과 클라우드(Linux, upstream 없는 claude/* 브랜치) 모두에서 동작해야 한다.
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
[ -d /opt/homebrew/bin ] && export PATH="/opt/homebrew/bin:$PATH"

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  if out=$(git pull --ff-only -q 2>&1); then
    echo "[sync] GitHub과 동기화 완료 ($branch): $(git log -1 --format='%h %s')"
  else
    echo "[sync] ⚠️ git pull 실패 — 로컬 상태로 진행합니다. 사용자에게 알리고 원인을 확인하세요."
    echo "$out" | head -5
  fi
else
  # 클라우드 작업 브랜치처럼 upstream이 없으면 pull 대신 fetch 후 origin/main과의 차이만 알린다.
  if out=$(git fetch -q origin 2>&1); then
    behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "?")
    echo "[sync] $branch 브랜치(upstream 없음): origin/main fetch 완료, main보다 ${behind}커밋 뒤처짐"
  else
    echo "[sync] ⚠️ git fetch 실패 — 로컬 상태로 진행합니다. 사용자에게 알리고 원인을 확인하세요."
    echo "$out" | head -5
  fi
fi

dirty=$(git status --porcelain)
[ -n "$dirty" ] && echo "[sync] 커밋되지 않은 로컬 변경 있음:" && echo "$dirty" | head -10

echo
echo "===== PROGRESS.md ====="
cat PROGRESS.md 2>/dev/null || echo "(PROGRESS.md 없음)"
exit 0
