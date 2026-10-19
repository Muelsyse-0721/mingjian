#!/bin/bash
DESK="/Users/wangxiaoli/WorkBuddy/workbuddy-键政游戏/desktop"
cd "$DESK" || exit 1
unset ELECTRON_RUN_AS_NODE
exec "$DESK/node_modules/.bin/electron" "$DESK" "$@"
