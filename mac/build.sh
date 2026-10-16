#!/bin/bash
# Builds the menu bar app into dist/McMaster2DYMO.app. The absolute path of
# this checkout and of the `node` on PATH are baked into Info.plist, so the
# app knows where server/index.js lives; move the repo and rebuild.
set -euo pipefail
cd "$(dirname "$0")"
REPO="$(cd .. && pwd)"
NODE="${NODE:-$(command -v node)}"
VERSION="$(node -p 'require("../package.json").version')"
APP="$REPO/dist/McMaster2DYMO.app"

# Plain swiftc, not `swift build`. On this Mac a stray 2015 cloog header,
# /usr/local/include/block.h, shadows the SDK's Block.h (Swift's clang importer
# searches /usr/local/include first, and the filesystem is case-insensitive),
# which breaks every Foundation import. A clang VFS overlay maps that one path
# back to the SDK's header; it is harmless on a Mac without the stray file.
SDK="$(xcrun --show-sdk-path)"
mkdir -p .build
cat > .build/overlay.yaml <<YAML
{ "version": 0, "case-sensitive": "false", "roots": [
  { "name": "/usr/local/include", "type": "directory", "contents": [
    { "name": "Block.h", "type": "file", "external-contents": "$SDK/usr/include/Block.h" } ] } ] }
YAML
swiftc -O -parse-as-library -target "$(uname -m)-apple-macos14.0" \
  -Xcc -ivfsoverlay -Xcc .build/overlay.yaml \
  Sources/McMaster2DYMO/*.swift -o .build/McMaster2DYMO

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/McMaster2DYMO "$APP/Contents/MacOS/"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.davidnichols.mcmaster2dymo.app</string>
  <key>CFBundleName</key><string>McMaster2DYMO</string>
  <key>CFBundleDisplayName</key><string>McMaster2DYMO</string>
  <key>CFBundleExecutable</key><string>McMaster2DYMO</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>MCM2DYMORepo</key><string>$REPO</string>
  <key>MCM2DYMONode</key><string>$NODE</string>
</dict></plist>
PLIST
codesign --force --sign - "$APP" >/dev/null 2>&1
echo "built $APP (repo $REPO, node $NODE)"
echo "run:  open \"$APP\""
