#!/bin/bash
# ---------------------------------------------------------------
# 修复 macOS 把 Electron 当作恶意软件移入废纸篓 / 报「已损坏」的问题
#
# 原因：旧版 Electron 的苹果公证（notarization）被吊销，Gatekeeper 会
#      直接把 Electron.app 扔进废纸篓。本脚本做三件事：
#        1) 若 Electron.app 已在废纸篓，自动恢复回 dist/
#        2) 清除 com.apple.quarantine 隔离属性
#        3) 用本地 ad-hoc 签名覆盖被吊销的苹果签名
#
# 用法：  cd desktop && ./fix-mac.sh
# ---------------------------------------------------------------
set -u
cd "$(dirname "$0")" || exit 1

APP="node_modules/electron/dist/Electron.app"
BIN="$APP/Contents/MacOS/Electron"

echo "==> 检查 Electron.app ..."
if [ ! -d "$APP" ]; then
  echo "    dist 里没有 Electron.app，尝试从废纸篓恢复最新的一个"
  # 找废纸篓里最新的 Electron*.app
  LATEST="$(ls -dt "$HOME"/.Trash/Electron*.app 2>/dev/null | head -1)"
  if [ -n "${LATEST:-}" ]; then
    echo "    从废纸篓恢复：$LATEST"
    mv "$LATEST" "$APP"
  else
    echo "    废纸篓里也没有，重新下载二进制（走国内镜像）..."
    ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js || {
      echo "!! 下载失败，请检查网络后重试"; exit 1
    }
  fi
fi

if [ ! -x "$BIN" ]; then
  echo "!! 仍找不到可执行文件 $BIN，请重新 npm install"; exit 1
fi

echo "==> 清除隔离属性 (quarantine)"
xattr -cr "$APP" 2>/dev/null

echo "==> 本地 ad-hoc 重新签名"
codesign --force --deep --sign - "$APP" 2>&1 | tail -3

echo "==> 校验签名"
if codesign --verify --deep --strict "$APP" 2>/dev/null; then
  echo "    ✓ 签名有效"
else
  echo "    ! 校验未通过，但通常仍可运行；若不行请重装 electron"
fi

echo ""
echo "完成。现在可以运行：  npm start"
