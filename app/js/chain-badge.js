/* ============================================================
 * 链上存证角标：给带 data-qid 的卡片挂一个「⛓ 链上存证 #N」链接
 * 数据来源：/chain-anchors.json（由 tools/anchor-worker.mjs 生成）
 * 设计：拿不到数据 / 未存证 → 什么都不做，不影响页面任何功能
 * ============================================================ */
(function () {
  'use strict';

  var MAP = null;
  var STYLE_ID = 'chain-badge-style';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '.chain-badge{display:inline-flex;align-items:center;gap:4px;margin-top:8px;' +
      'font-size:12px;line-height:1;padding:4px 9px;border-radius:999px;' +
      'background:#eef6ee;color:#166534;border:1px solid #bbd9bb;text-decoration:none}' +
      '.chain-badge:hover{background:#e2f0e2}' +
      '.chain-badge .dot{width:6px;height:6px;border-radius:50%;background:#16a34a}';
    document.head.appendChild(st);
  }

  var API = 'https://jp-ladder.app.workbuddy.host/.cloud/database/rest';
  var KEY = 'wbpk_7bwzvH0HlWEBuvX8C9eOlY_xHSFWuFjacpSFqcnHCge7bIWmWm2a4bK';

  /* 云端优先（锚定后即时可见，无需重新部署）；失败退回静态文件 */
  function load() {
    if (MAP) return Promise.resolve(MAP);
    return fetch(API + '/jp_chain_anchor_items?select=qid,anchor_id&limit=20000', {
      headers: { 'x-wb-webapp-access-key': KEY }
    })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (rows) {
        MAP = {};
        (rows || []).forEach(function (r) { if (r.qid) MAP[r.qid] = { id: r.anchor_id }; });
        return MAP;
      })
      .catch(function () { return loadStatic(); });
  }

  function loadStatic() {
    return fetch('chain-anchors.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        MAP = {};
        ((j && j.anchors) || []).forEach(function (a) {
          var items = a.items || {};
          Object.keys(items).forEach(function (qid) { MAP[qid] = { id: a.id, tx: a.tx }; });
        });
        return MAP;
      })
      .catch(function () { MAP = {}; return MAP; });
  }

  function decorate() {
    var nodes = document.querySelectorAll('[data-qid]');
    if (!nodes.length) return;
    load().then(function (map) {
      injectStyle();
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (!el.querySelector || el.querySelector('.chain-badge')) continue;
        var qid = el.getAttribute('data-qid');
        var hit = qid && map[qid];
        if (!hit) continue;
        var a = document.createElement('a');
        a.className = 'chain-badge';
        a.href = 'chain.html?qid=' + encodeURIComponent(qid);
        a.title = '该题结果已锚定到链上，点击可自行验证';
        a.innerHTML = '<span class="dot"></span>链上存证 #' + hit.id;
        el.appendChild(a);
      }
    });
  }

  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; decorate(); }, 120);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }

  // 大厅每次筛选/轮询都会重绘，重挂角标（已有角标的会跳过）
  if (window.MutationObserver) {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }
})();
