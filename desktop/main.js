'use strict';

/**
 * 大肥鱼桌宠 · Electron 主进程
 *
 * 目标窗口形态：透明 / 无边框 / 置顶 / 跨桌面 / 可拖动的小窗，加载 app/pet.html。
 * 不修改 app/ 下的任何文件，桌宠化所需的视觉与拖动能力都在这一层补齐。
 */

const path = require('node:path');
const { app, BrowserWindow, Menu, globalShortcut, ipcMain, screen } = require('electron');

// 真实的宠物页：../app/pet.html（相对 pet.html 的资源 assets/*.png 会正常解析）
const PET_PAGE = path.join(__dirname, '..', 'app', 'pet.html');

// 默认「桌宠模式」：透明背景，只留宠物本体；--full / PET_FULL_UI=1 时按普通网页展示
const FULL_UI = process.argv.includes('--full') || process.env.PET_FULL_UI === '1';

const COMPACT_SIZE = { width: 260, height: 260 };
const FULL_SIZE = { width: 960, height: 760 };

const TOGGLE_ACCELERATOR = 'CommandOrControl+Shift+F';
const QUIT_ACCELERATOR = 'CommandOrControl+Alt+Q';

let win = null;
let compactCssKey = null;

/**
 * 桌宠模式下注入的样式（不改源文件，只在渲染时生效）：
 * - html/body 透明，窗口透明才有意义
 * - 隐藏讲解卡片、问答面板、关闭/还原按钮（无边框窗口不需要它们）
 * - 宠物固定在本窗口左下角，整窗拖动由 preload.js 驱动
 */
const COMPACT_CSS = `
  html, body { background: transparent !important; }
  body { overflow: hidden !important; margin: 0; }
  .demo, #qa, #pet-close, #pet-restore, #skin-pick { display: none !important; }
  /* 抠图后的角色直接浮在桌面上：去掉白卡片边框与阴影（双保险） */
  .sticker { background: transparent !important; border: 0 !important; box-shadow: none !important; }
  #pet { left: 38px !important; top: 70px !important; width: 185px !important; height: 185px !important; }
  .stage { width: 185px !important; height: 185px !important; }
`;

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const size = FULL_UI ? FULL_SIZE : COMPACT_SIZE;

  win = new BrowserWindow({
    ...size,
    x: Math.round(workArea.x + workArea.width - size.width - 32),
    y: Math.round(workArea.y + workArea.height - size.height - 32),
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: FULL_UI,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // macOS：'screen-saver' 层级可压在普通窗口之上；visibleOnFullScreen 让全屏应用上也可见
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.loadFile(PET_PAGE);

  win.once('ready-to-show', () => {
    win.showInactive(); // 不抢当前应用焦点
  });

  win.webContents.on('did-finish-load', async () => {
    if (compactCssKey) {
      await win.webContents.removeInsertedCSS(compactCssKey).catch(() => {});
      compactCssKey = null;
    }
    if (!FULL_UI) {
      compactCssKey = await win.webContents.insertCSS(COMPACT_CSS);
    }
  });

  // 无边框窗口没有关闭按钮，右键菜单兜底
  win.webContents.on('context-menu', () => {
    Menu.buildFromTemplate([
      { label: '显示 / 隐藏', accelerator: TOGGLE_ACCELERATOR, click: toggleWindow },
      { type: 'separator' },
      { label: '退出大肥鱼', accelerator: QUIT_ACCELERATOR, click: () => app.quit() },
    ]).popup({ window: win });
  });

  win.on('closed', () => {
    win = null;
    compactCssKey = null;
  });
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    win.showInactive();
  }
}

function registerIpc() {
  // preload 同步取窗口位置，用于计算「抓住宠物」时的相对偏移
  ipcMain.on('pet:get-bounds', (event) => {
    event.returnValue = win && !win.isDestroyed() ? win.getBounds() : null;
  });

  // 拖动：把宠物窗口整体移动到指针位置（减去抓取偏移）
  ipcMain.on('pet:drag-move', (_event, pos) => {
    if (!win || win.isDestroyed() || !pos) return;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
    win.setPosition(Math.round(pos.x), Math.round(pos.y));
  });

  ipcMain.on('pet:toggle', toggleWindow);
  ipcMain.on('pet:quit', () => app.quit());
}

function registerShortcuts() {
  // 至少保证有一个退出热键，否则无边框窗口关不掉
  globalShortcut.register(QUIT_ACCELERATOR, () => app.quit());
  globalShortcut.register(TOGGLE_ACCELERATOR, toggleWindow);
}

app.whenReady().then(() => {
  // 桌宠不需要 Dock 图标和菜单栏，隐藏后应用变成 accessory
  if (app.dock) app.dock.hide();

  registerIpc();
  registerShortcuts();
  createWindow();
});

// 窗口关了就直接退出（本应用只有一个窗口，且没有 Dock 图标可点回来）
app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
