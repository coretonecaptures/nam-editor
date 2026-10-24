#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Match the macOS Test Build workflow without publishing a release or using
# Developer ID credentials. electron-vite reads local IR_LAB_URL_SCHEME from
# .env.local when present.
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --universal --publish never

app='release/mac-universal/NAM Lab.app'
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"

CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder \
    --mac dmg --universal --publish never --prepackaged release/mac-universal

version=$(node -p 'require("./package.json").version')
dmg="release/NAM Lab-${version}-universal.dmg"
hdiutil verify "$dmg"
printf 'Local test DMG: %s\n' "$PWD/$dmg"
