#!/usr/bin/env bash
# Installe Papier dans /Applications et le définit comme lecteur Markdown par défaut.
# À lancer après « npm run tauri build ».
set -euo pipefail

APP_NAME="Papier"
BID="com.agencepersonnelle.papier"
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$PROJ/src-tauri/target/release/bundle/macos/$APP_NAME.app"
DEST="/Applications/$APP_NAME.app"
LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if [ ! -d "$SRC" ]; then
  echo "❌ Build introuvable : $SRC"
  echo "   Lance d'abord :  npm run tauri build"
  exit 1
fi

echo "→ Signature ad-hoc"
codesign --force --deep --sign - "$SRC" 2>/dev/null || true

echo "→ Installation dans /Applications"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo "→ Enregistrement auprès de Launch Services"
"$LSREG" -f "$DEST" || true

echo "→ Association des fichiers Markdown à Papier"
for t in .md .markdown .mdown .mkd .mdwn public.markdown net.daringfireball.markdown; do
  duti -s "$BID" "$t" all 2>/dev/null || true
done

echo ""
echo "✅ Papier installé et défini par défaut pour les .md"
echo "   Handler actuel pour .md :"
duti -x md 2>/dev/null || true
