#!/bin/bash
# 세션 시작 시 GitHub 최신 상태로 맞추고 진행 상황을 Claude 맥락에 주입한다.
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
export PATH="/opt/homebrew/bin:$PATH"

if out=$(git pull --ff-only -q 2>&1); then
  echo "[sync] GitHub(origin/main)과 동기화 완료: $(git log -1 --format='%h %s')"
else
  echo "[sync] ⚠️ git pull 실패 — 로컬 상태로 진행합니다. 사용자에게 알리고 원인을 확인하세요."
  echo "$out" | head -5
fi

dirty=$(git status --porcelain)
[ -n "$dirty" ] && echo "[sync] 커밋되지 않은 로컬 변경 있음:" && echo "$dirty" | head -10

echo
echo "===== PROGRESS.md ====="
cat PROGRESS.md 2>/dev/null || echo "(PROGRESS.md 없음)"
exit 0
