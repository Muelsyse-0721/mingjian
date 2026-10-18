/* ============================================================
 * 明鉴 · 积分商城核心 v1.0（装饰消耗 · 纯函数，无 DOM / 云依赖）
 *
 * 定位：积分只能「换来装饰」，不能反向变现。
 *
 * ★ 红线（绝对、不可协商）★
 *   - 积分是应用内非货币分值：不可充值、不可提现、不可转让、
 *     不可兑换法币/加密货币、不可与货币互转；
 *   - 商城只有单向出口：积分 → 装饰（扣了就销毁，平台不留可退余额）；
 *   - 装饰不可转卖、不可回售、不可换回积分（本模块不提供任何反向函数）；
 *   - 本模块不发起任何网络/数据库调用，只组装行对象。
 *
 * 与其它模块的关系：
 *   - 余额口径完全复用 LoanCore.cashOf（现金 = 开局赠送 + 投注盈亏
 *     + 借款到手 − 还款）。因此「扣积分」必须体现为一条让
 *     cashOf 减少的 jp_bets 台账行，详见 composeSpendRow 注释。
 *   - 订单行落 jp_store_orders（见 app/sql/05-store.sql）；
 *     持有关系落 jp_user_items（见 app/sql/06-store-items.sql）。
 *
 * 加载方式：<script src="js/store.js"> → window.StoreCore
 *           node: require('./store.js') → StoreCore（仅做语法/单测）
 * ============================================================ */
var StoreCore = (function () {
  'use strict';

  /* 订单表的 kind 列：与 05-store.sql 的 'cosmetic' | 'vip' 口径一致。
   * 装饰子类（名讳颜色/头像框/主题/称号）体现在 item.kind 与 item_id 前缀上。 */
  var ORDER_KIND = 'cosmetic';

  var KINDS = {
    NAMECOLOR: 'namecolor',
    FRAME: 'frame',
    THEME: 'theme',
    TITLE: 'title'
  };

  var KIND_LABELS = {
    namecolor: '名讳颜色',
    frame: '头像框',
    theme: '主题',
    title: '称号'
  };

  /* ------------------------------------------------------------
   * 商品目录（全部纯展示，无数值优势、无功能特权）
   * 形状：{ id, name, kind, price, payload, desc }
   *   price  —— 积分单价，正整数；落库时写入 cost_points
   *   payload —— 前端渲染装饰所需的纯视觉参数
   * ------------------------------------------------------------ */
  var COSMETICS = [
    {
      id: 'nc-ink-green', name: '青墨名讳', kind: KINDS.NAMECOLOR, price: 120,
      payload: { type: 'namecolor', color: '#2F5D50', weight: 500 },
      desc: '昵称在榜单与评论区显示为青墨色。'
    },
    {
      id: 'nc-crimson', name: '朱砂名讳', kind: KINDS.NAMECOLOR, price: 260,
      payload: { type: 'namecolor', color: '#A32D2D', weight: 500 },
      desc: '昵称显示为朱砂红，醒目但不刺眼。'
    },
    {
      id: 'nc-gilded', name: '鎏金名讳', kind: KINDS.NAMECOLOR, price: 300,
      payload: { type: 'namecolor', color: '#B8860B', weight: 600 },
      desc: '昵称显示为鎏金色，带轻微描边。'
    },
    {
      id: 'frame-bronze', name: '青铜头像框', kind: KINDS.FRAME, price: 450,
      payload: { type: 'frame', ring: 'single', color: '#CD7F32' },
      desc: '单圈青铜描边头像框。'
    },
    {
      id: 'frame-lacquer', name: '漆红头像框', kind: KINDS.FRAME, price: 680,
      payload: { type: 'frame', ring: 'double', color: '#8C1C13' },
      desc: '双圈漆红描边头像框，厚重一些。'
    },
    {
      id: 'theme-ricepaper', name: '宣纸主题', kind: KINDS.THEME, price: 380,
      payload: { type: 'theme', bg: '#FAF7EF', accent: '#8A7B5C', text: '#2C2C2A' },
      desc: '个人主页换成宣纸底色 + 赭石描边。'
    },
    {
      id: 'theme-midnight', name: '子夜主题', kind: KINDS.THEME, price: 800,
      payload: { type: 'theme', bg: '#1B1E24', accent: '#5B8DB8', text: '#E8E8E4' },
      desc: '深色个人主页皮肤，夜间阅读更省眼。'
    },
    {
      id: 'title-observer', name: '称号「旁观者」', kind: KINDS.TITLE, price: 150,
      payload: { type: 'title', text: '旁观者' },
      desc: '昵称后缀展示「旁观者」，纯文字。'
    },
    {
      id: 'title-verifier', name: '称号「考据癖」', kind: KINDS.TITLE, price: 520,
      payload: { type: 'title', text: '考据癖' },
      desc: '昵称后缀展示「考据癖」，表彰查证癖好。'
    },
    {
      id: 'title-arbiter', name: '称号「定谳者」', kind: KINDS.TITLE, price: 1500,
      payload: { type: 'title', text: '定谳者', color: '#B8860B' },
      desc: '最高档称号，鎏金底色文字，仅展示。'
    }
  ];

  /* ---------- 小工具 ---------- */
  function round2(v) { return Math.round(Number(v) * 100) / 100; }

  function clone(o) {
    var out = {};
    Object.keys(o).forEach(function (k) {
      var v = o[k];
      out[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    });
    return out;
  }

  function numText(v) {
    var n = round2(v);
    return (Math.floor(n) === n) ? String(n) : String(n);
  }

  function genId() {
    var g = (typeof globalThis !== 'undefined') ? globalThis : {};
    if (g.crypto && typeof g.crypto.randomUUID === 'function') {
      return g.crypto.randomUUID();
    }
    /* 退化方案：仅用于老环境/离线演示 */
    return 'ord-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function nowIso(opt) {
    if (opt) return String(opt);
    return new Date().toISOString();
  }

  /* 接受 item 对象或 item id，统一返回目录内的副本 */
  function resolve(item) {
    if (!item) return null;
    var id = (typeof item === 'string') ? item : item.id;
    if (!id) return null;
    for (var i = 0; i < COSMETICS.length; i++) {
      if (COSMETICS[i].id === id) return COSMETICS[i];
    }
    return null;
  }

  function mustItem(item) {
    var it = resolve(item);
    if (!it) throw new Error('StoreCore: 未找到装饰品 ' + (item && item.id ? item.id : item));
    if (!isFinite(Number(it.price)) || Number(it.price) <= 0) {
      throw new Error('StoreCore: 商品价格异常 ' + it.id);
    }
    return it;
  }

  function mustUid(uid) {
    var s = String(uid == null ? '' : uid).trim();
    if (!s) throw new Error('StoreCore: 缺少 uid');
    return s;
  }

  /* ------------------------------------------------------------
   * 目录查询
   * ------------------------------------------------------------ */

  /* 返回目录副本；kind 可选，用于按子类过滤 */
  function listCosmetics(kind) {
    var list = COSMETICS.map(clone);
    if (kind) {
      list = list.filter(function (it) { return it.kind === kind; });
    }
    return list;
  }

  /* 按 id 取单个商品副本；不存在返回 null */
  function getItem(id) {
    var it = resolve(id);
    return it ? clone(it) : null;
  }

  /* ------------------------------------------------------------
   * 可购买判定（纯前端预校验；最终以 DB 唯一约束 + RLS 为准）
   *   balance —— 当前可用积分（= LoanCore.cashOf(...)）
   *   item    —— 商品对象或 id
   *   owned   —— 可选，已持有的 item_id 数组（防重复购买）
   * 返回 { ok, error, price, balanceAfter }
   * ------------------------------------------------------------ */
  function canBuy(balance, item, owned) {
    var out = { ok: false, error: '', price: 0, balanceAfter: 0 };

    var it = resolve(item);
    if (!it) { out.error = '商品不存在或已下架'; return out; }

    var price = Number(it.price);
    if (!isFinite(price) || price <= 0 || Math.floor(price) !== price) {
      out.error = '商品价格异常，暂不可购买';
      return out;
    }
    out.price = price;

    if (balance === null || balance === undefined || balance === '') {
      out.error = '积分余额无效';
      return out;
    }
    var bal = Number(balance);
    if (!isFinite(bal)) { out.error = '积分余额无效'; return out; }

    out.balanceAfter = round2(bal - price);

    if (owned && typeof owned.indexOf === 'function' && owned.indexOf(it.id) >= 0) {
      out.error = '你已拥有「' + it.name + '」，装饰不可重复购买';
      return out;
    }

    if (bal < price) {
      out.error = '积分不足：需要 ' + price + ' 分，当前 ' + numText(bal) + ' 分';
      return out;
    }

    out.ok = true;
    return out;
  }

  /* ------------------------------------------------------------
   * 换装判定（纯前端预校验；最终以 DB 权限/约束为准）
   *
   * 单槽语义：目录里同一 kind 同一时刻只展示一件——
   *   名讳颜色一件、头像框一个、主题一套、称号一个。
   * 换装 = 「同类其它行 equipped=false + 目标行 equipped=true」。
   * 若将来某个 kind 允许多件同时展示，宿主应忽略 equipPlan 返回的
   * unequipItemIds，只把 equipItemId 置 true。
   * ------------------------------------------------------------ */

  /* 归一化持有列表：接受 ['id'] 或 [{ item_id }] / [{ id }]，去空去重 */
  function ownedIdList(owned) {
    var out = [];
    (owned || []).forEach(function (x) {
      var id = (typeof x === 'string') ? x : (x && (x.item_id || x.id));
      if (id && out.indexOf(String(id)) < 0) out.push(String(id));
    });
    return out;
  }

  /* canEquip(ownedIds, itemId) → { ok, error? }
   * 前提：目录里存在该装饰，且用户已拥有它。
   * 不校验「是否已装备」——重复置 true 是幂等的。 */
  function canEquip(ownedIds, itemId) {
    var it = resolve(itemId);
    if (!it) return { ok: false, error: '装饰不存在或已下架' };
    if (ownedIdList(ownedIds).indexOf(it.id) < 0) {
      return { ok: false, error: '你尚未拥有「' + it.name + '」' };
    }
    return { ok: true };
  }

  /* composeEquipPatch(itemId) → { equipped: true }
   * 补丁内容与 itemId 无关：宿主写法为
   *   update({ equipped: true }).eq('item_id', itemId)
   * 保留入参只为调用处可读（一眼看出这次是给哪件换装）。 */
  function composeEquipPatch(itemId) {   /* eslint-disable-line no-unused-vars */
    return { equipped: true };
  }

  /* equipPlan(itemId, ownedIds) → { equipItemId, unequipItemIds }
   * unequipItemIds：已拥有、同类、但不是目标的那几件（需置 false）。
   * 宿主落库顺序建议「先 unequip 再 equip」，避免同类短暂同时为 true。
   * itemId 不在目录内时返回 equipItemId = null，由宿主提示错误。 */
  function equipPlan(itemId, ownedIds) {
    var it = resolve(itemId);
    if (!it) return { equipItemId: null, unequipItemIds: [] };
    var unequip = ownedIdList(ownedIds).filter(function (id) {
      if (id === it.id) return false;
      var other = resolve(id);
      return !!other && other.kind === it.kind;
    });
    return { equipItemId: it.id, unequipItemIds: unequip };
  }

  /* ------------------------------------------------------------
   * 行组装（只产对象，不落库）
   * ------------------------------------------------------------ */

  /* jp_store_orders 行：一次消费的订单留痕（不可改、不可删） */
  function composeOrderRow(uid, item, opts) {
    var it = mustItem(item);
    var o = opts || {};
    return {
      id: o.id ? String(o.id) : genId(),
      uid: mustUid(uid),
      item_id: it.id,
      kind: ORDER_KIND,
      cost_points: Number(it.price),
      created_at: nowIso(o.now)
    };
  }

  /* jp_user_items 行：持有关系（uid + item_id 唯一，不可转移） */
  function composeHoldingRow(uid, item, opts) {
    var it = mustItem(item);
    var o = opts || {};
    return {
      uid: mustUid(uid),
      item_id: it.id,
      acquired_at: nowIso(o.now),
      equipped: !!o.equipped
    };
  }

  /* ------------------------------------------------------------
   * ★ 关键：扣分台账行（jp_bets）
   *
   * 依据 LoanCore.cashOf 的实现：
   *     v = opening_bonus
   *     每行：v -= stake;  if (status === 'won') v += payout;
   * 因此想让现金「减少 price」，只有两条路：
   *   (A) stake = price，且不进入 payout 分支（status !== 'won'）
   *   (B) stake = 0，且 payout = -price（status = 'won'）
   *
   * 选 (B)，理由（A 的问题）：
   *   - (A) 若 kind='spend'/status='lost'：LoanCore.leaderboard 对
   *     kind !== 'bet' 的行只累加 payout/recovered，「staked」一分不加，
   *     → 大厅余额已扣、天梯榜净资产却没扣，两处口径打架。
   *   - (A) 若改用 kind='bet'：会被算进投注笔数/胜率/CSV，污染战绩。
   *   - (B) kind='adjust'、stake=0、status='won'、payout=-price 时：
   *       · cashOf        → 0 + (-price) = -price            ✔ 扣分
   *       · openStakeOf   → status 非 open，不计在押          ✔
   *       · leaderboard   → recovered += -price，betNet 同步下降 ✔ 榜单一致
   *       · 徽章/战绩/CSV → 全部按 kind !== 'bet' 跳过         ✔ 无污染
   *       · netWorth      → 同步下降                           ✔
   *     仅 myLedger 会把它显示为「差额补退 · <qid>」（金额正确、
   *     文案不够贴切）；若要文案更准，需在 loans.js 的 myLedger 增加
   *     kind==='spend' 分支——本次不改共享文件，故沿用 adjust。
   *
   * 前提：jp_bets.payout 列须允许负数（integer/numeric，且无
   *       CHECK payout >= 0）。06-store-items.sql 文末附了核对 SQL。
   * ------------------------------------------------------------ */
  function composeSpendRow(uid, item, opts) {
    var it = mustItem(item);
    var o = opts || {};
    var now = nowIso(o.now);
    return {
      qid: 'store-' + it.id,          /* 台账分组：同一装饰的多次购买同组 */
      uid: mustUid(uid),
      nickname: String(o.nickname || ''),
      outcome_id: 'spend',
      stake: 0,                       /* 不占在押，也不计入投注额 */
      odds_at_bet: 0,
      status: 'won',                  /* 只有 'won' 才会读 payout */
      kind: 'adjust',                  /* 非 'bet'：不进战绩/徽章/CSV */
      payout: -Number(it.price),       /* 负派彩 = 扣减可用积分 */
      placed_at: now,
      settled_at: now
    };
  }

  /* 一次购买所需的三行（订单 + 持有 + 扣分台账），供宿主批量落库 */
  function composePurchase(uid, item, opts) {
    var o = opts || {};
    var order = composeOrderRow(uid, item, o);
    return {
      order: order,
      holding: composeHoldingRow(uid, item, o),
      spend: composeSpendRow(uid, item, {
        nickname: o.nickname,
        now: o.now
      })
    };
  }

  return {
    ORDER_KIND: ORDER_KIND,
    KINDS: KINDS,
    KIND_LABELS: KIND_LABELS,
    COSMETICS: listCosmetics(),   /* 只读副本；请优先用 listCosmetics() */
    listCosmetics: listCosmetics,
    getItem: getItem,
    canBuy: canBuy,
    canEquip: canEquip,
    composeEquipPatch: composeEquipPatch,
    equipPlan: equipPlan,
    composeOrderRow: composeOrderRow,
    composeHoldingRow: composeHoldingRow,
    composeSpendRow: composeSpendRow,
    composePurchase: composePurchase,
    round2: round2
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StoreCore;
}
