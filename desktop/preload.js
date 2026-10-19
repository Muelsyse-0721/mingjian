'use strict';

/**
 * 桌宠窗口的 preload（contextIsolation: true，页面仍得不到 Node 能力）
 *
 * 只做两件事：
 * 1) 让「拖动宠物」变成「拖动整个窗口」——页面里的拖拽只会移动 #pet 元素，
 *    在 260x260 的小窗里没有意义，所以这里把指针的屏幕坐标转成窗口位置。
 * 2) 兜底：pet.html 里引用的 assets/e_happy|e_sad|e_calm.png 若缺失，
 *    用 assets/pet-fish.png 顶上，避免宠物变成空白框（源文件不改）。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopPet', {
  toggle: () => ipcRenderer.send('pet:toggle'),
  quit: () => ipcRenderer.send('pet:quit'),
  onApplySkin: (cb) => ipcRenderer.on('pet:apply-skin', (_e, id) => cb(id)),
  onSetFollow: (cb) => ipcRenderer.on('pet:set-follow', (_e, on) => cb(on)),
});

window.addEventListener('DOMContentLoaded', () => {
  bindWindowDrag();
  bindFaceFallback();
});

function bindWindowDrag() {
  const pet = document.getElementById('pet');
  if (!pet) return;

  let offset = null; // 指针与窗口左上角的差值，拖动期间保持不变

  pet.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest('#pet-close')) return;
    const bounds = ipcRenderer.sendSync('pet:get-bounds');
    if (!bounds) return;
    offset = { x: e.screenX - bounds.x, y: e.screenY - bounds.y };
  });

  // 用捕获阶段监听 window：页面自身对 #pet 调用了 setPointerCapture，事件仍会冒泡上来
  window.addEventListener(
    'pointermove',
    (e) => {
      if (!offset) return;
      ipcRenderer.send('pet:drag-move', {
        x: e.screenX - offset.x,
        y: e.screenY - offset.y,
      });
    },
    true
  );

  const end = () => {
    offset = null;
  };
  window.addEventListener('pointerup', end, true);
  window.addEventListener('pointercancel', end, true);
  window.addEventListener('blur', end);
}

function bindFaceFallback() {
  document.querySelectorAll('.face').forEach((img) => {
    const swap = () => {
      if (img.dataset.fallbackApplied) return;
      img.dataset.fallbackApplied = '1';
      img.src = 'assets/pet-fish.png'; // 相对 app/pet.html 解析
    };
    img.addEventListener('error', swap);
    if (img.complete && img.naturalWidth === 0) swap();
  });
}
