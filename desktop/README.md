# 大肥鱼桌宠 · 桌面版（Electron 脚手架）

把 `app/pet.html` 包成一个 **透明、无边框、置顶、跨桌面、可拖动** 的 macOS 桌面宠物窗口。
不改动 `app/` 里的任何文件，桌宠化需要的补丁都只存在于 `desktop/`。

## 目录

```
desktop/
├── package.json    # electron 依赖 + npm start
├── main.js         # 主进程：窗口参数、置顶/跨桌面、注入透明样式、右键菜单、热键、拖动 IPC
├── preload.js      # 预加载：把「拖宠物」变成「拖窗口」；表情图缺失兜底
└── README.md
```

## 安装与运行

```bash
cd desktop
npm install
npm start
```

国内网络下载 Electron 二进制较慢时，可先设镜像再装：

```bash
cd desktop
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
npm start
```

### Windows 上运行（同一套步骤，注意几点）

1. 先装 Node.js LTS（https://nodejs.org，安装时勾选 “Add to PATH”），打开 PowerShell 或 CMD 验证 `node -v` / `npm -v` 能出版本号。
2. 在 `desktop` 目录安装并启动：

   ```powershell
   cd desktop
   npm install
   npm start
   ```

   国内下载慢，先设镜像（PowerShell 写法）：

   ```powershell
   $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
   npm install
   npm start
   ```

   （CMD 写法：`set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 再 `npm install`）

3. 快捷键在 Windows 上自动映射为：
   - `Ctrl + Shift + F`：显示 / 隐藏桌宠（对应 macOS 的 `Cmd+Shift+F`）
   - `Ctrl + Alt + Q`：退出（对应 macOS 的 `Cmd+Option+Q`）
   - 右键点击桌宠同样弹出菜单（显示/隐藏、退出）。
4. 透明窗口依赖 Windows 10 / 11 的桌面合成（Win7 不支持透明）；首次启动 Electron 会解压二进制，可能要等几秒。
5. 若项目所在路径含中文（如 `workbuddy-键政游戏`）导致 npm / Electron 报编码错误，把 `desktop` 文件夹整体复制到纯英文路径（如 `C:\pet`）再 `npm install` / `npm start`。

按普通网页（带讲解卡片、问答面板、不透明背景）打开，方便调试：

```bash
npm run start:full      # 等价于 electron . --full
```

## 窗口关键配置（main.js）

| 需求 | 实现 |
| --- | --- |
| 透明 | `transparent: true` + `frame: false` + `backgroundColor: '#00000000'` + `hasShadow: false` |
| 无边框 | `frame: false`（同时关掉 `maximizable/minimizable/fullscreenable`） |
| 置顶 | `alwaysOnTop: true`，并 `win.setAlwaysOnTop(true, 'screen-saver')` 提到屏幕保护层 |
| 跨桌面 | `win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` |
| 不占 Dock / 任务栏 | `skipTaskbar: true` + `app.dock.hide()` |
| 安全 | `nodeIntegration: false` + `contextIsolation: true` + 只读 preload 暴露两个方法 |
| 加载页面 | `win.loadFile(path.join(__dirname, '..', 'app', 'pet.html'))` |

> macOS 上透明窗口必须同时满足 `transparent: true` 和 `frame: false`；
> 只设 `transparent` 仍会有系统标题栏和白色底，看起来「不透明」。

### 为什么还要注入 CSS

`app/pet.html` 本身是网页原型：`body` 是 `#eef3f9` 的不透明底色，还带讲解卡片和问答面板。
主进程在 `did-finish-load` 后用 `webContents.insertCSS()` 注入一段样式（**不写回文件**）：

```css
html, body { background: transparent !important; }
.demo, #qa, #pet-close, #pet-restore { display: none !important; }
#pet { left: 52px !important; top: 96px !important; }
```

所以窗口透明了，画面上只剩宠物本体；`#pet` 被固定在窗口左下角，窗口整体拖动才有意义。

### 拖动是怎么实现的

宠物页里的拖拽只改 `#pet` 的 `left/top`（页面内坐标），在 260×260 的小窗里几乎看不出来。
`preload.js` 额外监听 `pointerdown/move`，把 `event.screenX/screenY` 减去抓取偏移后
通过 IPC 发给主进程，由 `win.setPosition()` 移动整个窗口。
页面自己的点击换表情、说话、端钢盆等逻辑不受影响。

## 热键与退出

无边框窗口没有关闭按钮，必须有退出通路：

| 热键 | 作用 |
| --- | --- |
| `Cmd + Shift + F` | 显示 / 隐藏桌宠 |
| `Cmd + Option + Q` | 退出应用 |

右键点击宠物 → 菜单里也有「显示 / 隐藏」和「退出」。
（`Cmd+Shift+Q` 是 macOS 注销快捷键，所以退出用 `Cmd+Option+Q`。）

## macOS 说明

### ⚠️ 被系统当成「恶意软件」移入废纸篓（Electron 31.7.7 常见）

现象：`npm start` 报 `spawn .../Electron.app/Contents/MacOS/Electron ENOENT`，或者 macOS 弹窗说
应用「已损坏 / 检测到恶意软件」，把它移进了废纸篓。

根因不是病毒，是 **这个 Electron 版本的苹果公证（notarization）被 Apple 吊销了**
（`spctl --assess` 会报 `notarization indicates this code has been revoked`）。
Gatekeeper 见到被吊销的签名就把整个 `Electron.app` 挪走。

修复：直接跑仓库自带的一键脚本（会自动从废纸篓恢复 + 清隔离属性 + 本地 ad-hoc 重签名）：

```bash
cd desktop
./fix-mac.sh
npm start
```

如果 macOS 又弹「移到废纸篓」，**点「取消」，不要点移入废纸篓**；也**不要**让柠檬清理之类的工具
执行「强力卸载残留」，那会把整个 `node_modules/electron` 删掉。

彻底解决（可选）：把 Electron 升级到公证未被吊销的新版本，例如

```bash
cd desktop
npm install electron@latest --save-dev
./fix-mac.sh   # 升级后若仍被隔离，再跑一次
npm start
```

- **权限**：正常使用不需要辅助功能权限。若热键无反应，去「系统设置 → 隐私与安全性 → 辅助功能」
  检查是否有其他应用占用了同名快捷键（`globalShortcut.register` 返回 false 即注册失败）。
- **未签名应用**：`npm start` 通过本地 Electron 运行，不涉及签名；若要打包成 .app 再做签名/公证。
- **跨桌面 / 全屏**：`setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` 让宠物在切换
  Space、进入全屏应用时仍可见；想让它只留在当前桌面，把 `visibleOnFullScreen` 去掉即可。
- **透明区域也会挡鼠标**：整个 260×260 窗口都会接收点击。若希望透明处「点穿」到下面的窗口，
  需要配合 `win.setIgnoreMouseEvents(true, { forward: true })` 再做区域命中判断（当前未启用）。
- **首次启动**：Electron 会解压二进制，第一次 `npm start` 可能等几秒。

## 指向真实的宠物页

现在指向 `../app/pet.html`。换成别的页面时改 `main.js` 顶部一行即可：

```js
const PET_PAGE = path.join(__dirname, '..', 'app', 'pet.html');
```

页面里的相对资源（`assets/e_happy.png` 等）会按页面所在目录解析，只要资源和 HTML 的相对位置不变就不用改。
另外 `preload.js` 对缺失的表情图做了兜底：`e_happy/e_sad/e_calm.png` 加载失败时改用
`assets/pet-fish.png`，等表情图补齐后这段兜底自动失效。

## 已知限制

- 默认不记住窗口位置（每次启动回到右下角），需要的话可在主进程里读写 `app.getPath('userData')` 下的 JSON。
- 页面内的「端钢盆 / 电饭煲盛饭」按钮在桌宠模式下被隐藏，点击宠物本体仍会随机换表情说话；
  想用完整面板就用 `npm run start:full`。


## 启动方式（macOS，2026-10-19）

三种任选：

1. **双击 App**：`~/Applications/明鉴桌宠.app`（桌面有同名快捷方式）
2. **双击脚本**：桌面 `启动明鉴桌宠.command`
3. **命令行**：`cd desktop && unset ELECTRON_RUN_AS_NODE && npm start`

> 注意：如果环境里设了 `ELECTRON_RUN_AS_NODE=1`，Electron 会退化成 Node 直接跑 main.js，
> 报 `Cannot read properties of undefined (reading 'whenReady')`。启动脚本里已 `unset`。

窗口：260×260 透明、无边框、置顶、可拖动；`npm run start:full` 是 960×760 的完整面板。

## 交互

- 拖动移动；双击隐藏，桌面「叫出大肥鱼」恢复
- **鼠标跟随**：默认开，面板里「🎯 跟随鼠标：开/关」可关（存 localStorage `jp-pet-follow`）
- 默认静音，点「开启声音」才说话
- 换装：面板下拉切换皮肤（Claude 正常/中号/小号、GPT 正常/小号、Gemini、Grok、Kimi、智谱、千问）

## 连接模型（可选）

面板底部选 DeepSeek 或 WorkBuddy，填 Key 后保存（只存本机 localStorage `jp-pet-llm`）。

- DeepSeek：填 `sk-...`，直连 `api.deepseek.com`（`deepseek-chat`）
- WorkBuddy：填 `endpoint|publishableKey`
- 不填则用内置脚本问答


## 双击没反应？排查顺序（2026-10-19）

1. **确认是真实副本不是符号链接**：桌面的 `明鉴桌宠.app` 必须是实体（`ls -ld` 显示 `drwxr`，不是 `lrwxr`）。
   符号链接指向 .app 时 Finder 经常不启动。
2. **看进程**：`ps aux | grep "键政游戏/desktop"`。有进程但没窗口 = 窗口没显示；
   新版已在 `ready-to-show / did-finish-load / 1.2s / 3s` 四重兜底里强制 `showInactive()`，
   并写日志到 `/tmp/pet-window.log`（`shown via ... visible=true` 即成功）。
3. **窗口被隐藏**：鼠标双击桌宠会隐藏；再双击 App（`activate`）或按 `⌘⇧F` 唤回。
4. **退出**：`⌘⌥Q`，或在桌宠上右键 → 退出。
5. 若日志显示 `did-fail-load`，说明页面没加载成功，检查 `app/pet.html` 是否被移动。
