/**
 * 明鉴 · 商业化模块（P3，独立功能，零耦合）
 * ============================================================
 * 本文件是「积分商城 / 装饰性内购 / VIP / 赞助位 / 数据报告」的前端模块，
 * 与核心下注、辩论、online.js 完全解耦：
 *   - 不 import / 不依赖 online.js、app.js、auth.js 等任何核心文件；
 *   - 不在本文件内执行任何数据库写入（无 DB exec / 无 cloud.database 调用）；
 *   - 只负责「组装行对象」与「纯前端展示 / 导出」，真正的落库由宿主应用
 *     在拿到本模块返回的 row 后，用 cloud.database.from('jp_store_orders')
 *     自行插入（受 app/sql/05-store.sql 的 RLS 约束：仅本人可写可读）。
 *
 * ★ 红线（绝对、不可协商）★
 *   平台「积分」是应用内非货币分值，永远：
 *     - 不可用法币加值（no real-money top-up）；
 *     - 不可兑回现金 / 不可换为法币或加密货币；
 *     - 不可在用户间让渡；
 *     - 不可与货币互转。
 *   本模块内所有「购买」均以「花费积分」完成，不存在任何真实货币流动。
 *
 * 加载方式（UMD，浏览器与 node 语法检查均兼容）：
 *   <script src="js/monetize.js"></script>  →  window.Monetize
 *   在 node 下：module.exports = Monetize（仅用于 `node -c` 语法校验）
 */
(function (global, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.Monetize = api;
  }
})(this, function () {
  'use strict';

  // ----------------------------------------------------------
  // 商品种类（kind）—— 落入 jp_store_orders.kind 列
  // ----------------------------------------------------------
  var KIND = {
    COSMETIC: 'cosmetic', // 装饰性内购（徽章 / 主题 / 名讳颜色）
    VIP: 'vip'            // VIP 权益解锁（以积分或独立虚拟权益解锁，无真实货币）
  };

  // ----------------------------------------------------------
  // 装饰性内购目录（全部以「积分」计价，绝非法币）
  // 形状将与 jp_store_orders 行结合。preview 仅用于前端展示色块/文字。
  // ----------------------------------------------------------
  var COSMETICS = [
    {
      id: 'badge-jade-debater',
      name: '翡翠辩士徽章',
      kind: KIND.COSMETIC,
      group: 'badge',
      cost_points: 500,
      description: '个人主页与发言处展示的翡翠色徽章，纯装饰。',
      preview: { type: 'badge', color: '#2ecc71', text: '翡翠辩士' }
    },
    {
      id: 'theme-midnight-bronze',
      name: '暗夜青铜主题',
      kind: KIND.COSMETIC,
      group: 'theme',
      cost_points: 800,
      description: '暗色背景 + 青铜描边的个人主页主题皮肤。',
      preview: { type: 'theme', color: '#3a2f1b', accent: '#cd7f32' }
    },
    {
      id: 'namecolor-gilded',
      name: '鎏金名讳颜色',
      kind: KIND.COSMETIC,
      group: 'namecolor',
      cost_points: 300,
      description: '你的昵称在榜单/评论区显示为鎏金色，纯视觉。',
      preview: { type: 'namecolor', color: '#d4af37', text: '你的昵称' }
    },
    {
      id: 'badge-crystal-orator',
      name: '水晶演说家徽章',
      kind: KIND.COSMETIC,
      group: 'badge',
      cost_points: 1200,
      description: '稀有水晶质感徽章，仅展示用。',
      preview: { type: 'badge', color: '#4fc3f7', text: '水晶演说家' }
    }
  ];

  // ----------------------------------------------------------
  // VIP 权益档位（以「积分」或「独立虚拟权益」解锁，无真实货币）
  // perks 为解锁的能力清单，均为应用内功能，绝不涉及付款。
  // ----------------------------------------------------------
  var VIP_TIERS = [
    {
      id: 'vip-monthly',
      name: '月度会员',
      kind: KIND.VIP,
      cost_points: 2000,
      duration_days: 30,
      description: '30 天权益：自定义主页主题、专属徽章位、战报导出无水印。',
      perks: ['theme_custom', 'badge_slot', 'export_premium']
    },
    {
      id: 'vip-quarterly',
      name: '季度会员',
      kind: KIND.VIP,
      cost_points: 5000,
      duration_days: 90,
      description: '90 天权益：含月度全部，外加昵称特殊底色与优先话题推荐。',
      perks: ['theme_custom', 'badge_slot', 'export_premium', 'name_backdrop', 'topic_priority']
    },
    {
      id: 'vip-yearly',
      name: '年度会员',
      kind: KIND.VIP,
      cost_points: 10000,
      duration_days: 365,
      description: '365 天权益：含季度全部，外加专属赛季纪念徽章与数据年报。',
      perks: ['theme_custom', 'badge_slot', 'export_premium', 'name_backdrop', 'topic_priority', 'season_medal', 'annual_report']
    }
  ];

  // ----------------------------------------------------------
  // 内部工具：生成幂等的订单 id
  // ----------------------------------------------------------
  function genId() {
    if (typeof global !== 'undefined' && global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    // 退化方案（不影响功能，仅用于离线/旧环境）
    return 'ord_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  // ----------------------------------------------------------
  // 核心：组装 jp_store_orders 的行对象（不直接落库）
  // 返回形如 { id, uid, item_id, kind, cost_points, created_at } 的对象。
  // 宿主应用应在拿到 row 后自行 insert，并依赖 RLS 校验 uid = auth.uid()。
  // ----------------------------------------------------------
  function composeStoreRow(opts) {
    if (!opts || !opts.uid || !opts.itemId || !opts.kind) {
      throw new Error('composeStoreRow: 缺少必填字段 uid / itemId / kind');
    }
    return {
      id: genId(),
      uid: String(opts.uid),
      item_id: String(opts.itemId),
      kind: String(opts.kind),
      cost_points: Math.max(0, parseInt(opts.costPoints, 10) || 0),
      created_at: nowIso()
    };
  }

  // 按 id 在目录中查找装饰品
  function findCosmetic(id) {
    for (var i = 0; i < COSMETICS.length; i++) {
      if (COSMETICS[i].id === id) return COSMETICS[i];
    }
    return null;
  }

  // 按 id 在目录中查找 VIP 档位
  function findVipTier(id) {
    for (var i = 0; i < VIP_TIERS.length; i++) {
      if (VIP_TIERS[i].id === id) return VIP_TIERS[i];
    }
    return null;
  }

  // ----------------------------------------------------------
  // 对外 API：装饰品
  // ----------------------------------------------------------
  function listCosmetics() {
    // 返回目录副本，避免外部篡改
    return COSMETICS.map(function (c) { return Object.assign({}, c); });
  }

  /**
   * 购买装饰品：组装一行 jp_store_orders（kind='cosmetic'）。
   * @param {string} uid  当前用户 uid（必须等于 auth.uid()，由落库时 RLS 保证）
   * @param {string} id   装饰品 id
   * @returns 组装好的行对象（宿主应用负责实际 insert 并扣减积分）
   */
  function buyCosmetic(uid, id) {
    var item = findCosmetic(id);
    if (!item) throw new Error('buyCosmetic: 未找到装饰品 id=' + id);
    return composeStoreRow({
      uid: uid,
      itemId: item.id,
      kind: KIND.COSMETIC,
      costPoints: item.cost_points
    });
  }

  // ----------------------------------------------------------
  // 对外 API：VIP
  // ----------------------------------------------------------
  function listVipTiers() {
    return VIP_TIERS.map(function (t) { return Object.assign({}, t); });
  }

  /**
   * 购买 VIP 档位：组装一行 jp_store_orders（kind='vip'）。
   * 注意：本函数仅用「积分」或「独立虚拟权益」计价，绝不涉及任何真实货币。
   * @param {string} uid   当前用户 uid
   * @param {string} tierId VIP 档位 id
   */
  function buyVip(uid, tierId) {
    var tier = findVipTier(tierId);
    if (!tier) throw new Error('buyVip: 未找到 VIP 档位 id=' + tierId);
    return composeStoreRow({
      uid: uid,
      itemId: tier.id,
      kind: KIND.VIP,
      costPoints: tier.cost_points
    });
  }

  // ==========================================================
  // 赞助 / 赞助话题位：DISPLAY-ONLY 组件（占位数据，无真实广告网络调用）
  // ==========================================================
  // 返回一段纯展示用的「赞助话题横幅」数据。组件只渲染，不发任何网络请求、
  // 不加载第三方脚本、不传递用户标识（无 PII、无追踪）。
  function getSponsorBanner(override) {
    var placeholder = {
      sponsor: '示例赞助商',
      topic: '示例话题：城市公共预算透明化讨论',
      tagline: '本话题由赞助商支持呈现（占位展示，非真实广告）',
      cta: '了解详情（占位）',
      disclosed: true // 始终标注为赞助内容，符合透明披露
    };
    if (override && typeof override === 'object') {
      return Object.assign({}, placeholder, override);
    }
    return placeholder;
  }

  // 纯前端渲染赞助横幅到 container（仅 DOM 操作，无网络）
  function renderSponsorBanner(container, data) {
    if (typeof document === 'undefined' || !container) return null;
    var d = data || getSponsorBanner();
    var el = document.createElement('aside');
    el.className = 'sponsor-banner';
    el.setAttribute('data-sponsored', 'true');
    el.innerHTML =
      '<span class="sponsor-flag">赞助内容 · 占位</span>' +
      '<div class="sponsor-body">' +
        '<div class="sponsor-topic"></div>' +
        '<div class="sponsor-tagline"></div>' +
      '</div>' +
      '<button class="sponsor-cta" type="button" disabled>' + escapeHtml(d.cta) + '</button>';
    el.querySelector('.sponsor-topic').textContent = d.topic;
    el.querySelector('.sponsor-tagline').textContent = d.tagline;
    el.querySelector('.sponsor-flag').textContent = '赞助内容 · ' + (d.sponsor || '占位');
    container.appendChild(el);
    return el;
  }

  // ==========================================================
  // 知识付费墙（占位展示）—— DISPLAY-ONLY
  // ==========================================================
  // 注意：本处为「知识付费墙」概念的中文占位展示组件，仅渲染一个锁定预览，
  // 不实现任何解锁交易（解锁仍用「积分」或「独立虚拟权益」，无真实货币）。
  // 真实货币付费不在本模块范围内（见下方 OUT_OF_SCOPE）。
  function getKnowledgeGatePlaceholder() {
    return {
      title: '深度研报 · 占位展示',
      blurb: '这是知识付费墙（占位）的展示卡片：展示锁定预览与解锁说明，不接任何付款。',
      locked: true,
      unlockHint: '可用「知识积分」或 VIP 权益解锁（占位，无真实货币）。',
      previewLines: [
        '· 第一章：公共讨论的质量衡量（节选）…',
        '· 第二章：预测市场的赔率机制（节选）…'
      ]
    };
  }

  function renderKnowledgeGate(container, data) {
    if (typeof document === 'undefined' || !container) return null;
    var d = data || getKnowledgeGatePlaceholder();
    var el = document.createElement('section');
    el.className = 'knowledge-gate';
    var lines = (d.previewLines || []).map(function (l) {
      return '<li>' + escapeHtml(l) + '</li>';
    }).join('');
    el.innerHTML =
      '<div class="kg-title"></div>' +
      '<p class="kg-blurb"></p>' +
      '<ul class="kg-preview">' + lines + '</ul>' +
      '<div class="kg-hint"></div>' +
      '<button class="kg-btn" type="button" disabled>解锁（占位 · 无真实货币）</button>';
    el.querySelector('.kg-title').textContent = d.title;
    el.querySelector('.kg-blurb').textContent = d.blurb;
    el.querySelector('.kg-hint').textContent = d.unlockHint;
    container.appendChild(el);
    return el;
  }

  // ==========================================================
  // 匿名化聚合数据报告（无 PII）—— 读取聚合统计并导出可下载/文本报告
  // ==========================================================
  // stats 必须由宿主传入，且只能是「聚合指标」（计数、均值、分布），
  // 绝不能包含 uid、昵称、IP、设备号等任何个人可识别信息。
  // 本函数不联网、不落库，只做格式化与（可选）下载。
  function buildAggregatedReport(stats) {
    stats = stats && typeof stats === 'object' ? stats : {};
    var lines = [];
    lines.push('明鉴 · 匿名化聚合数据报告');
    lines.push('生成时间(UTC): ' + nowIso());
    lines.push('说明: 本报告仅含聚合统计，不含任何个人可识别信息(PII)。');
    lines.push('----------------------------------------');
    lines.push('参与用户数(聚合): ' + num(stats.totalUsers));
    lines.push('进行中话题数: ' + num(stats.activeTopics));
    lines.push('已揭晓话题数: ' + num(stats.resolvedTopics));
    lines.push('总下注笔数(聚合): ' + num(stats.totalBets));
    lines.push('平均单笔注额(积分,聚合): ' + num(stats.avgBetPoints));
    lines.push('活跃辩论房数: ' + num(stats.activeDebates));
    lines.push('社区仲裁发起数(聚合): ' + num(stats.totalArbitrations));
    lines.push('----------------------------------------');
    lines.push('话题分类分布(聚合):');
    var dist = stats.topicCategoryDist;
    if (dist && typeof dist === 'object') {
      Object.keys(dist).forEach(function (k) {
        lines.push('  - ' + k + ': ' + num(dist[k]));
      });
    } else {
      lines.push('  (无)');
    }
    lines.push('----------------------------------------');
    lines.push('END · 匿名聚合，无 PII');
    return lines.join('\n');
  }

  // 触发浏览器下载（纯前端 Blob，无网络）
  function downloadReport(filename, content, mime) {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') return false;
    var blob = new Blob([content || ''], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'mingjian-aggregated-report.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    return true;
  }

  // ==========================================================
  // 小工具
  // ==========================================================
  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ==========================================================
  // 机构付费发起话题 —— OUT_OF_SCOPE（标记为待办，不实现）
  // ----------------------------------------------------------
  // TODO(OUT_OF_SCOPE): 机构付费发起/置顶话题。该能力在本质层面需要
  //   真实货币收款（real-money payment processing），与平台红线冲突，
  //   因此本模块不实现任何付款流程。应作为独立合规项另行评估：
  //   若确需开通，须走真实收款通道（如外部收款单），并在「平台外」完成，
  //   绝不在本前端做 充值 / 提现 / 转账 / 兑换 / recharge / withdraw / transfer。
  //   此处仅保留占位说明，不提供任何可调用函数。
  // ==========================================================

  // ----------------------------------------------------------
  // 暴露的 API
  // ----------------------------------------------------------
  return {
    KIND: KIND,
    listCosmetics: listCosmetics,
    buyCosmetic: buyCosmetic,
    listVipTiers: listVipTiers,
    buyVip: buyVip,
    composeStoreRow: composeStoreRow,
    // 赞助位（展示占位）
    getSponsorBanner: getSponsorBanner,
    renderSponsorBanner: renderSponsorBanner,
    // 知识付费墙（展示占位）
    getKnowledgeGatePlaceholder: getKnowledgeGatePlaceholder,
    renderKnowledgeGate: renderKnowledgeGate,
    // 匿名聚合报告
    buildAggregatedReport: buildAggregatedReport,
    downloadReport: downloadReport
  };
});
