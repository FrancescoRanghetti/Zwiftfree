#!/bin/bash
# Avvia Zwiftfree (db + backend + frontend via Docker Compose), apre subito una finestra Chrome dedicata che mostra
# "Avvio in corso…" e passa all'app appena il server risponde. Quando chiudi quella finestra (Cmd+Q) ferma tutti i
# container. I dati del DB restano nel volume.
#
# Uso: scripts/zwiftfree.sh            avvia, pedala, alla chiusura ferma tutto
#      scripts/zwiftfree.sh stop       ferma solo i container
#      ZWIFTFREE_REBUILD=1 ...         forza la ricostruzione delle immagini

set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.orbstack/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT_DIR="${ZWIFTFREE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
STATE_DIR="$HOME/Library/Application Support/Zwiftfree"
CHROME_PROFILE="$STATE_DIR/chrome-profile"
SPLASH="$STATE_DIR/avvio.html"
LOCK_FILE="$STATE_DIR/launcher.pid"
BUILT_COMMIT_FILE="$STATE_DIR/built-commit"
LOG_FILE="$HOME/Library/Logs/Zwiftfree.log"

mkdir -p "$STATE_DIR" "$(dirname "$LOG_FILE")"
exec >>"$LOG_FILE" 2>&1
echo "=== $(date '+%F %T') $0 ${1:-start}"

cd "$PROJECT_DIR" || exit 1
PORT="$(grep -E '^FRONTEND_HOST_PORT=' .env 2>/dev/null | cut -d= -f2)"
URL="http://localhost:${PORT:-4280}"

notify() { osascript -e "display notification \"$1\" with title \"Zwiftfree\"" >/dev/null 2>&1 || true; }
chrome_pid() { pgrep -f -- "--user-data-dir=$CHROME_PROFILE" | head -1; }
stop_stack() { echo "$(date '+%T') Fermo i container…"; docker compose stop; notify "Container fermati. Buon recupero!"; }
fail() {
  echo "ERRORE: $1"
  local pid; pid="$(chrome_pid)"; [[ -n "$pid" ]] && kill "$pid"
  osascript -e "display alert \"Zwiftfree\" message \"$1\n\nLog: $LOG_FILE\" as critical" >/dev/null 2>&1
  exit 1
}
# Lanciato con `open` (LaunchServices): la finestra arriva in primo piano sullo Spazio attuale, a priorità normale.
open_window() {
  open -na "Google Chrome" --args --user-data-dir="$CHROME_PROFILE" --app="$1" \
    --no-first-run --no-default-browser-check --window-size=1600,1000
}

if [[ "${1:-}" == "stop" ]]; then stop_stack; exit 0; fi

# Già avviato? Porta solo la finestra in primo piano.
if [[ -f "$LOCK_FILE" ]] && kill -0 "$(cat "$LOCK_FILE")" 2>/dev/null; then
  echo "Già in esecuzione, riporto la finestra in primo piano."
  open_window "$URL"
  exit 0
fi
echo $$ >"$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# 1. Container: ricostruisce le immagini solo se il codice è cambiato dall'ultima build.
HEAD_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
BUILD_FLAG=()
STATUS="Avvio database, backend e frontend…"
if [[ "${ZWIFTFREE_REBUILD:-0}" == "1" || "$(cat "$BUILT_COMMIT_FILE" 2>/dev/null)" != "$HEAD_COMMIT" ]]; then
  BUILD_FLAG=(--build)
  STATUS="Codice aggiornato: ricostruisco le immagini (qualche minuto)…"
fi

# 2. Finestra subito, con una schermata d'attesa che passa all'app appena il frontend risponde
#    (il frontend parte solo quando il backend è pronto, vedi docker-compose.yml).
cat >"$SPLASH" <<EOF
<!doctype html><meta charset="utf-8"><title>Zwiftfree</title>
<style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#1e1e1e;color:#eee;font:16px -apple-system,sans-serif}
  .b{text-align:center} h1{font-size:28px;margin:16px 0 8px} p{color:#aaa;margin:0}
  .s{width:36px;height:36px;margin:auto;border:4px solid #444;border-top-color:#ff9800;border-radius:50%;animation:r 1s linear infinite}
  @keyframes r{to{transform:rotate(360deg)}}
</style>
<div class="b"><div class="s"></div><h1>Zwiftfree</h1><p>$STATUS</p></div>
<script>
  const url = "$URL";
  (async function poll() {
    try { await fetch(url + "/?ping=" + Date.now(), { mode: "no-cors", cache: "no-store" }); location.replace(url); }
    catch { setTimeout(poll, 700); }
  })();
</script>
EOF
open_window "file://$SPLASH"

# 3. Docker (OrbStack) e container
if ! docker info >/dev/null 2>&1; then
  orbctl start >/dev/null 2>&1 || open -ga OrbStack
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || fail "Docker (OrbStack) non risponde."
fi
docker compose up -d --wait --wait-timeout 300 ${BUILD_FLAG[@]+"${BUILD_FLAG[@]}"} || fail "I container non sono partiti."
[[ ${#BUILD_FLAG[@]} -gt 0 ]] && echo "$HEAD_COMMIT" >"$BUILT_COMMIT_FILE"
echo "$(date '+%T') Stack pronto su $URL"

# 4. Aspetta che chiudi la finestra, poi ferma tutto.
for _ in $(seq 1 30); do [[ -n "$(chrome_pid)" ]] && break; sleep 1; done
PID="$(chrome_pid)"
while [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; do sleep 2; done
echo "$(date '+%T') Finestra chiusa."
stop_stack
