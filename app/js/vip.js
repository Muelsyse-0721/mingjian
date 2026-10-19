/* ============================================================
 * 明鉴 · VIP 特权核心 v1.0（纯函数，无 DOM / 无云依赖）
 *
 * ★ 红线（绝对、不可协商）★
 *   1. 积分是应用内非货币分值：VIP 只能用「积分」购买时长，
 *      不可充值、不可提现、不可转让、不可兑换真实货币。
 *   2. 特权只影响「本人」的体验与效率，绝不影响赔率公平性，
 *      绝不改变任何其他玩家的收益。
 *      → 抽水折扣不在共享彩池赔率里做手脚（q.fee 是全池共享的），
 *        而是在本人中奖结算时以「返利」形式退给本人（见 feeRebateOf），
 *        返利来自平台抽水减少的那部分，其他玩家的派彩公式完全不变。
 *
 * 规则：
 * - 两档：vip1（月）/ vip2（季），到期自动失效
 * - 特权：抽水减免、信用额度加成、同时建题数上限、仲裁优先、高级看板
 * - 特权动态生效：借款 / 建题 / 结算时读取当前 vip 行即时计算
 * - 到期判定：expires_at 必须严格晚于 now 才算有效
 *
 * 加载方式：<script src="js/vip.js"></script> → window.VipCore
 *           node 下 module.exports = VipCore（仅用于语法/单测校验）
 * ============================================================ */
var VipCore = (function () {
  'use strict';

  /* ---------- 档位表 ----------
   * fee_discount       抽水减免比例（0.20 = 抽水打 8 折；0.05→0.04）
   * loan_limit_bonus   信用额度加成（分），加在 LoanCore 额度之上
   * max_open_questions 同时可进行的建题数上限（绝对值，取其与基础值的较大者）
   * arbitration_priority 仲裁受理优先级（0 = 普通，数值越大越优先展示）
   * analytics_plus     高级看板 / 历史复盘 */
  var TIERS = {
    vip1: {
      id: 'vip1',
      name: '明鉴月卡',
      price_points: 1000,
      days: 30,
      perks: {
        fee_discount: 0.15,
        loan_limit_bonus: 2000,
        max_open_questions: 5,
        arbitration_priority: 1,
        analytics_plus: false
      }
    },
    vip2: {
      id: 'vip2',
      name: '明鉴季卡',
      price_points: 2600,
      days: 90,
      perks: {
        fee_discount: 0.30,
        loan_limit_bonus: 6000,
        max_open_questions: 8,
        arbitration_priority: 2,
        analytics_plus: true
      }
    },
    vip3: {
      id: 'vip3',
      name: '明鉴年卡',
      price_points: 8800,
      days: 365,
      perks: {
        fee_discount: 0.45,
        loan_limit_bonus: 20000,
        max_open_questions: 15,
        arbitration_priority: 3,
        analytics_plus: true
      }
    }
  };

  var TIER_IDS = ['vip1', 'vip2', 'vip3'];

  /* 非 VIP 的等价特权（全为零值），保证调用方无需判空 */
  var NEUTRAL_PERKS = {
    fee_discount: 0,
    loan_limit_bonus: 0,
    max_open_questions: 0,
    arbitration_priority: 0,
    analytics_plus: false
  };

  var BASE = {
    max_open_questions: 3, /* 普通用户同时可进行建题数 */
    max_fee: 1             /* 抽水率合法区间上界，仅做防御性夹取 */
  };

  var DAY_MS = 86400000;

  function round2(v) { return Math.round(v * 100) / 100; }
  function round4(v) { return Math.round(v * 10000) / 10000; }

  /* now / 时间串 统一转毫秒：支持 undefined、毫秒数、Date、ISO 串 */
  function nowMs(now) {
    if (now === undefined || now === null || now === '') return Date.now();
    if (now instanceof Date) return now.getTime();
    if (typeof now === 'number') return now;
    var t = new Date(now).getTime();
    return isFinite(t) ? t : Date.now();
  }

  /* ---------- 档位查询 ---------- */
  function tierDef(tierId) {
    return (tierId && TIERS[tierId]) || null;
  }

  /* 档位列表（副本，供 UI 渲染；避免外部篡改常量） */
  function listTiers() {
    return TIER_IDS.map(function (id) {
      var t = TIERS[id];
      return {
        id: t.id, name: t.name, price_points: t.price_points, days: t.days,
        perks: Object.assign({}, t.perks)
      };
    });
  }

  /* ---------- 生效判断 ---------- */
  /* 有效 = 有行 + 档位已知 + expires_at 可解析 + expires_at 严格晚于 now */
  function isActive(vipRow, now) {
    if (!vipRow || !tierDef(vipRow.tier)) return false;
    var exp = new Date(vipRow.expires_at).getTime();
    return isFinite(exp) && exp > nowMs(now);
  }

  /* 剩余天数（向上取整）；未生效返回 0 */
  function daysLeft(vipRow, now) {
    if (!isActive(vipRow, now)) return 0;
    var ms = new Date(vipRow.expires_at).getTime() - nowMs(now);
    return Math.max(0, Math.ceil(ms / DAY_MS));
  }

  /* 当前生效档位 id；未生效返回 '' */
  function tierOf(vipRow, now) {
    return isActive(vipRow, now) ? vipRow.tier : '';
  }

  /* 某档位的特权副本；未知档位返回零值特权 */
  function perksOf(tierId) {
    var t = tierDef(tierId);
    return Object.assign({}, NEUTRAL_PERKS, t ? t.perks : {});
  }

  /* ---------- 特权计算 ---------- */
  /* 有效抽水率：抽水减免只降不升，且夹在 [0, baseFee] 内 */
  function effectiveFee(baseFee, vipRow, now) {
    var base = Number(baseFee);
    if (!isFinite(base) || base <= 0) return 0;
    base = Math.min(base, BASE.max_fee);
    if (!isActive(vipRow, now)) return round4(base);
    var disc = Number(perksOf(vipRow.tier).fee_discount) || 0;
    disc = Math.max(0, Math.min(1, disc));
    return round4(base * (1 - disc));
  }

  /* 本人中奖时的抽水返利 = 中奖本金 × (基础抽水 − 有效抽水)。
   * 用途：结算时给 VIP 本人补一行 jp_bets(kind='bonus')，
   *       平台少收的抽水即返利来源；其他玩家派彩公式不变。 */
  function feeRebateOf(stake, baseFee, vipRow, now) {
    var s = Math.max(0, Number(stake) || 0);
    var saved = (Number(baseFee) || 0) - effectiveFee(baseFee, vipRow, now);
    return round2(s * Math.max(0, saved));
  }

  /* 信用额度：基础额度 + 档位加成（加成加在 LoanCore 的 credit_max 之上） */
  function loanLimit(baseLimit, vipRow, now) {
    var base = Number(baseLimit);
    if (!isFinite(base)) base = 0;
    if (!isActive(vipRow, now)) return round2(Math.max(0, base));
    var bonus = Number(perksOf(vipRow.tier).loan_limit_bonus) || 0;
    return round2(Math.max(0, base + Math.max(0, bonus)));
  }

  /* 同时建题数上限：取「基础值」与「档位绝对值」的较大者（只升不降） */
  function maxQuestions(baseN, vipRow, now) {
    var base = Math.floor(Number(baseN));
    if (!isFinite(base) || base < 0) base = 0;
    if (!isActive(vipRow, now)) return base;
    var cap = Math.floor(Number(perksOf(vipRow.tier).max_open_questions) || 0);
    return Math.max(base, cap);
  }

  /* 是否拥有某项特权：布尔特权看真值，数值特权看 > 0 */
  function hasPerk(vipRow, perk, now) {
    if (!isActive(vipRow, now)) return false;
    var v = perksOf(vipRow.tier)[perk];
    if (typeof v === 'boolean') return v;
    return Number(v) > 0;
  }

  /* ---------- 购买（组装 jp_vip 行，不落库） ---------- */
  /* fromIso：可选，续费基准（通常是当前 expires_at）。
   * 续费时从「未到期的旧到期时间」顺延；已过期则从 now 起算。 */
  function composeVipRow(uid, tierId, now, fromIso) {
    if (!uid) throw new Error('composeVipRow: 缺少 uid');
    var t = tierDef(tierId);
    if (!t) throw new Error('composeVipRow: 未知 VIP 档位 ' + tierId);
    var startMs = nowMs(now);
    var baseMs = fromIso ? new Date(fromIso).getTime() : NaN;
    if (!isFinite(baseMs) || baseMs < startMs) baseMs = startMs;
    return {
      uid: String(uid),
      tier: t.id,
      expires_at: new Date(baseMs + t.days * DAY_MS).toISOString(),
      updated_at: new Date(startMs).toISOString()
    };
  }

  return {
    TIERS: TIERS, TIER_IDS: TIER_IDS, NEUTRAL_PERKS: NEUTRAL_PERKS, BASE: BASE,
    tierDef: tierDef, listTiers: listTiers,
    isActive: isActive, daysLeft: daysLeft, tierOf: tierOf, perksOf: perksOf,
    effectiveFee: effectiveFee, feeRebateOf: feeRebateOf,
    loanLimit: loanLimit, maxQuestions: maxQuestions, hasPerk: hasPerk,
    composeVipRow: composeVipRow, round2: round2
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VipCore;
}
