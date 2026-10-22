/*!
 * lmsr.js — LMSR 份额化定价核心（纯函数，无副作用）
 *
 * 为什么是 LMSR：彩池里"平仓"在数学上不存在（赔付×概率恒等于本金），
 * 要让仓位能止盈止损，必须先让仓位有独立价格。
 *
 *   C(q)  = b · ln( Σ e^(q_i / b) )        成本函数
 *   p_i   = e^(q_i / b) / Σ e^(q_j / b)    即时价格（Σp = 1，天然是概率）
 *   买入  付 C(q+Δe_i) − C(q)
 *   卖出  收 C(q) − C(q−Δe_i)
 *
 * 平台最大亏损有闭式上界 b·ln(n)，与交易量无关。
 *
 * 约定：q 是「已售份额」数组，与 outcomes 顺序一一对应；单位与积分相同。
 */
var LmsrCore = (function () {
  'use strict';

  var DEFAULTS = {
    b: 500,          // 流动性深度：越大滑点越小、平台补贴上限越高
    minPrice: 0.02,  // 价格下限（防止 1 分钱买穿）
    maxPrice: 0.98,  // 价格上限
    fee: 0.05        // 抽水率，按 成交额 × f × 4p(1−p) 收
  };

  function num(v, d) {
    var n = Number(v);
    return isFinite(n) ? n : (d || 0);
  }

  function vec(q) {
    return (q || []).map(function (x) { return num(x); });
  }

  /* log-sum-exp，避免 e^(q/b) 溢出 */
  function lse(arr, b) {
    var m = -Infinity;
    for (var i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
    if (m === -Infinity) return 0;
    var s = 0;
    for (var j = 0; j < arr.length; j++) s += Math.exp((arr[j] - m) / b);
    return m + b * Math.log(s);
  }

  /* 成本函数 C(q) = b·ln Σe^(q_i/b)（等价写法，数值更稳） */
  function cost(q, b) {
    b = num(b, DEFAULTS.b);
    if (b <= 0) throw new Error('b must be > 0');
    return lse(vec(q), b);
  }

  /* 即时价格（概率），返回与 q 等长的数组，和为 1 */
  function prices(q, b) {
    b = num(b, DEFAULTS.b);
    var arr = vec(q);
    if (!arr.length) return [];
    var m = -Infinity;
    for (var i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
    var e = arr.map(function (x) { return Math.exp((x - m) / b); });
    var s = e.reduce(function (a, x) { return a + x; }, 0);
    return e.map(function (x) { return x / s; });
  }

  /* 从目标概率反解 q（softmax 平移不变：q_i = b·ln p_i） */
  function toQ(prob, b) {
    b = num(b, DEFAULTS.b);
    var p = (prob || []).map(function (x) { return Math.max(1e-9, num(x)); });
    var zero = p[0];
    return p.map(function (x) { return b * Math.log(x / zero); });
  }

  /* 平台最大亏损上界：b·ln(n) */
  function exposure(b, n) {
    b = num(b, DEFAULTS.b);
    return n > 1 ? b * Math.log(n) : 0;
  }

  /* 抽水：成交额 × f × 4p(1−p)，中间价最高、极端价趋零 */
  function feeOf(notional, p, f) {
    f = num(f, DEFAULTS.fee);
    var pp = Math.min(Math.max(num(p), 0), 1);
    return num(notional) * f * 4 * pp * (1 - pp);
  }

  /* 买入 shares 份：返回花费与新的 q；越界（价格出区间）返回 error */
  function buy(q, b, idx, shares, opts) {
    opts = opts || {};
    var arr = vec(q);
    var bv = num(b, DEFAULTS.b);
    var n = num(shares);
    if (!(n > 0)) return { error: '份额必须大于 0' };
    if (idx < 0 || idx >= arr.length) return { error: '选项不存在' };

    var before = prices(arr, bv);
    var q2 = arr.slice();
    q2[idx] += n;
    var after = prices(q2, bv);

    var minP = num(opts.minPrice, DEFAULTS.minPrice);
    var maxP = num(opts.maxPrice, DEFAULTS.maxPrice);
    if (after[idx] > maxP) {
      return { error: '该选项价格已达上限 ' + Math.round(maxP * 100) + '%，只能卖出' };
    }
    var spend = cost(q2, bv) - cost(arr, bv);
    var avg = spend / n;
    if (avg <= 0) return { error: '成交价异常，请重试' };

    return {
      q: q2,
      shares: n,
      cost: spend,
      avgPrice: avg,
      fee: feeOf(spend, avg, opts.fee),
      priceBefore: before[idx],
      priceAfter: after[idx],
      prices: after
    };
  }

  /* 卖出 shares 份：返回收入与新的 q；持仓不足拒绝 */
  function sell(q, b, idx, shares, opts) {
    opts = opts || {};
    var arr = vec(q);
    var bv = num(b, DEFAULTS.b);
    var n = num(shares);
    if (!(n > 0)) return { error: '份额必须大于 0' };
    if (idx < 0 || idx >= arr.length) return { error: '选项不存在' };
    if (arr[idx] < n - 1e-9) return { error: '持仓不足' };

    var before = prices(arr, bv);
    var q2 = arr.slice();
    q2[idx] -= n;
    var after = prices(q2, bv);

    var minP = num(opts.minPrice, DEFAULTS.minPrice);
    if (after[idx] < minP) {
      return { error: '该选项价格已达下限，只能买入' };
    }
    var proceeds = cost(arr, bv) - cost(q2, bv);
    var avg = proceeds / n;

    return {
      q: q2,
      shares: n,
      proceeds: proceeds,
      avgPrice: avg,
      fee: feeOf(proceeds, avg, opts.fee),
      priceBefore: before[idx],
      priceAfter: after[idx],
      prices: after
    };
  }

  /* 给定额度能买多少份（前端"最大可买"用） */
  function maxShares(q, b, idx, budget, opts) {
    var lo = 0, hi = 1e6;
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      var r = buy(q, b, idx, mid, opts);
      if (r.error || r.cost > budget) hi = mid; else lo = mid;
    }
    return Math.floor(lo);
  }

  /* 用当前价格结算：赢家每份 1 分 */
  function settlePayout(shares, won) {
    return won ? num(shares) : 0;
  }

  return {
    DEFAULTS: DEFAULTS,
    cost: cost,
    prices: prices,
    toQ: toQ,
    exposure: exposure,
    feeOf: feeOf,
    buy: buy,
    sell: sell,
    maxShares: maxShares,
    settlePayout: settlePayout
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LmsrCore;
