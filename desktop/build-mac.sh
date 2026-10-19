#!/bin/bash
# 构建 macOS .app 与 .dmg（不依赖 electron-builder，纯本地）
set -e
ROOT="/Users/wangxiaoli/WorkBuddy/workbuddy-键政游戏"
DESK="$ROOT/desktop"
APP_NAME="明鉴桌宠"
BUILD="/tmp/mjbuild"
DIST="$DESK/dist"

rm -rf "$BUILD"; mkdir -p "$BUILD" "$DIST"

# 1) 复制 Electron 运行时
cp -R "$DESK/node_modules/electron/dist/Electron.app" "$BUILD/$APP_NAME.app"
APP="$BUILD/$APP_NAME.app"

# 2) 去掉默认 app
rm -rf "$APP/Contents/Resources/default_app.asar"

# 3) 放入我们的应用
mkdir -p "$APP/Contents/Resources/app/web"
cp "$DESK/main.js" "$DESK/preload.js" "$APP/Contents/Resources/app/"
cp -R "$ROOT/app/." "$APP/Contents/Resources/app/web/"
# 打包内不需要测试/工具/大素材
rm -rf "$APP/Contents/Resources/app/web/test" "$APP/Contents/Resources/app/web/tools" \
       "$APP/Contents/Resources/app/web/sql" "$APP/Contents/Resources/app/web/assets/ref-frames" \
       "$APP/Contents/Resources/app/web/assets/_orig" "$APP/Contents/Resources/app/web/assets/voice-test"

cat > "$APP/Contents/Resources/app/package.json" <<'JSON'
{
  "name": "mingjian-pet",
  "productName": "明鉴桌宠",
  "version": "1.0.0",
  "main": "main.js",
  "description": "明鉴站桌宠"
}
JSON

# 4) 可执行文件改名
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/$APP_NAME"

# 5) Info.plist
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>host.workbuddy.mingjian.pet</string>
  <key>CFBundleExecutable</key><string>$APP_NAME</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMinimumSystemVersion</key><string>10.15.0</string>
</dict></plist>
PLIST

# 6) 图标：中号 Claude -> icns
ICONSRC="$ROOT/app/assets/pet/skin-claude-medium.png"
if [ -f "$ICONSRC" ]; then
  ICONSET="$BUILD/AppIcon.iconset"; mkdir -p "$ICONSET"
  for s in 16 32 64 128 256 512; do
    /Users/wangxiaoli/.workbuddy/binaries/python/envs/default/bin/python - "$ICONSRC" "$ICONSET/icon_${s}x${s}.png" "$s" <<'PY'
import sys
from PIL import Image
src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert('RGBA')
# 透明留白 + 居中缩放
canvas = Image.new('RGBA', (size, size), (0,0,0,0))
s = int(size * 0.86)
r = im.resize((s, int(im.height * s / im.width)), Image.LANCZOS)
canvas.paste(r, ((size-r.width)//2, (size-r.height)//2), r)
canvas.save(dst)
PY
    cp "$ICONSET/icon_${s}x${s}.png" "$ICONSET/icon_${s}x${s}@2x.png" 2>/dev/null || true
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns" 2>/dev/null && echo "icon ok" || echo "icon 跳过"
fi

# 7) 签名（ad-hoc，避免 Gatekeeper 直接拒绝）
codesign --force --deep --sign - "$APP" 2>/dev/null && echo "codesign ad-hoc ok" || echo "codesign 跳过"

# 8) 打 DMG
STAGE="$BUILD/dmg"; mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO \
  "$DIST/mingjian-pet-1.0.0-mac-arm64.dmg" >/dev/null
echo "DMG: $DIST/mingjian-pet-1.0.0-mac-arm64.dmg"
ls -lh "$DIST"
