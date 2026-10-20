"""从 app/pet.js 抽取固定台词（按角色切分）。

被 tools/tts-build.py（Edge TTS 版）和 tools/voice-clone.py（克隆版）共用，
避免两处各写一份正则、日后不同步。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PET_JS = ROOT / "app" / "pet.js"

# 视频原文（fish_context.wav 是两人对话，按说话人切分后取的代表句）
REFERENCE = {
    "claude": "这傻鱼昨天宕机了，7天吃的token全吐出来了。",
    "fish": "好冷啊啊啊，我怎么睡在外面啊？谁这么好心呀，在我门口放这么多token。",
    "fish_extra": "小克，你最好了，放我下来，我再去吃几口好不好嘛？哇哦，99成稀罕物。",
}


def extract_lines():
    src = PET_JS.read_text(encoding="utf-8")
    i_claude = src.index("var CLAUDE")
    i_active = src.index("var activeChar")

    def strings(block):
        out = []
        for a, b in re.findall(r"'([^'\\\n]{2,80})'|\"([^\"\\\n]{2,80})\"", block):
            t = a or b
            if any("\u4e00" <= c <= "\u9fff" for c in t) and t not in out:
                out.append(t)
        return out

    fish = strings(src[:i_claude]) + strings(src[i_active:])
    claude = strings(src[i_claude:i_active])

    skip = ("跟随鼠标", "切换", "保存", "输入")
    fish = [t for t in fish if not any(s in t for s in skip)]
    claude = [t for t in claude if not any(s in t for s in skip)]

    for t in (REFERENCE["fish"], REFERENCE["fish_extra"]):
        if t not in fish:
            fish.insert(0, t)
    if REFERENCE["claude"] not in claude:
        claude.insert(0, REFERENCE["claude"])

    return {"fish": fish, "claude": claude}
