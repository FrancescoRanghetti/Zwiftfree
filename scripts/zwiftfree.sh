#!/bin/bash
# Avvia Zwiftfree (db + backend + frontend via Docker Compose), apre l'app in una finestra Chrome dedicata
# e, quando chiudi quella finestra (Cmd+Q), ferma tutti i container. I dati del DB restano nel volume.
#
# Uso: scripts/zwiftfree.sh            avvia, pedala, alla chiusura ferma tutto
#      scripts/zwiftfree.sh stop       ferma solo i container
#      ZWIFTFREE_REBUILD=1 ...         forza la ricostruzione delle immagini

set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.orbstack/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT_DIR="${ZWIFTFREE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
STATE_DIR="$HOME/Library/Application Support/Zwiftfree"
CHROME_PROFILE="$STATE_DIR/chrome-profile"
LOCK_FILE="$STATE_DIR/launcher.pid"
BUILT_COMMIT_FILE="$STATE_DIR/built-commit"
LOG_FILE="$HOME/Library/Logs/Zwiftfree.log"
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

mkdir -p "$STATE_DIR" "$(dirname "$LOG_FILE")"
exec >>"$LOG_FILE" 2>&1
echo "=== $(date '+%F %T') $0 ${1:-start}"

cd "$PROJECT_DIR" || exit 1
PORT="$(grep -E '^FRONTEND_HOST_PORT=' .env 2>/dev/null | cut -d= -f2)"
URL="http://localhost:${PORT:-4280}"

notify() { osascript -e "display notification \"$1\" with title \"Zwiftfree\"" >/dev/null 2>&1 || true; }
fail() { echo "ERRORE: $1"; osascript -e "display alert \"Zwiftfree\" message \"$1\n\nLog: $LOG_FILE\" as critical" >/dev/null 2>&1; exit 1; }
stop_stack() { echo "Fermo i container…"; docker compose stop; notify "Container fermati. Buon recupero!"; }

if [[ "${1:-}" == "stop" ]]; then stop_stack; exit 0; fi

# Già avviato? Porta solo la finestra in primo piano.
if [[ -f "$LOCK_FILE" ]] && kill -0 "$(cat "$LOCK_FILE")" 2>/dev/null; then
  echo "Già in esecuzione, riporto la finestra in primo piano."
  "$CHROME_BIN" --user-data-dir="$CHROME_PROFILE" --app="$URL" >/dev/null 2>&1 &
  exit 0
fi
echo $$ >"$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# 1. Docker (OrbStack)
if ! docker info >/dev/null 2>&1; then
  notify "Avvio OrbStack…"
  orbctl start >/dev/null 2>&1 || open -a OrbStack
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || fail "Docker (OrbStack) non risponde."
fi

# 2. Container: ricostruisce le immagini solo se il codice è cambiato dall'ultima build.
HEAD_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
BUILD_FLAG=()
if [[ "${ZWIFTFREE_REBUILD:-0}" == "1" || "$(cat "$BUILT_COMMIT_FILE" 2>/dev/null)" != "$HEAD_COMMIT" ]]; then
  BUILD_FLAG=(--build)
  notify "Codice aggiornato: ricostruisco le immagini (qualche minuto)…"
else
  notify "Avvio db, backend e frontend…"
fi
docker compose up -d --wait --wait-timeout 300 ${BUILD_FLAG[@]+"${BUILD_FLAG[@]}"} || fail "I container non sono partiti."
[[ ${#BUILD_FLAG[@]} -gt 0 ]] && echo "$HEAD_COMMIT" >"$BUILT_COMMIT_FILE"

# 3. Finestra Chrome dedicata (profilo separato, così sappiamo quando la chiudi). Resta qui finché non la chiudi.
notify "Pronto, buona pedalata!"
echo "Apro $URL"
"$CHROME_BIN" --user-data-dir="$CHROME_PROFILE" --app="$URL" --no-first-run --no-default-browser-check \
  --window-size=1600,1000
echo "Finestra chiusa."

# 4. Chiusura: ferma tutto.
stop_stack
