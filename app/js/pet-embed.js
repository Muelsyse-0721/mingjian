/* ============================================================
 * 明鉴 · 大肥鱼桌宠「默认常驻」嵌入器 v2
 *
 * 把 app/pet.html 作为透明 iframe 浮层挂在主站上：
 *   · mini  （默认）：只显示桌宠本体，可拖动 / 双击隐藏
 *   · full        ：展开为完整桌宠页（问答 / 钢盆 / 电饭煲 / 换装）
 *   · hidden      ：收起 iframe，只留左下 🐟 按钮叫回
 *
 * 拖动由 pet.html 通过 postMessage 上报屏幕坐标，本文件只移动 iframe，
 * 不去碰 iframe 内部布局；位置存 localStorage jp-pet-pos-v2。
 * ============================================================ */
(function () {
  'use strict';

  var MODE_KEY = 'jp-pet-embed-mode';
  var POS_KEY = 'jp-pet-pos-v2';
  var HIDDEN_KEY = 'jp-pet-hidden';
  var SKIN_KEY = 'jp-pet-skin';

  var frame = document.getElementById('pet-frame');
  var btn = document.getElementById('pet-toggle');
  var hideBtn = document.getElementById('pet-hide');
  if (!frame || !btn) return;

  var MINI_SIZE = { w: 200, h: 210 };
  var mode = 'mini';        // 'mini' | 'full'
  var hidden = false;
  var currentSrc = '';
  var drag = null;

  function read(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, val); } catch (_) {}
  }

  function storedMode() {
    var v = read(MODE_KEY) || 'mini';
    if (v === 'hidden') { hidden = true; return 'mini'; }
    return v === 'full' ? 'full' : 'mini';
  }

  function skinParam() {
    var s = read(SKIN_KEY) || '';
    return /^skin-[a-z0-9-]+$/.test(s) ? '&skin=' + encodeURIComponent(s) : '';
  }

  function applyMode() {
    if (hidden) {
      frame.style.display = 'none';
      if (hideBtn) hideBtn.style.display = 'none';
      btn.textContent = '🐟';
      btn.title = '叫回大肥鱼桌宠';
      return;
    }

    frame.style.display = '';
    if (hideBtn) hideBtn.style.display = '';

    if (mode === 'full') {
      frame.style.width = 'min(720px, 96vw)';
      frame.style.height = 'min(800px, 96vh)';
      frame.style.left = 'auto';
      frame.style.top = 'auto';
      frame.style.right = '12px';
      frame.style.bottom = '12px';
      btn.textContent = '🐡';
      btn.title = '收起为大肥鱼小窗';
      setSrc('pet.html?full=1' + skinParam());
    } else {
      frame.style.width = MINI_SIZE.w + 'px';
      frame.style.height = MINI_SIZE.h + 'px';
      frame.style.right = 'auto';
      frame.style.bottom = 'auto';
      applyPos();
      btn.textContent = '🐟';
      btn.title = '展开大肥鱼（问答 / 钢盆 / 电饭煲）';
      setSrc('pet.html?mini=1' + skinParam());
    }
  }

  function setSrc(src) {
    if (currentSrc === src) return;
    currentSrc = src;
    frame.src = src;
  }

  /* ---------- 位置 ---------- */
  function readPos() {
    try {
      var p = JSON.parse(read(POS_KEY) || 'null');
      if (p && isFinite(p.left) && isFinite(p.top)) return p;
    } catch (_) {}
    return null;
  }

  function clampPos(left, top) {
    var w = frame.offsetWidth || MINI_SIZE.w;
    var h = frame.offsetHeight || MINI_SIZE.h;
    return {
      left: Math.min(Math.max(0, left), Math.max(0, window.innerWidth - w)),
      top: Math.min(Math.max(0, top), Math.max(0, window.innerHeight - h))
    };
  }

  function applyPos() {
    var p = readPos();
    if (!p) {
      // 没存过位置：留在右下角默认位置
      frame.style.left = 'auto';
      frame.style.top = 'auto';
      frame.style.right = '14px';
      frame.style.bottom = '14px';
      return;
    }
    var c = clampPos(p.left, p.top);
    frame.style.right = 'auto';
    frame.style.bottom = 'auto';
    frame.style.left = c.left + 'px';
    frame.style.top = c.top + 'px';
  }

  function savePos(left, top) {
    write(POS_KEY, JSON.stringify({ left: left, top: top }));
  }

  /* ---------- 拖动（坐标由 iframe 内上报） ---------- */
  /* 鼠标跟随：把归一化光标转发给 iframe 内的桌宠（rAF 节流） */
  var followPending = null;
  document.addEventListener('mousemove', function (ev) {
    if (!frame || frame.style.display === 'none') return;
    followPending = ev;
    if (followPending._raf) return;
    followPending._raf = requestAnimationFrame(function () {
      var e = followPending; followPending = null;
      var r = frame.getBoundingClientRect();
      var nx = (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
      var ny = (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2);
      try {
        frame.contentWindow.postMessage({ source: 'jp-pet-host', type: 'cursor', nx: nx, ny: ny }, '*');
      } catch (_) {}
    });
  }, { passive: true });

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.source !== 'jp-pet') return;

    if (d.type === 'drag') {
      if (hidden || mode !== 'mini') return;
      if (d.phase === 'start') {
        if (!isFinite(d.x) || !isFinite(d.y)) return;
        var r = frame.getBoundingClientRect();
        frame.style.right = 'auto';
        frame.style.bottom = 'auto';
        frame.style.left = r.left + 'px';
        frame.style.top = r.top + 'px';
        drag = { x: d.x, y: d.y, left: r.left, top: r.top };
        return;
      }
      if (!drag) return;
      if (d.phase === 'move') {
        var c = clampPos(drag.left + (d.x - drag.x), drag.top + (d.y - drag.y));
        frame.style.left = c.left + 'px';
        frame.style.top = c.top + 'px';
        return;
      }
      if (d.phase === 'end') {
        savePos(parseFloat(frame.style.left) || 0, parseFloat(frame.style.top) || 0);
        drag = null;
      }
      return;
    }

    if (d.type === 'hide') {
      setHidden(true, true);
    }
  });

  /* ---------- 显示 / 隐藏 ---------- */
  function toast(text) {
    var el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:9002;' +
      'background:rgba(28,36,48,.92);color:#fff;font-size:12px;line-height:1.4;padding:8px 14px;' +
      'border-radius:999px;pointer-events:none;opacity:1;transition:opacity .25s;box-shadow:0 6px 18px rgba(0,0,0,.18);';
    document.body.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; }, 2200);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2600);
  }

  function setHidden(flag, notify) {
    hidden = !!flag;
    write(HIDDEN_KEY, hidden ? '1' : '0');
    if (hidden && notify) toast('大肥鱼躲起来了，点左下角 🐟 叫回');
    applyMode();
  }

  btn.addEventListener('click', function () {
    if (hidden) {
      hidden = false;
      write(HIDDEN_KEY, '0');
      mode = 'mini';
      write(MODE_KEY, mode);
      applyMode();
      return;
    }
    mode = mode === 'mini' ? 'full' : 'mini';
    write(MODE_KEY, mode);
    applyMode();
  });

  if (hideBtn) {
    hideBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setHidden(true, true);
    });
  }

  // 右键浮层按钮 = 直接收起
  btn.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    setHidden(true, true);
  });

  window.addEventListener('resize', function () {
    var p = readPos();
    if (!p || hidden) return;
    var c = clampPos(p.left, p.top);
    frame.style.left = c.left + 'px';
    frame.style.top = c.top + 'px';
  });

  /* ---------- 启动 ---------- */
  mode = storedMode();                       // 兼容旧版 mode='hidden'
  var hv = read(HIDDEN_KEY);
  if (hv === '1') hidden = true;
  else if (hv === '0') hidden = false;       // 没有该键时保留 storedMode 的结论
  applyMode();
})();
