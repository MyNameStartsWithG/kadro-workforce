#!/usr/bin/env bash
#
# Downloads the Kadro voice-command log (the n8n "kadro_log" data table) for analysis.
#
#   ./download-log.sh                 -> every record
#   ./download-log.sh 2026-11-01      -> records from this day on (inclusive)
#
# Output: logs/kadro-log-<stamp>.jsonl, one record per line. The "detail" field is the full record Kadro
# sent (JSON text): model time and tokens per turn, tool calls with their arguments and results,
# the cards opened. It contains employee names and timesheet summaries; do not share the file.
#
# Read only: connects to the database READONLY and does not touch n8n.
set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/n8n_server}"
SERVER="${SERVER:-root@<server-ip>}"
CONTAINER="n8n"
DAY="${1:-0000-00-00}"
case "$DAY" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;; *) echo "the date must be YYYY-MM-DD" >&2; exit 1 ;; esac

cd "$(dirname "$0")"
mkdir -p logs
OUT="logs/kadro-log-$(date +%Y%m%d-%H%M%S).jsonl"

# Rows go to stdout as JSONL, the summary to stderr.
ssh -i "$SSH_KEY" "$SERVER" "docker exec -w /usr/local/lib/node_modules/n8n $CONTAINER node -e '
const sqlite3 = require(\"sqlite3\");
const db = new sqlite3.Database(\"/home/node/.n8n/database.sqlite\", sqlite3.OPEN_READONLY);
db.get(\"select id from data_table where name = ?\", [\"kadro_log\"], (e, t) => {
  if (e || !t) { console.error(e ? e.message : \"no kadro_log table\"); process.exit(1); }
  db.all(\"select * from data_table_user_\" + t.id + \" where day >= ? order by id\", [\"$DAY\"], (e2, rows) => {
    if (e2) { console.error(e2.message); process.exit(1); }
    let bytes = 0;
    for (const r of rows) { const j = JSON.stringify(r); bytes += j.length; console.log(j); }
    console.error(\"    \" + rows.length + \" records, \" + (bytes / 1024).toFixed(0) + \" KB (default n8n data table limit is 50 MB)\");
  });
});'" > "$OUT"

echo "    $OUT"
