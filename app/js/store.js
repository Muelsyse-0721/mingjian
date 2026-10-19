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
    TITLE: 'title',
    PETSKIN: 'pet-skin'
  };

  var KIND_LABELS = {
    namecolor: '名讳颜色',
    frame: '头像框',
    theme: '主题',
    title: '称号',
    'pet-skin': '桌宠皮肤'
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

  /* ------------------------------------------------------------
   * 桌宠皮肤目录（本任务新增，2026-10）
   *
   * 9 款桌宠皮肤：Claude / GPT 各有「正常号」「小号」两种体量，
   * 其余 Gemini / Grok / Kimi / 智谱 / 千问 各一款。
   *
   * 形状：{ id, kind, name, character, variant, price, desc, asset }
   *   character —— 角色标识（用于分组展示，非商标授权声明）
   *   variant   —— 'normal' | 'mini'（正常号 / 小号）
   *   asset     —— 前端资源相对路径（相对 app/ 根目录）
   *
   * 与旧装饰一样：纯展示，不带来任何数值或功能优势；价格只在
   * canBuy / composeOrderRow 里作为「积分单价」使用。
   * ------------------------------------------------------------ */
  var PET_SKINS = deepFreeze([
    {
      id: 'skin-claude-normal', kind: KINDS.PETSKIN, name: 'Claude 桌宠 · 正常号',
      character: 'Claude', variant: 'normal', price: 800,
      desc: '橘发橙花、奶油白蕾丝长裙的管家系少女，正常号体型。纯展示，不影响任何 AI 次数或额度。',
      asset: 'assets/pet/skin-claude-normal.png'
    },
    {
      id: 'skin-claude-mini', kind: KINDS.PETSKIN, name: 'Claude 桌宠 · 小号',
      character: 'Claude', variant: 'mini', price: 500,
      desc: '同款橘发少女的 Q 版小号（大头小身），占地更小。纯展示，不影响任何 AI 次数或额度。',
      asset: 'assets/pet/skin-claude-mini.png'
    },
    {
      id: 'skin-gpt-normal', kind: KINDS.PETSKIN, name: 'GPT 桌宠 · 正常号',
      character: 'GPT', variant: 'normal', price: 800,
      desc: '银白长发、白蓝羽翼天使命裙，正常号体型。纯展示，不影响任何 AI 次数或额度。',
      asset: 'assets/pet/skin-gpt-normal.png'
    },
    {
      id: 'skin-gpt-mini', kind: KINDS.PETSKIN, name: 'GPT 桌宠 · 小号',
      character: 'GPT', variant: 'mini', price: 500,
      desc: '同款银白天使的 Q 版小号（两头身），占地更小。纯展示，不影响任何 AI 次数或额度。',
      asset: 'assets/pet/skin-gpt-mini.png'
    },
    {
      id: 'skin-gemini', kind: KINDS.PETSKIN, name: 'Gemini 桌宠',
      character: 'Gemini', variant: 'normal', price: 600,
      desc: '蓝紫渐变双马尾、星月几何装饰，单款体型。纯展示，不影响任何 AI 次数或额度。',
      asset: 'assets/pet/skin-gemini.png'
    },
    {
      id: 'skin-grok', kind: KINDS.PETSKIN, name: 'Grok 桌宠',
      character: 'Grok', variant: 'normal', price: 600,
      desc: '黑皮衣红瞳、短发的叛逆系少女，单款体型。纯展示，不影响任何 AI 次数或额度。',
      asset: 'assets/pet/skin-grok.png'
    },
    {
      id: 'skin-kimi', kind: KINDS.PETSKIN, name: 'Kimi 桌宠',
      character: 'Kimi', variant: 'normal', price: 600,
      desc: '深蓝长发、月牙发饰与海军蓝女仆裙，单款体型。纯展示，不影响任何 AI 次数或额度。',
      asset: 'assets/pet/skin-kimi.png'
    },
    {
      id: 'skin-glm', kind: KINDS.PETSKIN, name: '智谱桌宠',
      character: '智谱', variant: 'normal', price: 600,
      desc: '青绿长辫、书卷气的翡翠色长裙，单款体型。纯展示，不影响任何 AI 次数或额度。',
      asset: 'assets/pet/skin-glm.png'
    },
    {
      id: 'skin-qwen', kind: KINDS.PETSKIN, name: '千问桌宠',
      character: '千问', variant: 'normal', price: 600,
      desc: '紫粉渐变长发、几何纹样礼服，单款体型。纯展示，不影响任何 AI 次数或额度。',
      asset: 'assets/pet/skin-qwen.png'
    }
  ]);

  /* 目录 = 旧装饰 + 桌宠皮肤（同一 kind 共用单槽换装规则） */
  var CATALOG = Object.freeze(COSMETICS.concat(PET_SKINS));

  /* ------------------------------------------------------------
   * VIP 权益说明书（给商城 UI 直接渲染）
   *
   * ★ 数字来源（app/js/vip.js，2026-10-19 核对）★
   *   TIERS.vip1 —— 第 32–44 行：price_points 2000、days 30、
   *                  fee_discount 0.20、loan_limit_bonus 300、
   *                  max_open_questions 5
   *   TIERS.vip2 —— 第 45–57 行：price_points 5000、days 90、
   *                  fee_discount 0.40、loan_limit_bonus 800、
   *                  max_open_questions 10
   *   BASE.max_open_questions = 3 —— 第 71–74 行
   *   effectiveFee / feeRebateOf / loanLimit / maxQuestions —— 第 134–169 行
   *   DEFAULT_SETTINGS.default_fee = 0.05、credit_max = 8000
   *                  —— app/js/online.js 第 20、27 行
   *
   * ★ 只列真正生效的权益 ★
   *   TIERS 里还有 arbitration_priority / analytics_plus 两个参数，
   *   但当前版本没有任何界面或流程读取它们（online.js 未接线），
   *   因此不列为已生效权益，只在 VIP_TIER_CARDS.notes 里说明。
   * ------------------------------------------------------------ */
  var VIP_BENEFITS = deepFreeze([
    {
      tier: 'vip1',
      name: '明鉴月卡',
      items: [
        { key: 'fee_discount', label: '抽水返利', value: '15%',
          desc: '本人中奖结算时，按「中奖本金 × 基础抽水 × 15%」返还积分（VipCore.feeRebateOf）。' },
        { key: 'fee_effective', label: '实际抽水率', value: '4.25%',
          desc: '默认抽水 5% 时，本人实际只承担 4.25%（VipCore.effectiveFee）；返利只惠及本人。' },
        { key: 'loan_limit_bonus', label: '借款额度加成', value: '+2000 分',
          desc: '信用额度上限在基础值上再加 2000 分（默认 30000 → 32000，VipCore.loanLimit）。' },
        { key: 'max_open_questions', label: '同时建题上限', value: '5 题',
          desc: '同时进行中的建题上限由 3 题提升到 5 题（VipCore.maxQuestions）。' }
      ]
    },
    {
      tier: 'vip2',
      name: '明鉴季卡',
      items: [
        { key: 'fee_discount', label: '抽水返利', value: '30%',
          desc: '本人中奖结算时，按「中奖本金 × 基础抽水 × 30%」返还积分（VipCore.feeRebateOf）。' },
        { key: 'fee_effective', label: '实际抽水率', value: '3.5%',
          desc: '默认抽水 5% 时，本人实际只承担 3.5%（VipCore.effectiveFee）；返利只惠及本人。' },
        { key: 'loan_limit_bonus', label: '借款额度加成', value: '+6000 分',
          desc: '信用额度上限在基础值上再加 6000 分（默认 30000 → 36000，VipCore.loanLimit）。' },
        { key: 'max_open_questions', label: '同时建题上限', value: '8 题',
          desc: '同时进行中的建题上限由 3 题提升到 8 题（VipCore.maxQuestions）。' }
      ]
    },
    {
      tier: 'vip3',
      name: '明鉴年卡',
      items: [
        { key: 'fee_discount', label: '抽水返利', value: '45%',
          desc: '本人中奖结算时，按「中奖本金 × 基础抽水 × 45%」返还积分（VipCore.feeRebateOf）。' },
        { key: 'fee_effective', label: '实际抽水率', value: '2.75%',
          desc: '默认抽水 5% 时，本人实际只承担 2.75%（VipCore.effectiveFee）；返利只惠及本人。' },
        { key: 'loan_limit_bonus', label: '借款额度加成', value: '+20000 分',
          desc: '信用额度上限在基础值上再加 20000 分（默认 30000 → 50000，VipCore.loanLimit）。' },
        { key: 'max_open_questions', label: '同时建题上限', value: '15 题',
          desc: '同时进行中的建题上限由 3 题提升到 15 题（VipCore.maxQuestions）。' }
      ]
    }
  ]);

  /* 商城卡片：{ tier, name, price, days, highlights, notes } */
  var VIP_TIER_CARDS = deepFreeze([
    {
      tier: 'vip1', name: '明鉴月卡', price: 1000, days: 30,
      highlights: [
        '中奖抽水返利 15%（默认 5% → 实付 4.25%）',
        '借款额度上限 +2000 分（30000 → 32000）',
        '同时建题上限 3 → 5 题',
        '30 天有效期，到期自动失效、不自动扣费'
      ],
      notes: [
        '只影响本人：不改变全池赔率，不改变其他玩家派彩，也不改变公共奖池分配比例。',
        '积分购买，不可充值 / 提现 / 转让 / 兑换真实货币。',
        '续费时从当前到期时间顺延；已过期则从购买时刻重新起算。'
      ]
    },
    {
      tier: 'vip2', name: '明鉴季卡', price: 2600, days: 90,
      highlights: [
        '中奖抽水返利 30%（默认 5% → 实付 3.5%）',
        '借款额度上限 +6000 分（30000 → 36000）',
        '同时建题上限 3 → 8 题',
        '90 天有效期，折合单日 28.9 分，比月卡省 400 分'
      ],
      notes: [
        '只影响本人：不改变全池赔率，不改变其他玩家派彩，也不改变公共奖池分配比例。',
        '积分购买，不可充值 / 提现 / 转让 / 兑换真实货币。',
        '「仲裁优先」「高级看板」两个参数已在 VipCore 预留（arbitration_priority / analytics_plus），当前版本尚未接入界面，不构成已生效权益。'
      ]
    },
    {
      tier: 'vip3', name: '明鉴年卡', price: 8800, days: 365,
      highlights: [
        '中奖抽水返利 45%（默认 5% → 实付 2.75%）',
        '借款额度上限 +20000 分（30000 → 50000）',
        '同时建题上限 3 → 15 题',
        '365 天有效期，折合单日 24.1 分，比按月买省 3200 分'
      ],
      notes: [
        '只影响本人：不改变全池赔率，不改变其他玩家派彩，也不改变公共奖池分配比例。',
        '积分购买，不可充值 / 提现 / 转让 / 兑换真实货币。',
        '年卡适合长期开题/做市的站长型玩家，普通围观用户买月卡即可。'
      ]
    }
  ]);

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

  /* 新数据一律深冻结：防止 UI 层误改价格 / 权益数字 */
  function deepFreeze(o) {
    if (!o || typeof o !== 'object' || Object.isFrozen(o)) return o;
    Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    return Object.freeze(o);
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
    for (var i = 0; i < CATALOG.length; i++) {
      if (CATALOG[i].id === id) return CATALOG[i];
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

  /* 返回目录副本（旧装饰 + 桌宠皮肤）；kind 可选，用于按子类过滤 */
  function listCosmetics(kind) {
    var list = CATALOG.map(clone);
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

  /* 桌宠皮肤目录副本；可按 character 过滤（如 'Claude'） */
  function listPetSkins(character) {
    var list = PET_SKINS.map(clone);
    if (character) {
      list = list.filter(function (it) { return it.character === character; });
    }
    return list;
  }

  /* 按 id 取桌宠皮肤副本；不是皮肤则返回 null */
  function getSkin(id) {
    var it = resolve(id);
    return (it && it.kind === KINDS.PETSKIN) ? clone(it) : null;
  }

  /* 某档 VIP 的权益条目副本；未知档位返回 [] */
  function vipBenefitsOf(tier) {
    for (var i = 0; i < VIP_BENEFITS.length; i++) {
      if (VIP_BENEFITS[i].tier === tier) {
        return VIP_BENEFITS[i].items.map(clone);
      }
    }
    return [];
  }

  /* 某档 VIP 的商城卡片副本；未知档位返回 null */
  function vipCardOf(tier) {
    for (var i = 0; i < VIP_TIER_CARDS.length; i++) {
      if (VIP_TIER_CARDS[i].tier === tier) return clone(VIP_TIER_CARDS[i]);
    }
    return null;
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
   *   名讳颜色一件、头像框一个、主题一套、称号一个、桌宠皮肤一款。
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
   * 桌宠皮肤换装补丁
   *
   * composeSkinPatch(uid, skinId, isEquipped) →
   *   { uid, item_id, patch, preUnequipAll }
   *
   * 规则与 equipPlan 一致：同一时刻只装备一件（「先卸后装」）。
   *   - patch 只含 equipped 一列 → 恰好命中 09-equip.sql 的
   *     GRANT UPDATE (equipped)，不会尝试改 item_id / uid。
   *   - preUnequipAll = true 表示装备前宿主须先执行
   *     update({ equipped: false }).eq('uid', uid).eq('equipped', true)；
   *     卸下（isEquipped=false）时无需预清空。
   * ------------------------------------------------------------ */
  function mustSkin(skinId) {
    var it = resolve(skinId);
    if (!it || it.kind !== KINDS.PETSKIN) {
      throw new Error('StoreCore: 未找到桌宠皮肤 ' + (skinId && skinId.id ? skinId.id : skinId));
    }
    return it;
  }

  function composeSkinPatch(uid, skinId, isEquipped) {
    var it = mustSkin(skinId);
    var eq = !!isEquipped;
    return {
      uid: mustUid(uid),
      item_id: it.id,
      patch: { equipped: eq },
      preUnequipAll: eq
    };
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
    PET_SKINS: deepFreeze(PET_SKINS.map(clone)),
    VIP_BENEFITS: deepFreeze(VIP_BENEFITS.map(clone)),
    VIP_TIER_CARDS: deepFreeze(VIP_TIER_CARDS.map(clone)),
    listCosmetics: listCosmetics,
    listPetSkins: listPetSkins,
    getItem: getItem,
    getSkin: getSkin,
    vipBenefitsOf: vipBenefitsOf,
    vipCardOf: vipCardOf,
    canBuy: canBuy,
    canEquip: canEquip,
    composeEquipPatch: composeEquipPatch,
    composeSkinPatch: composeSkinPatch,
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
