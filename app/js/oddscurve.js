/* ============================================================
 * 明鉴 · 赔率曲线与预期指数（OddsCore 纯函数，联机版专用）
 * - 快照：彩池题在下注/注入时按节流写入 jp_odds_snaps（qid/odds/pool）
 * - 曲线：由历史快照 + 当前实时池推导，SVG 纯字符串渲染（无 DOM 依赖）
 * - 预期指数：全部进行中彩池题的首选项概率 = 市场信念快照，
 *   措辞中立，只描述投注分布，不预测、不建议
 * ============================================================ */
var OddsCore = (function () {
  'use strict';

  var SNAP_MIN_INTERVAL = 10 * 60 * 1000;   /* 同题快照最小间隔 10 分钟 */
  var HIGH = 0.8;                            /* 高置信阈值 */
  var LOW = 0.2;                             /* 低概率阈值 */

  function round2(v) { return Math.round(v * 100) / 100; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /* ---------- 彩池（与 OnlineCore.poolOf 同口径：初始池 + 未结投注） ---------- */
  function poolOf(q, bets) {
    var pools = {}, total = 0;
    (q.outcomes || []).forEach(function (o) {
      pools[o.id] = num(q.pool && q.pool[o.id]);
      total += pools[o.id];
    });
    (bets || []).forEach(function (b) {
      if (b.kind && b.kind !== 'bet') return;
      if (b.qid === q.qid && b.status === 'open') {
        pools[b.outcome_id] = (pools[b.outcome_id] || 0) + num(b.stake);
        total += num(b.stake);
      }
    });
    return { pools: pools, total: total };
  }

  function oddsOf(q, pools) {
    var total = 0;
    (q.outcomes || []).forEach(function (o) { total += num(pools[o.id]); });
    var odds = {};
    (q.outcomes || []).forEach(function (o) {
      var p = num(pools[o.id]);
      odds[o.id] = p > 0 ? round2(total * (1 - num(q.fee)) / p) : 0;
    });
    return odds;
  }

  /* 首选项（通常是「会/是」）的市场概率 = 该选项池 ÷ 总池 */
  function firstProb(q, pool) {
    var first = (q.outcomes || [])[0];
    if (!first) return 0;
    var total = 0;
    (q.outcomes || []).forEach(function (o) { total += num(pool && pool[o.id]); });
    if (total <= 0) return 0;
    return num(pool[first.id]) / total;
  }

  /* ---------- 快照 ---------- */
  /* 历史序列（按时间升序）：由快照的 pool 反推概率 */
  function seriesOf(q, snaps) {
    return (snaps || [])
      .filter(function (s) { return s.qid === q.qid; })
      .sort(function (a, b) { return (a.created_at || '') > (b.created_at || '') ? 1 : -1; })
      .map(function (s) {
        return { t: s.created_at, p: firstProb(q, s.pool), pool: s.pool, odds: s.odds };
      });
  }

  /* 节流：同题距上次快照不足一个间隔就不再写 */
  function shouldSnap(qid, snaps, now, minIntervalMs) {
    var list = (snaps || []).filter(function (s) { return s.qid === qid; });
    if (!list.length) return true;
    var newest = list.reduce(function (m, s) { return (m || '') > (s.created_at || '') ? m : s.created_at; }, '');
    var t = newest ? new Date(newest).getTime() : 0;
    if (!isFinite(t) || !t) return true;
    return (num(now) - t) >= (minIntervalMs || SNAP_MIN_INTERVAL);
  }

  /* 曲线点位 = 历史快照 + 当前实时池（保证至少一个点） */
  function probPoints(q, bets, snaps) {
    var pts = seriesOf(q, snaps);
    var live = poolOf(q, bets);
    pts.push({ t: new Date().toISOString(), p: firstProb(q, live.pools), pool: live.pools, live: true });
    return pts;
  }

  /* ---------- SVG 迷你曲线（纯字符串） ---------- */
  function sparklineSvg(points, opts) {
    opts = opts || {};
    var W = opts.w || 132, H = opts.h || 34, pad = 3;
    var pts = (points || []).filter(function (p) { return p && isFinite(Number(p.p)); });
    if (!pts.length) return '';
    var n = pts.length;
    var x = function (i) { return pad + (n === 1 ? (W - 2 * pad) / 2 : i * (W - 2 * pad) / (n - 1)); };
    var y = function (p) { return H - pad - Math.max(0, Math.min(1, num(p.p))) * (H - 2 * pad); };
    var s = '';
    if (n > 1) {
      var d = pts.map(function (p, i) {
        return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p).toFixed(1);
      }).join(' ');
      s += '<path d="' + d + '" fill="none" stroke="#185FA5" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';
    }
    var last = pts[n - 1];
    s += '<circle cx="' + x(n - 1).toFixed(1) + '" cy="' + y(last).toFixed(1) + '" r="2.6" fill="#185FA5"/>';
    return '<svg class="spark-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
      '" role="img" aria-label="赔率走势">' + s + '</svg>';
  }

  /* ---------- 预期指数 ---------- */
  /* 只统计进行中的彩池题；固定赔率题没有市场概率，不入指数 */
  function expectationIndex(questions, bets, now) {
    var rows = [];
    (questions || []).forEach(function (q) {
      if (q.mode !== 'pool' || q.status !== 'open') return;
      var live = poolOf(q, bets);
      if (live.total <= 0) return;               /* 无池无投注，不构成市场 */
      rows.push({
        q: q, p: firstProb(q, live.pools),
        total: live.total, odds: oddsOf(q, live.pools)
      });
    });
    rows.sort(function (a, b) { return b.p - a.p; });
    var n = rows.length;
    /* 平均概率保留全精度，展示层再格式化（避免 52.38% 被抹成 52%） */
    var avg = n ? rows.reduce(function (s, r) { return s + r.p; }, 0) / n : 0;
    return {
      rows: rows, count: n, avg: avg,
      high: rows.filter(function (r) { return r.p >= HIGH; }).length,
      low: rows.filter(function (r) { return r.p <= LOW; }).length,
      mid: rows.filter(function (r) { return r.p > LOW && r.p < HIGH; }).length,
      now: now || new Date().toISOString()
    };
  }

  /* 中性口径文案（可被外部引用） */
  function quoteLine(idx, dateStr) {
    if (!idx.count) return '平台暂无进行中的彩池题，预期指数样本不足。';
    return '截至 ' + dateStr + '，明鉴平台 ' + idx.count + ' 个进行中预测问题的市场平均概率为 ' +
      Math.round(idx.avg * 1000) / 10 + '%（该指数仅反映平台内投注分布，不构成对任何事件结果的预测或建议）。';
  }

  return {
    SNAP_MIN_INTERVAL: SNAP_MIN_INTERVAL, HIGH: HIGH, LOW: LOW,
    poolOf: poolOf, oddsOf: oddsOf, firstProb: firstProb,
    seriesOf: seriesOf, shouldSnap: shouldSnap, probPoints: probPoints,
    sparklineSvg: sparklineSvg,
    expectationIndex: expectationIndex, quoteLine: quoteLine
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OddsCore;
}
