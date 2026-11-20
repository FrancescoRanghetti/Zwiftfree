#!/bin/bash
# Crea ~/Applications/Zwiftfree.app (lancia scripts/zwiftfree.sh) e la aggiunge al Dock.
# Rilancialo se sposti la cartella del progetto.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Applications/Zwiftfree.app"
LOGO="$PROJECT_DIR/frontend/zwiftfree-fe/public/logo.svg"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

chmod +x "$PROJECT_DIR/scripts/zwiftfree.sh"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat >"$APP/Contents/MacOS/Zwiftfree" <<EOF
#!/bin/bash
export ZWIFTFREE_DIR="$PROJECT_DIR"
exec "$PROJECT_DIR/scripts/zwiftfree.sh" "\$@"
EOF
chmod +x "$APP/Contents/MacOS/Zwiftfree"

cat >"$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Zwiftfree</string>
  <key>CFBundleDisplayName</key><string>Zwiftfree</string>
  <key>CFBundleIdentifier</key><string>local.zwiftfree.launcher</string>
  <key>CFBundleExecutable</key><string>Zwiftfree</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
EOF

# Icona dal logo del frontend.
if qlmanage -t -s 1024 -o "$TMP" "$LOGO" >/dev/null 2>&1 && [[ -f "$TMP/logo.svg.png" ]]; then
  ICONSET="$TMP/AppIcon.iconset"
  mkdir "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$TMP/logo.svg.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) "$TMP/logo.svg.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
fi
touch "$APP"

# Aggiunge al Dock (se non c'è già).
if ! defaults read com.apple.dock persistent-apps | grep -q "Zwiftfree.app"; then
  defaults write com.apple.dock persistent-apps -array-add \
    "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>file://$APP/</string><key>_CFURLStringType</key><integer>15</integer></dict></dict></dict>"
  killall Dock
fi

echo "Installata: $APP (anche nel Dock)."
