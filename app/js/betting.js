/* ============================================================
 * 明鉴 · 预测下注引擎 v0.1
 * 两种赔率模式：
 * - fixed 固定赔率：主办方设定，赔付 = 投注额 × 赔率
 * - pool  彩池赔率（pari-mutuel）：赔率随投注分布动态形成，
 *          赔率_i = 总彩池 × (1 − 抽水) ÷ 选项_i 彩池
 * 纯函数，无 DOM 依赖，可 Node 自测。
 * ============================================================ */
var Betting = (function () {
  'use strict';

  function poolOf(q) {
    var pools = {}, total = 0;
    q.outcomes.forEach(function (o) {
      var p = ((q.pool && q.pool[o.id]) || 0) + ((q.userPool && q.userPool[o.id]) || 0);
      pools[o.id] = p;
      total += p;
    });
    return { pools: pools, total: total };
  }

  /* 当前赔率（含模拟公众池 + 我的投注） */
  function currentOdds(q) {
    var odds = {};
    if (q.mode === 'fixed') {
      q.outcomes.forEach(function (o) { odds[o.id] = o.fixedOdds; });
      return { odds: odds, pools: null, total: null };
    }
    var r = poolOf(q);
    q.outcomes.forEach(function (o) {
      odds[o.id] = r.pools[o.id] > 0 ? r.total * (1 - q.fee) / r.pools[o.id] : 0;
    });
    return { odds: odds, pools: r.pools, total: r.total };
  }

  /* 下注时的预计赔付：先把自己的投注加进彩池再算（与彩池规则一致） */
  function potentialPayout(q, outcomeId, stake) {
    if (q.mode === 'fixed') {
      var o = q.outcomes.filter(function (x) { return x.id === outcomeId; })[0];
      return stake * (o ? o.fixedOdds : 0);
    }
    var r = poolOf(q);
    var winPool = r.pools[outcomeId] + stake;
    var total = r.total + stake;
    return stake * total * (1 - q.fee) / winPool;
  }

  /* 揭晓时的最终赔率 */
  function settleOdds(q) {
    if (q.mode === 'fixed') {
      var o = q.outcomes.filter(function (x) { return x.id === q.result; })[0];
      return o ? o.fixedOdds : 0;
    }
    var r = poolOf(q);
    return r.pools[q.result] > 0 ? r.total * (1 - q.fee) / r.pools[q.result] : 0;
  }

  function round2(v) { return Math.round(v * 100) / 100; }
  function fmtOdds(v) { return v > 0 ? v.toFixed(2) : '—'; }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { currentOdds: currentOdds, potentialPayout: potentialPayout, settleOdds: settleOdds, poolOf: poolOf };
  }
  return { currentOdds: currentOdds, potentialPayout: potentialPayout, settleOdds: settleOdds, poolOf: poolOf, fmtOdds: fmtOdds };
})();
