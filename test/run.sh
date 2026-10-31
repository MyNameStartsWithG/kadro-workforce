#!/usr/bin/env bash
#
# Test suite: for each group a SEPARATE Kadro (port 4417, test/.work) with fresh sample data and a fake n8n
# (port 4499, test/mock-n8n.mjs) are started. Real data (Documents\KADRO or ./data) is never touched,
# nothing goes to the internet, no model is called.
#
#   test/run.sh          -> API tests: voice commands (48), command log (25), employment-period lock (3)
#   test/run.sh ui       -> + browser tests (Python + Playwright: pip install playwright && playwright install chromium)
#
# Note: the sample data contains the September–October 2026 timesheet periods. The tests assume "today" is in an
# open period; after those dates a new period has to be opened in the sample data for the timesheet tests.
set -uo pipefail
cd "$(dirname "$0")/.."
T="$PWD/test/.work"
C="$T/calls.jsonl"
FAILED=0

group() {   # group <name> <command...>
  local name="$1"; shift
  echo; echo "==== $name"
  node test/prepare.mjs "$T" >/dev/null
  node test/mock-n8n.mjs 4499 "$C" > "$T/mock.log" 2>&1 & local MP=$!
  KADRO_FOLDER="$T" PORT=4417 KADRO_ASSISTANT_URL=http://127.0.0.1:4499 KADRO_ASSISTANT_KEY=test-key \
    KADRO_NO_BROWSER=1 node server.js > "$T/kadro.log" 2>&1 & local EP=$!
  for _ in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:4417/api/status && break; sleep 0.5; done
  # In Git Bash node.exe has its own Windows pid; command-log.test needs it to stop and restart the fake n8n.
  local MPW; MPW="$(cat /proc/$MP/winpid 2>/dev/null || echo $MP)"
  KILL="$MPW" MOCK="test/mock-n8n.mjs" "$@" | tee "$T/result.txt"
  grep -q "ALL PASSED" "$T/result.txt" || FAILED=1
  kill $EP $MP 2>/dev/null; wait $EP $MP 2>/dev/null
}

group "Voice commands" node test/assistant.test.mjs 4417 "$C" "$T/data/db.json"
group "Command log" node test/command-log.test.mjs 4417 "$T" "$C"
group "Employment-period lock" node test/contract-status.test.mjs
if [ "${1:-}" = "ui" ]; then
  export PYTHONIOENCODING=utf-8
  group "Browser: voice panel" python test/ui_assistant.py
  group "Browser: employee's view" python test/ui_employee_view.py
fi

echo
[ "$FAILED" = 0 ] && echo "ALL GROUPS PASSED" || { echo "FAILURES (details above; logs in test/.work)"; exit 1; }
