#!/usr/bin/env bash
#
# Installs the Kadro voice-command workflows on the core project's LIVE n8n.
#
#   ./deploy.sh            -> asks for confirmation
#   YES=1 ./deploy.sh      -> does not ask
#   SSH_KEY=... SERVER=root@... ./deploy.sh
#
# What it does:
#   1. exports the live workflows                     -> ROLLBACK BACKUP (never deleted)
#   2. builds kadro-assist / kadro-transcribe from copies of core-assist / -transcribe
#      (the core workflows are NOT touched; it carries on only if credentials and connections are unchanged);
#      kadro-log: the same gate + command log into the "kadro_log" data table
#   3. adds "kadro:<key>" to GUARD_KEYS in .env (if missing). .env is backed up first.
#   4. import -> publish (SEPARATE ssh session) -> recreate the container (so the new .env is read)
#   5. checks: an invalid key -> bad_key; a small assist call with the valid key and a single
#      "setup" row in the kadro_log table (kind=setup; skipped in analysis)
#
# Order and pitfalls are the same as the core project's scripts/deploy-workflows.sh: publish does not
# stick in the same session as import, import has no effect without a restart, and the webhook path is
# registered seconds after healthz.
#
# ROLLBACK: delete (or deactivate) kadro-assist, kadro-transcribe and kadro-log in the n8n UI,
# copy .env.bak-<stamp> back to .env, `docker compose up -d n8n`.
#
# If the core project's deploy script runs later, it exports and patches the kadro workflows too:
# the gate (Guard) and error codes stay the same, which is the intended behaviour.
set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/n8n_server}"
SERVER="${SERVER:-root@<server-ip>}"
REMOTE_DIR="/opt/n8n"
CONTAINER="n8n"

cd "$(dirname "$0")"
ssh_cmd() { ssh -i "$SSH_KEY" "$SERVER" "$@"; }

STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="${WORK:-$PWD/backups/workflows-$STAMP}"
mkdir -p "$WORK/live" "$WORK/kadro"

echo "==> 1/5  fetching the live workflows"
ssh_cmd "docker exec $CONTAINER sh -c 'rm -rf /tmp/wfexp && mkdir -p /tmp/wfexp \
  && n8n export:workflow --all --separate --output=/tmp/wfexp' >/dev/null 2>&1
rm -rf /tmp/wfexp-host && docker cp $CONTAINER:/tmp/wfexp /tmp/wfexp-host >/dev/null"
scp -q -i "$SSH_KEY" "$SERVER:/tmp/wfexp-host/*.json" "$WORK/live/"
echo "    backup (for rollback): $WORK/live"

echo "==> 2/5  building the kadro workflows"
python build_workflows.py "$WORK/live" "$WORK/kadro"

if [ -z "${YES:-}" ]; then
  printf '==> about to install on the live server (core workflows are not touched, n8n restarts for ~20 s). Continue? [y/N] '
  read -r answer
  case "$answer" in
    y|Y) ;;
    *) echo "cancelled (the backup stays in $WORK/live)"; exit 1 ;;
  esac
fi

echo "==> 3/5  Kadro key"
# The key is generated on the server and stays there (chmod 600); it is never printed.
ssh_cmd "cd $REMOTE_DIR && cp .env .env.bak-$STAMP && \
if grep -qE '^GUARD_KEYS=(.*,)?kadro:' .env; then echo '    kadro key already present, left alone'; \
else K=\$(openssl rand -hex 24); \
  if grep -qE '^GUARD_KEYS=.+' .env; then sed -i \"s/^GUARD_KEYS=\(.*\)\$/GUARD_KEYS=\1,kadro:\$K/\" .env; \
  else sed -i \"s/^GUARD_KEYS=\$/GUARD_KEYS=kadro:\$K/\" .env; fi; \
  grep -qE '^GUARD_KEYS=(.*,)?kadro:' .env || { cp .env.bak-$STAMP .env; echo 'no GUARD_KEYS line found'; exit 1; }; \
  umask 077; echo \"\$K\" > $REMOTE_DIR/kadro-key.txt; echo '    kadro key added (.env backup: .env.bak-$STAMP)'; fi"

echo "==> 4/5  import + publish + recreate"
ssh_cmd "mkdir -p /tmp/wf-kadro-$STAMP"
scp -q -i "$SSH_KEY" "$WORK/kadro/"*.json "$SERVER:/tmp/wf-kadro-$STAMP/"
ssh_cmd "docker cp /tmp/wf-kadro-$STAMP $CONTAINER:/tmp/wf-kadro >/dev/null
for f in /tmp/wf-kadro-$STAMP/*.json; do
  docker exec $CONTAINER n8n import:workflow --input=/tmp/wf-kadro/\$(basename \$f) 2>&1 | tail -1
done"
# publish in a SEPARATE ssh session (pitfall a).
ssh_cmd "for id in KADROassist00001 KADROtranscr0001 KADROlog00000001; do
  docker exec $CONTAINER n8n publish:workflow --id=\$id 2>&1 | tail -1
done"
# up -d: recreates the container if .env changed (restart does not re-read .env); restart: makes the import take effect (pitfall b).
ssh_cmd "cd $REMOTE_DIR && docker compose up -d n8n >/dev/null 2>&1 && docker compose restart n8n >/dev/null 2>&1 && echo '    n8n restarted'"

echo "==> 5/5  checks"
ssh_cmd "for i in \$(seq 1 30); do
  if docker exec $CONTAINER wget -qO- http://localhost:5678/healthz >/dev/null 2>&1; then echo '    healthz 200'; break; fi
  sleep 2
done
sleep 6"   # the webhook path is registered AFTER healthz (pitfall c)

HOST="$(ssh_cmd "grep '^N8N_HOST=' $REMOTE_DIR/.env | cut -d= -f2" | tr -d ' \r\n')"
URL="https://$HOST"
KEY="$(ssh_cmd "cat $REMOTE_DIR/kadro-key.txt 2>/dev/null" | tr -d ' \r\n')"
FAILED=0

# The webhook path can be registered even later than 6 seconds after healthz (measured):
# wait up to 60 seconds while "Cannot POST" comes back. The live gate may answer with a plain
# "rejected" message instead of error_code; both count as a rejection.
for path in kadro/assist kadro/transcribe kadro/log; do
  for i in $(seq 1 30); do
    B="$(curl -s -m 25 -X POST "$URL/webhook/$path" -H 'X-Api-Key: this-key-is-invalid-on-purpose' || true)"
    case "$B" in *'Cannot POST'*) sleep 2 ;; *) break ;; esac
  done
  case "$B" in *'"error_code":"bad_key"'*|*'rejected'*) echo "    $path: rejection path ok" ;; *) echo "    $path: UNEXPECTED reply: $B" >&2; FAILED=1 ;; esac
done

if [ -n "$KEY" ]; then
  # A real model call (a few hundred tokens, well under a cent).
  B="$(curl -s -m 60 -X POST "$URL/webhook/kadro/assist" -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' \
    -d '{"system":"Answer briefly.","messages":[{"role":"user","content":"Just write ok."}],"tools":[]}' || true)"
  case "$B" in *'"say"'*) echo "    kadro/assist: the model answered: $B" ;; *) echo "    kadro/assist: UNEXPECTED reply: $B" >&2; FAILED=1 ;; esac
  # Log endpoint: the table is created if missing, a single row is written.
  Z="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  B="$(curl -s -m 60 -X POST "$URL/webhook/kadro/log" -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' \
    -d "{\"records\":[{\"id\":\"setup-$STAMP\",\"kind\":\"setup\",\"time\":\"$Z\",\"sentence\":\"deploy.sh check\"}]}" || true)"
  case "$B" in *'"ok":true'*) echo "    kadro/log: written to the table: $B" ;; *) echo "    kadro/log: UNEXPECTED reply: $B" >&2; FAILED=1 ;; esac
fi

echo
if [ "$FAILED" = 0 ]; then
  echo "DONE. Kadro > Settings > Voice commands:"
  echo "  Address: $URL"
  echo "  Key    : on the server in $REMOTE_DIR/kadro-key.txt"
  echo "To revoke the key: remove the kadro:... part from GUARD_KEYS in .env, docker compose up -d n8n."
else
  echo "Checks failed. Rollback: see the ROLLBACK note at the top of this script; backup in $WORK/live" >&2
  exit 1
fi
